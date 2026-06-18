"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";

// Admin → Agent Control. The single place admins manage MASE's agents: KNOWLEDGE
// (uploaded docs), the TODO RUNNER prompt, the DEAL SWEEP prompt, EXECUTION (runs +
// sweep), and access. Admin-only — the page gates on isAdminView and the nav tab is
// hidden for everyone else; the /api/documents, /api/deal-engine/todo-runner/prompt
// (POST-only) and /api/deal-engine/sweep/prompt proxies enforce admin server-side too.

// Everything uploaded goes into the single MASE knowledge corpus
// (MASE_KNOWLEDGE_PROJECT_ID) that every "Run with AI" agent run searches — so there
// is no corpus picker; upload → retrieval is one bucket.
const DOC_TYPES = ["playbook", "guide", "email_template", "transcript", "showpad_asset", "other"];
const TEXT_EXT = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".xml", ".yaml", ".yml", ".log"];
const BIN_EXT = [".pdf", ".docx", ".xlsx", ".xlsm", ".pptx"]; // extracted server-side (pypdf / docx / openpyxl / pptx)
const ACCEPT_EXT = [...TEXT_EXT, ...BIN_EXT];

// One file staged in the multi-upload queue. Each becomes its own MASE document.
type QItem = {
  id: string;
  name: string;
  size: number;
  content?: string;   // text files: read client-side
  fileB64?: string;   // binary files (PDF/DOCX/XLSX/PPTX): server extracts the text
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
};

// Read a file as text (text family) or base64 (binary family, extracted server-side).
function readOneFile(f: File): Promise<{ content?: string; fileB64?: string }> {
  return new Promise((resolve, reject) => {
    const lower = f.name.toLowerCase();
    const isBin = BIN_EXT.some((x) => lower.endsWith(x));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    if (isBin) {
      reader.onload = () => { const s = String(reader.result || ""); resolve({ fileB64: s.includes(",") ? s.split(",")[1] : s }); };
      reader.readAsDataURL(f);
    } else {
      reader.onload = () => resolve({ content: String(reader.result || "") });
      reader.readAsText(f);
    }
  });
}

export default function AdminPage() {
  const { isAdminView } = useDashboard();
  if (!isAdminView)
    return (
      <div className="dq-lock"><div className="dq-lock-card">
        <div className="dq-lock-ttl">🔒 Admin</div>
        <div className="dq-lock-sub">Agent control is restricted to admins.</div>
      </div></div>
    );
  return <AdminInner />;
}

function AdminInner() {
  const [tab, setTab] = useState<"docs" | "todorunner" | "sweep" | "execution" | "access">("docs");
  const [dealCount, setDealCount] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch("/api/deal-engine/deals-count", { cache: "no-store" });
        const j = await r.json();
        if (!off && typeof j.count === "number") setDealCount(j.count);
      } catch { /* leave null */ }
    })();
    return () => { off = true; };
  }, []);
  return (
    <div id="adminview">
      <div className="todo-top">
        <div className="ttl"><b>Agent Control</b> — manage the agents: knowledge, the todo-runner prompt, the deal-sweep prompt, execution, and access.</div>
        <div className="admin-stat" title="Total deals currently tracked in the deal engine">
          <b>{dealCount == null ? "…" : dealCount.toLocaleString()}</b><span>tracked deals</span>
        </div>
      </div>
      <div className="admin-tabs">
        {([["docs", "Knowledge"], ["todorunner", "Todo Runner"], ["sweep", "Deal Sweep"], ["execution", "Execution"], ["access", "Access & Config"]] as const).map(([k, label]) => (
          <button key={k} className={`admin-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="admin-body">
        {tab === "docs" && <DocumentsSection />}
        {tab === "todorunner" && <TodoRunnerSection />}
        {tab === "sweep" && <SweepPromptSection />}
        {tab === "execution" && <ExecutionSection />}
        {tab === "access" && <AccessSection />}
      </div>
    </div>
  );
}

// ── 1. Knowledge / Documents ───────────────────────────────────────────────
function DocumentsSection() {
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [queue, setQueue] = useState<QItem[]>([]);   // files staged for upload (one doc each)
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const loadDocs = useCallback(async () => {
    setListLoading(true);
    try {
      // MASE's OWN isolated knowledge store (separate from VIBE's documents/projects).
      const r = await fetch(`/api/deal-engine/knowledge`, { cache: "no-store" });
      const j = await r.json();
      setDocs(Array.isArray(j) ? j : j.documents || j.rows || []);
    } catch { setDocs([]); }
    setListLoading(false);
  }, []);
  useEffect(() => { void loadDocs(); }, [loadDocs]);

  const [dragActive, setDragActive] = useState(false);
  const [noteErr, setNoteErr] = useState(false);
  const say = (msg: string, isErr = false) => { setNote(msg); setNoteErr(isErr); };

  // Stage one or more files into the upload queue (read client-side; validated by ext/size).
  async function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;
    let added = 0; const skipped: string[] = [];
    for (const f of arr) {
      const lower = f.name.toLowerCase();
      if (!ACCEPT_EXT.some((x) => lower.endsWith(x))) { skipped.push(`${f.name} (type)`); continue; }
      if (f.size > 15_000_000) { skipped.push(`${f.name} (>15 MB)`); continue; }
      try {
        const r = await readOneFile(f);
        const item: QItem = {
          id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
          name: f.name, size: f.size, ...r, status: "queued",
        };
        setQueue((q) => [...q, item]);
        added++;
      } catch { skipped.push(`${f.name} (read error)`); }
    }
    if (skipped.length) say(`Skipped ${skipped.length}: ${skipped.join(", ")}`, true);
    else if (added) say("");
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ""; }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files); }
  function removeItem(id: string) { setQueue((q) => q.filter((x) => x.id !== id)); }

  // Upload every pending file (one POST each → one MASE document, named by filename) plus
  // an optional pasted doc. Failed items are kept in the queue so they can be retried.
  async function uploadAll() {
    const pending = queue.filter((it) => it.status === "queued" || it.status === "error");
    const hasPaste = !!pasteText.trim() && !!pasteTitle.trim();
    if (!pending.length && !hasPaste) { say("Add one or more files, or paste text with a title.", true); return; }
    setBusy(true); say("");
    let ok = 0, fail = 0;
    for (const it of pending) {
      setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, status: "uploading", error: undefined } : x)));
      try {
        // MASE's OWN isolated knowledge store (no project_id). Binary files go as base64
        // (file_b64 + filename) for server-side extraction; text files as content.
        const body: Record<string, unknown> = { name: it.name.replace(/\.[^.]+$/, ""), doc_type: docType };
        if (it.fileB64) { body.file_b64 = it.fileB64; body.filename = it.name; }
        else body.content = it.content || "";
        const r = await fetch("/api/deal-engine/knowledge", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || j.error) { fail++; const msg = j.error || `(${r.status})`; setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x))); }
        else { ok++; setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, status: "done" } : x))); }
      } catch (e: any) { fail++; const msg = e?.message || String(e); setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x))); }
    }
    if (hasPaste) {
      try {
        const r = await fetch("/api/deal-engine/knowledge", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: pasteTitle.trim(), doc_type: docType, content: pasteText }),
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || j.error) { fail++; say(j.error || `Paste upload failed (${r.status})`, true); }
        else { ok++; setPasteTitle(""); setPasteText(""); }
      } catch (e: any) { fail++; say(e?.message || String(e), true); }
    }
    setBusy(false);
    void loadDocs();
    if (fail === 0) { setQueue([]); setModalOpen(false); }
    else say(`${ok} uploaded · ${fail} failed. Failed items are kept — fix and retry.`, true);
  }

  const canUpload = queue.some((it) => it.status === "queued" || it.status === "error") || (!!pasteText.trim() && !!pasteTitle.trim());

  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  async function openDoc(d: any) {
    setViewing({ ...d, content: undefined });
    setViewLoading(true);
    try {
      const r = await fetch(`/api/deal-engine/knowledge/${encodeURIComponent(d.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && !j.error) setViewing(j);
      else setViewing({ ...d, content: `Couldn't load content (${j.error || r.status}).` });
    } catch (e: any) { setViewing({ ...d, content: `Couldn't load content (${e?.message || e}).` }); }
    setViewLoading(false);
  }

  function resetForm() {
    setQueue([]); setPasteTitle(""); setPasteText(""); setDocType(DOC_TYPES[0]); say("");
  }
  function openModal() { resetForm(); setModalOpen(true); }
  function closeModal() { if (!busy) setModalOpen(false); }

  async function deleteDoc(d: any) {
    if (!window.confirm(`Delete "${d.name || d.id}"? This removes it from the MASE knowledge base.`)) return;
    setDeletingId(d.id);
    try {
      const r = await fetch(`/api/deal-engine/knowledge/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      if (r.ok) await loadDocs();
    } catch { /* ignore */ }
    setDeletingId(null);
  }

  return (
    <div className="admin-card">
      <div className="kn-head">
        <div>
          <h3>Knowledge</h3>
          <p className="admin-desc" style={{ marginBottom: 0 }}>Docs are chunked, embedded, and stored in the MASE knowledge base — every &ldquo;Run with AI&rdquo; agent retrieves them via search_knowledge while completing tasks.</p>
        </div>
        <button className="admin-btn primary kn-add" onClick={openModal}>+ Add document</button>
      </div>

      {/* Primary view: the documents already uploaded. */}
      <div className="kn-list-head">
        <h4 style={{ margin: 0, fontSize: 13.5 }}>Documents <span className="admin-meta">({listLoading ? "…" : docs.length})</span></h4>
        <button className="admin-btn kn-refresh" onClick={() => void loadDocs()} disabled={listLoading} title="Refresh">↻</button>
      </div>
      <div className="admin-doclist">
        {docs.length === 0 && !listLoading ? (
          <div className="admin-meta" style={{ padding: "18px 14px" }}>No documents yet. Click <b>+ Add document</b> to upload a file or paste text.</div>
        ) : docs.map((d, i) => (
          <div key={d.id || i} className="admin-docrow kn-docrow-click" onClick={() => openDoc(d)} title="View content">
            <span className="admin-docname">{d.name || d.title || d.id}</span>
            <span className="kn-row-meta">
              {d.doc_type && <span className="kn-badge">{d.doc_type}</span>}
              {d.created_at && <span className="admin-meta">{String(d.created_at).slice(0, 10)}</span>}
              <button className="kn-del" onClick={(e) => { e.stopPropagation(); void deleteDoc(d); }} disabled={deletingId === d.id} title="Delete document" aria-label="Delete document">
                {deletingId === d.id ? "…" : "Delete"}
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Upload modal */}
      {modalOpen && (
        <div className="kn-modal-overlay" onClick={closeModal}>
          <div className="kn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kn-modal-head">
              <h3>Add document</h3>
              <button className="kn-file-x" onClick={closeModal} aria-label="Close">✕</button>
            </div>
            <p className="admin-desc">Upload one or more files (PDF, Word, Excel, PowerPoint, CSV, …) or paste text. Each file becomes its own document, named by its filename. Tag the type so retrieval can route by it.</p>

            <label className="kn-field" style={{ maxWidth: 240, marginBottom: 4 }}><span>Type (applies to all)</span>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label
              className={`kn-drop ${dragActive ? "drag" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <input type="file" accept={ACCEPT_EXT.join(",")} onChange={onFile} multiple hidden />
              <svg className="kn-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <div className="kn-drop-main">Drag &amp; drop files, or <span className="kn-link">browse</span></div>
              <div className="kn-drop-sub">PDF, Word, Excel, PowerPoint, CSV, Markdown, TXT, JSON · multiple files · up to 15 MB each</div>
            </label>

            {queue.length > 0 && (
              <div className="kn-queue">
                <div className="kn-queue-head"><span>{queue.length} file{queue.length === 1 ? "" : "s"} staged</span></div>
                {queue.map((it) => (
                  <div key={it.id} className={`kn-file kn-q-${it.status}`}>
                    <span className="kn-file-badge">{(it.name.split(".").pop() || "DOC").toUpperCase().slice(0, 4)}</span>
                    <div className="kn-file-info">
                      <span className="kn-file-name">{it.name}</span>
                      <span className="kn-file-meta">
                        {it.status === "uploading" ? "Uploading…"
                          : it.status === "done" ? "✓ Uploaded"
                          : it.status === "error" ? `✕ ${it.error || "Failed"}`
                          : it.fileB64 ? "binary · text extracted on the server" : `${(it.content?.length || 0).toLocaleString()} chars`}
                      </span>
                    </div>
                    {it.status !== "uploading" && it.status !== "done" && (
                      <button type="button" className="kn-file-x" onClick={() => removeItem(it.id)} aria-label="Remove file" disabled={busy}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="kn-or"><span>or paste a single document</span></div>
            <label className="kn-field" style={{ marginBottom: 8 }}><span>Title</span>
              <input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="e.g. Enterprise objection-handling playbook" />
            </label>
            <textarea className="admin-textarea" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the document text here" rows={5} />

            <div className="admin-actions">
              <button className="admin-btn primary" onClick={uploadAll} disabled={busy || !canUpload}>{busy ? "Uploading…" : "Upload"}</button>
              <button className="admin-btn" onClick={closeModal} disabled={busy}>Cancel</button>
              {note && <span className={`admin-note ${noteErr ? "err" : ""}`}>{note}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Document viewer modal */}
      {viewing && (
        <div className="kn-modal-overlay" onClick={() => setViewing(null)}>
          <div className="kn-modal kn-view" onClick={(e) => e.stopPropagation()}>
            <div className="kn-modal-head">
              <div className="kn-view-title">
                <h3>{viewing.name || viewing.id}</h3>
                <div className="kn-view-sub">
                  {viewing.doc_type && <span className="kn-badge">{viewing.doc_type}</span>}
                  {typeof viewing.chunks === "number" && <span className="admin-meta">{viewing.chunks} chunk{viewing.chunks === 1 ? "" : "s"}</span>}
                  {typeof viewing.content === "string" && <span className="admin-meta">{viewing.content.length.toLocaleString()} chars</span>}
                  {viewing.created_at && <span className="admin-meta">{String(viewing.created_at).slice(0, 10)}</span>}
                </div>
              </div>
              <button className="kn-file-x" onClick={() => setViewing(null)} aria-label="Close">✕</button>
            </div>
            <div className="kn-view-body">
              {viewLoading ? (
                <div className="admin-meta" style={{ padding: "20px 4px" }}>Loading content…</div>
              ) : (
                <pre className="kn-view-pre">{viewing.content || "(empty)"}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 2. Agent system prompts (Todo Runner + Deal Sweep) ──────────────────────
// A reusable system-prompt editor. The backend stores every agent prompt in
// Supabase (the runtime source of truth) and returns {prompt, default, is_override}
// from `endpoint`; an empty save clears the override and falls back to the shipped
// default. Used for BOTH the chat/todo-runner agent and the deal-sweep agent.
function PromptEditor({ endpoint, heading, description, saveLabel, savedMsg, rows = 18 }: {
  endpoint: string; heading: string; description: string; saveLabel: string; savedMsg: string; rows?: number;
}) {
  const [prompt, setPrompt] = useState("");
  const [serverPrompt, setServerPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [isOverride, setIsOverride] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setNote(null);
    try {
      const r = await fetch(endpoint, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) setNote(j.error || `Error ${r.status}`);
      else {
        const p = j.is_override ? (j.prompt || "") : (j.default || "");
        setPrompt(p); setServerPrompt(p); setDefaultPrompt(j.default || ""); setIsOverride(!!j.is_override);
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setLoading(false);
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function save(value: string) {
    setSaving(true); setNote(null);
    try {
      const r = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setNote(j.error || `Error ${r.status}`);
      else {
        const applied = value.trim() ? value : defaultPrompt;
        setServerPrompt(applied); setPrompt(applied); setIsOverride(!!j.is_override);
        setNote(value.trim() ? savedMsg : "Reset to the built-in default.");
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setSaving(false);
  }

  const dirty = prompt !== serverPrompt;
  return (
    <div className="admin-card">
      <h3>{heading} {isOverride && <span className="ap-tag ap-custom">custom</span>}</h3>
      <p className="admin-desc">{description}</p>
      {loading ? <div className="admin-meta">Loading…</div> : (
        <>
          <textarea className="admin-textarea mono" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={rows} />
          <div className="admin-actions">
            <button className="admin-btn primary" onClick={() => save(prompt)} disabled={saving || !dirty}>{saving ? "Saving…" : saveLabel}</button>
            <button className="admin-btn" onClick={() => save("")} disabled={saving}>Reset to default</button>
            {dirty && <span className="admin-meta">unsaved changes</span>}
            {note && <span className="admin-note">{note}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// The Todo Runner — MASE's Tactical Fulfillment / "Run with AI" agent that drafts
// an outbound email to complete a single to-do. Stored in Supabase (key
// mase_todo_runner). Distinct from the Deal Sweep agent below.
function TodoRunnerSection() {
  return (
    <PromptEditor
      endpoint="/api/deal-engine/todo-runner/prompt"
      heading="Todo Runner agent system prompt"
      description="Governs the Tactical Fulfillment agent behind 'Run with AI' on a to-do: it gathers facts (Showpad, Salesforce, knowledge base), refuses anything that needs a human, and drafts ONE outbound email for the rep to review. Stored in Supabase and applied on the next 'Run with AI' — no redeploy. Leave empty + save to fall back to the shipped default. This is NOT the Deal Sweep agent. Note: every rep's run reads this prompt at run time, so don't paste secrets or credentials into it."
      saveLabel="Save todo-runner prompt"
      savedMsg="Saved — applies to the next 'Run with AI'."
      rows={20}
    />
  );
}

// The Deal Intelligence Engine SWEEP agent's system prompt — the agent that reads
// Salesforce + Avoma per opportunity and writes the canonical deal record. Distinct
// from the chat/todo-runner agent above. Stored in Supabase (key mase_deal_sweep).
function SweepPromptSection() {
  return (
    <PromptEditor
      endpoint="/api/deal-engine/sweep/prompt"
      heading="Deal Sweep agent system prompt"
      description="Governs the Deal Intelligence Engine sweep: the agent that analyses one opportunity end-to-end against live Salesforce + Avoma (transcripts, MEDDPICC, competition) and emits the canonical deal record the Deals / Espresso / Matcha views read. Stored in Supabase and applied on the next opportunity swept — no redeploy. Leave empty + save to fall back to the shipped default. This is NOT the chat / to-do-runner agent."
      saveLabel="Save sweep prompt"
      savedMsg="Saved — applies to the next opportunity swept."
      rows={28}
    />
  );
}

// ── 3. Execution — two separate run feeds: Deal Sweep + Todo Runner ──────────
const TR_STATUS: Record<string, { label: string; color?: string }> = {
  draft_ready: { label: "✓ draft ready", color: "var(--green-ink)" },
  needs_human: { label: "⚠ needs human", color: "var(--red-ink)" },
  error: { label: "error", color: "var(--red-ink)" },
  running: { label: "running…" },
};

function ExecutionSection() {
  const [sweep, setSweep] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, r] = await Promise.all([
        fetch("/api/deal-engine/sweep/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/deal-engine/trigger-logs", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/deal-engine/todo-runner/runs", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setSweep(s);
      setLogs((t?.rows || (Array.isArray(t) ? t : [])).slice(0, 25));
      setRuns(r?.runs || []);
    } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const c = sweep ? {
    done: sweep.done || 0, failed: sweep.failed || 0, working: sweep.working ?? (sweep.in_progress || 0),
    waiting: sweep.waiting || 0, status: sweep.status,
  } : null;
  return (
    <>
      <div className="admin-actions" style={{ marginBottom: 12 }}>
        <button className="admin-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh both"}</button>
      </div>

      {/* Deal Sweep agent runs */}
      <div className="admin-card">
        <h3>Deal Sweep runs</h3>
        <p className="admin-desc">The Deal Intelligence Engine sweep — the agent that reads Salesforce + Avoma per opportunity and writes the canonical deal record. Full per-deal detail on the <a href="/runs">Runs</a> tab.</p>
        {c && (
          <div className="dq-sync" style={{ flexWrap: "wrap", marginBottom: 12 }}>
            <div className="dq-stat"><b style={{ color: c.status === "running" ? "var(--green-ink)" : undefined }}>{c.status || "idle"}</b><span>worker</span></div>
            <div className="dq-stat"><b>{c.done}</b><span>done</span></div>
            <div className="dq-stat"><b>{c.working}</b><span>in flight</span></div>
            <div className="dq-stat"><b>{c.waiting}</b><span>waiting</span></div>
            <div className="dq-stat"><b style={c.failed ? { color: "var(--red-ink)" } : undefined}>{c.failed}</b><span>failed</span></div>
          </div>
        )}
        <div className="admin-doclist">
          {logs.length === 0 ? <div className="admin-meta">No recent sweep runs.</div> :
            logs.map((r, i) => (
              <div key={i} className="admin-docrow">
                <span className="admin-docname">{(r.opp_name || r.account_name || r.opp_id || "—")}</span>
                <span className="admin-meta">{r.source || ""} · {r.status || ""} · {r.created_at ? String(r.created_at).slice(0, 16).replace("T", " ") : ""}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Todo Runner agent runs (the task-completion / "Run with AI" agent) */}
      <div className="admin-card">
        <h3>Todo Runner runs</h3>
        <p className="admin-desc">The Tactical Fulfillment agent behind “Run with AI” on a to-do — it drafts an outbound email for a rep to review. Most recent runs across the team.</p>
        <div className="admin-doclist">
          {runs.length === 0 ? <div className="admin-meta">No “Run with AI” runs yet.</div> :
            runs.map((r, i) => {
              const st = TR_STATUS[r.status] || { label: r.status || "—" };
              const todo = String(r.todo || "");
              return (
                <div key={r.chat_id || i} className="admin-docrow">
                  <span className="admin-docname">{r.account || r.opp || "—"}{todo ? <span className="admin-meta"> — {todo.slice(0, 70)}{todo.length > 70 ? "…" : ""}</span> : null}</span>
                  <span className="admin-meta"><b style={{ color: st.color }}>{st.label}</b>{r.owner ? " · " + r.owner : ""}{r.created_at ? " · " + String(r.created_at).slice(0, 16).replace("T", " ") : ""}</span>
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}

// ── 4. Access & Config ──────────────────────────────────────────────────────
function AccessSection() {
  const admins = Array.from(ADMIN_EMAILS).sort();
  return (
    <div className="admin-card">
      <h3>Admins ({admins.length})</h3>
      <p className="admin-desc">Full-access users (whole book + this Agent Control page + Runs/Learning/Sync Quality). The list is defined in <code>lib/engine/helpers.ts</code> (ADMIN_EMAILS); a DB-backed add/remove from this page is a planned upgrade.</p>
      <div className="admin-doclist">
        {admins.map((e) => <div key={e} className="admin-docrow"><span className="admin-docname">{e}</span></div>)}
      </div>
      <h3 style={{ marginTop: 24 }}>Agent model</h3>
      <p className="admin-desc">Runs on <code>claude-opus-4-8</code> (server-configured). Model/tool configuration is managed in the backend; surfacing it here is a planned upgrade.</p>
    </div>
  );
}
