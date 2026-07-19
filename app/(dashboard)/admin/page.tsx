"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { ADMIN_EMAILS, EMAIL_TO_OWNER, uniqSorted, type Rec } from "@/lib/engine/helpers";
import { DatalakeSyncCard } from "@/components/admin/DatalakeSyncCard";
import RunSweepSection from "@/components/admin/RunSweepSection";
import BackupSection from "@/components/admin/BackupSection";
import MultiSelect, { type Opt } from "@/components/MultiSelect";

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
// The raw File is held and PUT directly to S3 (no client-side read / base64), so
// there is no practical size limit — see uploadAll().
type QItem = {
  id: string;
  name: string;
  size: number;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
};

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
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
  const [tab, setTab] = useState<"docs" | "skills" | "todorunner" | "sweep" | "runsweep" | "chat" | "calls" | "execution" | "access" | "chats" | "backup">("docs");
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
        {([["docs", "Knowledge"], ["skills", "Skills"], ["todorunner", "Todo Runner"], ["sweep", "Deal Sweep"], ["runsweep", "Run Sweep"], ["chat", "Chat Agent"], ["calls", "Calls"], ["execution", "Execution"], ["access", "Access & Config"], ["chats", "Chats"], ["backup", "Database Backup"]] as const).map(([k, label]) => (
          <button key={k} className={`admin-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="admin-body">
        {tab === "docs" && <DocumentsSection />}
        {tab === "skills" && <SkillsSection />}
        {tab === "todorunner" && <TodoRunnerSection />}
        {tab === "sweep" && <SweepPromptSection />}
        {tab === "runsweep" && <RunSweepSection />}
        {tab === "chat" && <ChatAgentSection />}
        {tab === "calls" && <CallsSection />}
        {tab === "execution" && <ExecutionSection />}
        {tab === "access" && <AccessSection />}
        {tab === "chats" && <ChatsSection />}
        {tab === "backup" && <BackupSection />}
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

  // Stage one or more files into the upload queue. The raw File is kept and PUT
  // directly to S3 at upload time (no client-side read), so there is no size cap —
  // only the file type is validated here.
  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;
    let added = 0; const skipped: string[] = [];
    for (const f of arr) {
      const lower = f.name.toLowerCase();
      if (!ACCEPT_EXT.some((x) => lower.endsWith(x))) { skipped.push(`${f.name} (type)`); continue; }
      const item: QItem = {
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
        name: f.name, size: f.size, file: f, status: "queued",
      };
      setQueue((q) => [...q, item]);
      added++;
    }
    if (skipped.length) say(`Skipped ${skipped.length} (unsupported type): ${skipped.join(", ")}`, true);
    else if (added) say("");
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }
  function removeItem(id: string) { setQueue((q) => q.filter((x) => x.id !== id)); }

  // Upload every pending file plus an optional pasted doc. Each file is uploaded
  // directly to S3 via a presigned PUT (bypassing the Vercel proxy body cap), then
  // registered with the backend which pulls it from S3 and extracts the text. Each
  // file → one MASE document, named by filename. Failed items stay in the queue.
  async function uploadAll() {
    const pending = queue.filter((it) => it.status === "queued" || it.status === "error");
    const hasPaste = !!pasteText.trim() && !!pasteTitle.trim();
    if (!pending.length && !hasPaste) { say("Add one or more files, or paste text with a title.", true); return; }
    setBusy(true); say("");
    let ok = 0, fail = 0;
    for (const it of pending) {
      setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, status: "uploading", error: undefined } : x)));
      try {
        // 1. Get a presigned S3 PUT URL.
        const pres = await fetch("/api/deal-engine/knowledge/presign", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: it.name }),
        });
        const pj = await pres.json().catch(() => ({} as any));
        if (!pres.ok || !pj.url || !pj.key) throw new Error(pj.detail || pj.error || `presign failed (${pres.status})`);
        // 2. PUT the file straight to S3 (not through the proxy — no size limit).
        const put = await fetch(pj.url, { method: "PUT", body: it.file });
        if (!put.ok) throw new Error(`storage upload failed (${put.status})`);
        // 3. Register: backend pulls from S3, extracts text, chunks + embeds.
        const r = await fetch("/api/deal-engine/knowledge", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: it.name.replace(/\.[^.]+$/, ""), doc_type: docType, s3_key: pj.key, filename: it.name }),
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || j.error) { fail++; const msg = j.detail || j.error || `(${r.status})`; setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x))); }
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
        if (!r.ok || j.error) { fail++; say(j.detail || j.error || `Paste upload failed (${r.status})`, true); }
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
              <div className="kn-drop-sub">PDF, Word, Excel, PowerPoint, CSV, Markdown, TXT, JSON · multiple files · no size limit</div>
            </label>

            {queue.length > 0 && (
              <div className="kn-queue">
                <div className="kn-queue-head"><span>{queue.length} file{queue.length === 1 ? "" : "s"} staged</span></div>
                {queue.map((it) => (
                  <div key={it.id} className={`kn-file kn-q-${it.status}`}>
                    <span className="kn-file-badge">{(it.name.split(".").pop() || "DOC").toUpperCase().slice(0, 4)}</span>
                    <div className="kn-file-info">
                      <span className="kn-file-name">{it.name}</span>
                      <span className="kn-file-meta" title={it.status === "error" ? it.error : undefined}>
                        {it.status === "uploading" ? "Uploading…"
                          : it.status === "done" ? "✓ Uploaded"
                          : it.status === "error" ? `✕ ${it.error || "Failed"}`
                          : fmtSize(it.size)}
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

// ── 1b. Skills — admin-authored, load-on-demand procedures for the chat agent ──
// A skill is a named PROCEDURE (name + "when to use" description + Markdown body).
// The chat agent always sees the name+description index and pulls the full body via
// the load_skill tool only when a request matches. Distinct from Knowledge (data
// retrieved by similarity) — a skill is an instruction the agent follows. Admin-only
// on every verb (gated in the /api/deal-engine proxy). Backend: /api/deal-engine/skills.
const SKILL_EXT = [".skill", ".md", ".markdown", ".txt"];

function SkillsSection() {
  const [skills, setSkills] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteErr, setNoteErr] = useState(false);
  const say = (m: string, e = false) => { setNote(m); setNoteErr(e); };

  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pBody, setPBody] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const load = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await fetch(`/api/deal-engine/skills`, { cache: "no-store" });
      const j = await r.json();
      setSkills(Array.isArray(j) ? j : j.skills || []);
    } catch { setSkills([]); }
    setListLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) => SKILL_EXT.some((x) => f.name.toLowerCase().endsWith(x)));
    if (!arr.length) { say("Only .skill / .md / .txt files.", true); return; }
    setFiles((f) => [...f, ...arr]); say("");
  }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }
  // Send the file as BYTES (base64), never readAsText: a .skill is a ZIP bundle
  // (Anthropic layout: SKILL.md + references/*.md) and reading it as text produces
  // NUL bytes that Postgres rejects (22P05). The backend detects zip-vs-markdown.
  const readB64 = (file: File) => new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result || ""); res(s.slice(s.indexOf(",") + 1)); };
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });

  async function save() {
    const hasFiles = files.length > 0;
    const hasPaste = !!pName.trim() && !!pBody.trim();
    if (!hasFiles && !hasPaste) { say("Add a .skill/.md file, or fill in name + instructions.", true); return; }
    setBusy(true); say(""); let ok = 0, fail = 0;
    for (const f of files) {
      try {
        const b64 = await readB64(f);
        const r = await fetch("/api/deal-engine/skills", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_b64: b64, filename: f.name }),
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || j.error) { fail++; say(`${f.name}: ${j.error || `failed (${r.status})`}`, true); }
        else ok++;
      } catch (e: any) { fail++; say(e?.message || String(e), true); }
    }
    if (hasPaste) {
      try {
        const r = await fetch("/api/deal-engine/skills", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: pName.trim(), description: pDesc.trim(), content: pBody }),
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || j.error) { fail++; say(j.error || `Save failed (${r.status})`, true); }
        else { ok++; setPName(""); setPDesc(""); setPBody(""); }
      } catch (e: any) { fail++; say(e?.message || String(e), true); }
    }
    setBusy(false); setFiles([]); void load();
    if (fail === 0) setModalOpen(false);
  }

  async function toggle(s: any) {
    setTogglingId(s.id);
    try {
      await fetch(`/api/deal-engine/skills/${encodeURIComponent(s.id)}/enabled`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      await load();
    } catch { /* ignore */ }
    setTogglingId(null);
  }

  async function del(s: any) {
    if (!window.confirm(`Delete skill "${s.name}"? The chat agent will no longer be able to load it.`)) return;
    setDeletingId(s.id);
    try { const r = await fetch(`/api/deal-engine/skills/${encodeURIComponent(s.id)}`, { method: "DELETE" }); if (r.ok) await load(); } catch { /* ignore */ }
    setDeletingId(null);
  }

  async function view(s: any) {
    setViewing({ ...s, body: undefined }); setViewLoading(true);
    try {
      const r = await fetch(`/api/deal-engine/skills/${encodeURIComponent(s.id)}`, { cache: "no-store" });
      const j = await r.json();
      setViewing(r.ok && !j.error ? j : { ...s, body: `Couldn't load (${j.error || r.status}).` });
    } catch (e: any) { setViewing({ ...s, body: `Couldn't load (${e?.message || e}).` }); }
    setViewLoading(false);
  }

  return (
    <div className="admin-card">
      <div className="kn-head">
        <div>
          <h3>Skills</h3>
          <p className="admin-desc" style={{ marginBottom: 0 }}>Reusable procedures the chat agent loads on demand. Upload a <b>.skill</b> or <b>.md</b> file (with an optional <code>name</code> / <code>description</code> frontmatter) or write one below. The agent sees each skill&rsquo;s name + &ldquo;when to use&rdquo; and loads the full instructions via <code>load_skill</code> when a request matches.</p>
        </div>
        <button className="admin-btn primary kn-add" onClick={() => { setFiles([]); say(""); setModalOpen(true); }}>+ Add skill</button>
      </div>

      <div className="kn-list-head">
        <h4 style={{ margin: 0, fontSize: 13.5 }}>Skills <span className="admin-meta">({listLoading ? "…" : skills.length})</span></h4>
        <button className="admin-btn kn-refresh" onClick={() => void load()} disabled={listLoading} title="Refresh">↻</button>
      </div>
      <div className="admin-doclist">
        {skills.length === 0 && !listLoading ? (
          <div className="admin-meta" style={{ padding: "18px 14px" }}>No skills yet. Click <b>+ Add skill</b> to upload a .skill/.md file or write one.</div>
        ) : skills.map((s, i) => (
          <div key={s.id || i} className="admin-docrow kn-docrow-click" onClick={() => void view(s)} title="View instructions">
            <span className="admin-docname">
              {s.name}
              {s.description && <span className="admin-meta" style={{ display: "block", fontWeight: 400, marginTop: 2 }}>{s.description}</span>}
            </span>
            <span className="kn-row-meta">
              <label className="kn-badge" onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer", opacity: togglingId === s.id ? 0.5 : 1 }} title={s.enabled ? "Enabled — the agent can load this skill" : "Disabled — hidden from the agent"}>
                <input type="checkbox" checked={!!s.enabled} onChange={() => void toggle(s)} disabled={togglingId === s.id} style={{ marginRight: 4, verticalAlign: "middle" }} />
                {s.enabled ? "on" : "off"}
              </label>
              <button className="kn-del" onClick={(e) => { e.stopPropagation(); void del(s); }} disabled={deletingId === s.id} title="Delete skill" aria-label="Delete skill">
                {deletingId === s.id ? "…" : "Delete"}
              </button>
            </span>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="kn-modal-overlay" onClick={() => { if (!busy) setModalOpen(false); }}>
          <div className="kn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kn-modal-head">
              <h3>Add skill</h3>
              <button className="kn-file-x" onClick={() => { if (!busy) setModalOpen(false); }} aria-label="Close">✕</button>
            </div>
            <p className="admin-desc">Upload <b>.skill</b> / <b>.md</b> file(s) — a leading <code>--- name / description ---</code> frontmatter is honoured, otherwise the first heading + line are used. Or write one directly below.</p>

            <label
              className={`kn-drop ${dragActive ? "drag" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <input type="file" accept={SKILL_EXT.join(",")} multiple hidden onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
              <div className="kn-drop-main">Drag &amp; drop .skill / .md files, or <span className="kn-link">browse</span></div>
              <div className="kn-drop-sub">{files.length ? `${files.length} file(s) staged: ${files.map((f) => f.name).join(", ")}` : "an optional name / description frontmatter is honoured"}</div>
            </label>

            <div style={{ margin: "14px 0 8px", fontSize: 12.5, fontWeight: 600, opacity: 0.6, textAlign: "center" }}>— or write one —</div>
            <label className="kn-field"><span>Name</span><input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. RFP Response" /></label>
            <label className="kn-field"><span>When to use (description)</span><input value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="e.g. When a user asks how to respond to or submit an RFP" /></label>
            <label className="kn-field"><span>Instructions (Markdown)</span>
              <textarea value={pBody} onChange={(e) => setPBody(e.target.value)} rows={8} placeholder="The step-by-step procedure the agent should follow…" style={{ width: "100%", fontFamily: "inherit", resize: "vertical" }} />
            </label>

            {note && <div style={{ marginTop: 8, fontSize: 12.5, color: noteErr ? "#c0392b" : "inherit" }}>{note}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="admin-btn" onClick={() => { if (!busy) setModalOpen(false); }} disabled={busy}>Cancel</button>
              <button className="admin-btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save skill"}</button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className="kn-modal-overlay" onClick={() => setViewing(null)}>
          <div className="kn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kn-modal-head">
              <h3>{viewing.name}</h3>
              <button className="kn-file-x" onClick={() => setViewing(null)} aria-label="Close">✕</button>
            </div>
            {viewing.description && <p className="admin-desc">{viewing.description}</p>}
            {viewLoading ? <div className="admin-meta">Loading…</div> : <pre className="kn-view-pre">{viewing.body || "(empty)"}</pre>}
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
function PromptEditor({ endpoint, heading, description, governanceNote, saveLabel, savedMsg, rows = 18 }: {
  endpoint: string; heading: string; description: string; governanceNote?: string; saveLabel: string; savedMsg: string; rows?: number;
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
    // A pasted prompt sometimes still carries the disk-seed DEPRECATION banner (a
    // leading <!-- ... --> block). It must never enter the live prompt — the agent
    // would literally read "this file is deprecated" as its opening line (that
    // exact bug shipped once). Strip ONE leading HTML comment before saving; the
    // backend does the same server-side.
    const t = value.trimStart();
    if (t.startsWith("<!--")) {
      const end = t.indexOf("-->");
      if (end !== -1) value = t.slice(end + 3).trimStart();
    }
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
      <h3>{heading} {isOverride
        ? <span className="ap-tag ap-custom">live — supabase override</span>
        : <span className="ap-tag">shipped default (no override)</span>}</h3>
      <p className="admin-desc">{description}</p>
      {governanceNote && <p className="admin-desc" style={{ color: "var(--accent)" }}>{governanceNote}</p>}
      {loading ? <div className="admin-meta">Loading…</div> : (
        <>
          <textarea className="admin-textarea mono" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={rows} />
          <div className="admin-actions">
            <button className="admin-btn primary" onClick={() => save(prompt)} disabled={saving || !dirty}>{saving ? "Saving…" : saveLabel}</button>
            <button className="admin-btn" onClick={() => save("")} disabled={saving}>Reset to default</button>
            <span className="admin-meta">{prompt.length.toLocaleString()} chars</span>
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
      governanceNote="What the sweep actually runs = THIS text + the LOCKED Omnivision engine instructions (Signal Extraction · Win Position · Momentum · To-Dos · 24h Summary) appended after it as the authoritative final section — where they conflict, the locked instructions win. Locked versions are managed in Omnivision (super-admin) and every swept record is stamped with the versions that governed it."
      saveLabel="Save sweep prompt"
      savedMsg="Saved — applies to the next opportunity swept."
      rows={28}
    />
  );
}

// The RevOps Chat agent's system prompt — the conversational agent over the book.
// It now retrieves from the SHARED MASE knowledge base (search_knowledge) and can
// delegate a drafting to-do to the Todo Runner (run_todo); the book + a fixed tools
// block are appended automatically, so this edits only the base persona/strategy.
// Stored in Supabase (key mase_chat_agent).
function ChatAgentSection() {
  return (
    <PromptEditor
      endpoint="/api/deal-engine/chat/prompt"
      heading="Chat agent system prompt"
      description="Governs the RevOps chat agent that reasons over the whole book. It shares the SAME knowledge base as the other agents (search_knowledge) and can delegate a tactical email-drafting to-do to the Todo Runner (run_todo) — it knows what the Todo Runner can and can't do. The book of deals and the tools/capabilities block are appended automatically, so this edits only the base persona/strategy. Stored in Supabase, applied on the next chat message — no redeploy. Leave empty + save to fall back to the built-in default."
      saveLabel="Save chat prompt"
      savedMsg="Saved — applies to the next chat message."
      rows={18}
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

// Rerun the Deal Intelligence sweep for a selection. Mirrors the backend
// POST /api/deal-engine/sweep/rerun selectors (exactly one of: all | failed | by
// forecast category | by owner | one opp). Enqueues into the same queue the worker
// drains (datalake + temporal anchoring); the worker AUTOSCALER sizes the fleet to
// the backlog, so nobody scales workers by hand. The forecast/owner option lists are
// the real values from the tracked book (record.hard.forecast_category / owner_name),
// so they match what the backend filters on. Admin-gated at the proxy.
type RerunScope = "failed" | "all" | "forecast" | "owner" | "opp";
const FIELD_STYLE: CSSProperties = {
  font: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--ink)",
};
function RerunCard({ onDone }: { onDone: () => void }) {
  const { records } = useDashboard();
  const [scope, setScope] = useState<RerunScope>("failed");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const forecastOpts = useMemo(
    () => (uniqSorted((records as Rec[]).map((r) => (r.hard || {}).forecast_category)) as string[]).filter(Boolean),
    [records]
  );
  const ownerOpts = useMemo(
    () => (uniqSorted((records as Rec[]).map((r) => (r.hard || {}).owner_name)) as string[]).filter(Boolean),
    [records]
  );

  const needsValue = scope === "forecast" || scope === "owner" || scope === "opp";
  const canRun = !busy && (!needsValue || value.trim().length > 0);
  const v = value.trim();
  const label =
    scope === "all" ? "ALL tracked deals" :
    scope === "failed" ? "all failed runs" :
    scope === "forecast" ? `forecast “${v}”` :
    scope === "owner" ? `${v}’s book` :
    `opp ${v}`;

  function body(): Record<string, unknown> | null {
    if (scope === "all") return { all: true };
    if (scope === "failed") return { status: "failed" };
    if (!v) return null;
    if (scope === "forecast") return { forecast: v };
    if (scope === "owner") return { owner: v };
    return { opp_id: v };
  }

  async function run() {
    const b = body();
    if (!b) return;
    // Confirm the broad selections — they can enqueue hundreds of sweeps.
    const broad = scope === "all" || scope === "owner" || scope === "forecast";
    if (broad && !confirm(`Rerun the sweep for ${label}? The worker fleet autoscales to the backlog.`)) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch("/api/deal-engine/sweep/rerun", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
      const j = await r.json().catch(() => ({}));
      // 409 = a book sweep is already in flight; 400 = bad selector; 403 = not admin.
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      const n = typeof j?.count === "number" ? `${j.count} deal${j.count === 1 ? "" : "s"} queued` : "accepted";
      setResult({ kind: "ok", text: `Queued — ${label} (${n}). Workers autoscaling to the backlog…` });
      onDone();
    } catch (e) {
      setResult({ kind: "err", text: e instanceof Error ? e.message : "Rerun failed" });
    }
    setBusy(false);
  }

  return (
    <div className="admin-card">
      <h3>Rerun sweeps</h3>
      <p className="admin-desc">
        Re-run the Deal Intelligence sweep for a selection. It enqueues into the same
        queue the worker drains (datalake Avoma + temporal anchoring); the worker{" "}
        <b>autoscaler sizes the fleet automatically</b> — you never scale workers by hand.
      </p>
      <div className="admin-actions" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select
          style={FIELD_STYLE}
          value={scope}
          onChange={(e) => { setScope(e.target.value as RerunScope); setValue(""); setResult(null); }}
        >
          <option value="failed">Failed runs only</option>
          <option value="all">All tracked deals</option>
          <option value="forecast">By forecast category</option>
          <option value="owner">By owner</option>
          <option value="opp">One opportunity</option>
        </select>

        {scope === "forecast" && (
          <select style={FIELD_STYLE} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select forecast…</option>
            {forecastOpts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {scope === "owner" && (
          <select style={FIELD_STYLE} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select owner…</option>
            {ownerOpts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {scope === "opp" && (
          <input
            style={{ ...FIELD_STYLE, minWidth: 240 }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="006… Opportunity id"
          />
        )}

        <button className="admin-btn primary" onClick={run} disabled={!canRun}>
          {busy ? "Queuing…" : "↻ Rerun"}
        </button>
      </div>
      {result && (
        <div className="admin-meta" style={{ marginTop: 10, color: result.kind === "err" ? "var(--red-ink)" : "var(--green-ink)" }}>
          {result.text}
        </div>
      )}
    </div>
  );
}

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

      {/* Rerun sweeps — bulk / filtered / per-opp, autoscaled */}
      <RerunCard onDone={load} />

      {/* Avoma → Datalake transcript sync (logging view) */}
      <DatalakeSyncCard />

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

// ── 3b. Calls — datalake (Avoma) meeting explorer ───────────────────────────
// Filter the Avoma datalake by date range + opportunity. Admin-gated route reads the
// datalake directly (DATALAKE_URL / DATALAKE_SERVICE_KEY on the server).
type DLCall = {
  uuid: string; subject: string | null; start_at: string | null; is_internal: boolean | null;
  is_call: boolean | null; state: string | null; transcript_ready: boolean | null;
  duration: number | null; crm_opportunity_id: string | null; crm_account_id: string | null;
  attendee_domains: string[] | null;
};
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function CallsSection() {
  const { records } = useDashboard();
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [oppId, setOppId] = useState("");
  const [subject, setSubject] = useState("");
  const [internal, setInternal] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [rows, setRows] = useState<DLCall[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const oppOpts: Opt[] = useMemo(
    () => (records as Rec[])
      .map((r) => ({ value: r.opp_id as string, label: `${(r.hard || {}).account_name} — ${(r.hard || {}).opp_name}` }))
      .filter((o) => o.value)
      .sort((a, b) => a.label.localeCompare(b.label)),
    [records]
  );

  const run = useCallback(async (over?: { from?: string; to?: string }) => {
    const f = over?.from ?? from;
    const t = over?.to ?? to;
    setLoading(true); setErr(null);
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    if (oppId) p.set("opp_id", oppId);
    if (subject.trim()) p.set("subject", subject.trim());
    if (internal) p.set("internal", "1");
    if (cancelled) p.set("cancelled", "1");
    try {
      const r = await fetch(`/api/admin/datalake-calls?${p.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Error ${r.status}`); setRows([]); }
      else setRows(j.rows || []);
    } catch (e: any) { setErr(e?.message || String(e)); setRows([]); }
    setLoading(false);
  }, [from, to, oppId, subject, internal, cancelled]);

  useEffect(() => { void run(); }, []); // initial load (last 30 days)

  function exportCsv() {
    if (!rows || !rows.length) return;
    const head = ["date", "subject", "type", "state", "internal", "transcript", "duration_min", "opp_id", "account_id", "attendee_domains"];
    const lines = [head.join(",")];
    for (const m of rows) {
      const vals = [
        String(m.start_at || "").slice(0, 16).replace("T", " "),
        `"${String(m.subject || "").replace(/"/g, '""')}"`,
        m.is_call ? "call" : "meeting",
        m.state || "",
        m.is_internal ? "internal" : "external",
        m.transcript_ready ? "yes" : "no",
        m.duration ? Math.round(m.duration / 60) : "",
        m.crm_opportunity_id || "",
        m.crm_account_id || "",
        `"${(m.attendee_domains || []).join("; ")}"`,
      ];
      lines.push(vals.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = window.URL.createObjectURL(blob);
    a.download = `datalake_calls_${from}_${to}.csv`;
    a.click();
  }

  return (
    <div className="admin-card">
      <h3>Calls — Avoma datalake</h3>
      <p className="admin-desc">Filter the Avoma datalake (the single source of truth for meetings) by date range and opportunity. Excludes internal &amp; cancelled by default.</p>
      <div className="admin-actions" style={{ gap: 6, marginBottom: 8, alignItems: "center" }}>
        <span className="admin-meta">Quick range:</span>
        {([["Last 7 days", 7], ["Last 30 days", 30], ["Last 60 days", 60], ["Last 90 days", 90]] as [string, number][]).map(([lbl, d]) => {
          const f = isoDay(new Date(Date.now() - d * 86400000));
          const active = from === f && to === isoDay(new Date());
          return (
            <button key={lbl} className={`admin-btn ${active ? "primary" : ""}`}
              onClick={() => { const t = isoDay(new Date()); setFrom(f); setTo(t); void run({ from: f, to: t }); }}>
              {lbl}
            </button>
          );
        })}
      </div>
      <div className="admin-actions" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={FIELD_STYLE} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={FIELD_STYLE} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>Opportunity
          <MultiSelect single allLabel="All opportunities" options={oppOpts} selected={oppId ? [oppId] : []} onChange={(v) => setOppId(v[0] || "")} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>Subject contains
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="(optional)" style={{ ...FIELD_STYLE, minWidth: 160 }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> incl. internal
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} /> incl. cancelled
        </label>
        <button className="admin-btn primary" onClick={() => void run()} disabled={loading}>{loading ? "Loading…" : "Search"}</button>
        {rows && rows.length > 0 && <button className="admin-btn" onClick={exportCsv}>Export CSV</button>}
      </div>

      {err && <div className="admin-note err" style={{ marginTop: 10 }}>{err}</div>}
      {rows && (
        <div style={{ marginTop: 12 }}>
          <div className="admin-meta" style={{ marginBottom: 6 }}>{rows.length} call{rows.length === 1 ? "" : "s"}{rows.length >= 2000 ? " (capped at 2000)" : ""}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                  {["Date", "Subject", "Type", "State", "Tx", "Min", "Domains", "Opp"].map((h) => (
                    <th key={h} style={{ padding: "6px 8px", fontSize: 11, textTransform: "uppercase", color: "var(--muted-ink, #888)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="admin-meta" style={{ padding: "14px 8px" }}>No calls match these filters.</td></tr>
                ) : rows.map((m) => (
                  <tr key={m.uuid} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{String(m.start_at || "").slice(0, 16).replace("T", " ")}</td>
                    <td style={{ padding: "6px 8px" }}>{m.subject || "—"}{m.is_internal ? <span className="admin-meta"> · internal</span> : null}</td>
                    <td style={{ padding: "6px 8px" }}>{m.is_call ? "call" : "meeting"}</td>
                    <td style={{ padding: "6px 8px", color: m.state === "cancelled" ? "var(--red-ink)" : undefined }}>{m.state || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{m.transcript_ready ? "✓" : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{m.duration ? Math.round(m.duration / 60) : "—"}</td>
                    <td style={{ padding: "6px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={(m.attendee_domains || []).join(", ")}>{(m.attendee_domains || []).filter((d) => !String(d).includes("zycus")).join(", ") || "—"}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 11 }}>{String(m.crm_opportunity_id || "").slice(0, 15) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 4. Access & Config ──────────────────────────────────────────────────────
// Chat access policy: choose WHO can use the RevOps Chat — Admins only, Everyone, or
// a Specific allowlist of emails. Backed by /api/admin/chat-access (GET open for the
// caller's own access; POST admin-only) → app_config. Admins can always use chat; the
// chat agent's SYSTEM PROMPT editor stays admin-only regardless of this setting.
type ChatMode = "admins" | "everyone" | "allowlist";
const CHAT_MODES: { key: ChatMode; label: string; desc: string }[] = [
  { key: "admins", label: "Admins only", desc: "Only admins can use chat (default)." },
  { key: "everyone", label: "Everyone", desc: "Every signed-in MASE user can use chat." },
  { key: "allowlist", label: "Specific people", desc: "Only the people you select below." },
];
// The MASE user roster (the same allow-list that governs who can sign in) → picker
// options. Admins always have chat, so they don't need selecting here.
const CHAT_PEOPLE: Opt[] = Object.entries(EMAIL_TO_OWNER)
  .filter(([email]) => !ADMIN_EMAILS.has(email))
  .map(([email, name]) => ({ value: email, label: `${name} — ${email}` }))
  .sort((a, b) => a.label.localeCompare(b.label));

function ChatAccessCard() {
  const [mode, setMode] = useState<ChatMode | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/chat-access", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { setMode((j.mode as ChatMode) || "admins"); setEmails(Array.isArray(j.emails) ? j.emails : []); })
      .catch(() => { setMode("admins"); setEmails([]); });
  }, []);

  async function save(nextMode: ChatMode, nextEmails: string[]) {
    setSaving(true); setNote(null);
    try {
      const r = await fetch("/api/admin/chat-access", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: nextMode, emails: nextEmails }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setNote(j.error || `Error ${r.status}`); }
      else {
        setMode((j.mode as ChatMode) || nextMode);
        setEmails(Array.isArray(j.emails) ? j.emails : nextEmails);
        setNote("Saved.");
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setSaving(false);
  }

  function changeMode(m: ChatMode) { if (m !== mode) { setMode(m); void save(m, emails); } }
  function selectPeople(next: string[]) { setEmails(next); void save(mode || "allowlist", next); }
  function removeEmail(e: string) { selectPeople(emails.filter((x) => x !== e)); }

  return (
    <div className="admin-card">
      <h3>Chat access</h3>
      <p className="admin-desc">
        Choose who can use the RevOps strategist <b>Chat</b>. Admins can always use it; the chat
        agent&apos;s system-prompt editor stays admin-only regardless of this setting.
      </p>

      <div className="admin-actions" style={{ flexWrap: "wrap", gap: 8 }}>
        {CHAT_MODES.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              className={`admin-btn ${active ? "primary" : ""}`}
              onClick={() => changeMode(m.key)}
              disabled={mode == null || saving}
              title={m.desc}
            >
              {active ? "● " : ""}{m.label}
            </button>
          );
        })}
        {saving && <span className="admin-meta">saving…</span>}
      </div>
      <p className="admin-meta" style={{ marginTop: 6 }}>
        {mode == null ? "Loading…" : CHAT_MODES.find((m) => m.key === mode)?.desc}
      </p>

      {mode === "allowlist" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>People with chat access</span>
            <MultiSelect
              allLabel="Select people…"
              options={CHAT_PEOPLE}
              selected={emails}
              onChange={selectPeople}
            />
            <span className="admin-meta">{emails.length} selected</span>
          </div>
          <div className="admin-doclist" style={{ marginTop: 10 }}>
            {emails.length === 0 ? (
              <div className="admin-meta" style={{ padding: "12px 14px" }}>No one selected yet. Pick the people who should get chat.</div>
            ) : emails.map((e) => (
              <div key={e} className="admin-docrow">
                <span className="admin-docname">{EMAIL_TO_OWNER[e] ? `${EMAIL_TO_OWNER[e]} — ${e}` : e}</span>
                <button className="kn-del" onClick={() => removeEmail(e)} disabled={saving} title="Remove" aria-label="Remove person">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {note && <div className="admin-meta" style={{ marginTop: 10 }}>{note}</div>}
    </div>
  );
}

function AccessSection() {
  const admins = Array.from(ADMIN_EMAILS).sort();
  return (
    <>
      <ChatAccessCard />
    <div className="admin-card">
      <h3>Admins ({admins.length})</h3>
      <p className="admin-desc">Full-access users (whole book + this Agent Control page + Runs/Learning/Sync Quality). The list is defined in <code>lib/engine/helpers.ts</code> (ADMIN_EMAILS); a DB-backed add/remove from this page is a planned upgrade.</p>
      <div className="admin-doclist">
        {admins.map((e) => <div key={e} className="admin-docrow"><span className="admin-docname">{e}</span></div>)}
      </div>
      <h3 style={{ marginTop: 24 }}>Agent model</h3>
      <p className="admin-desc">Runs on <code>claude-opus-4-8</code> (server-configured). Model/tool configuration is managed in the backend; surfacing it here is a planned upgrade.</p>
    </div>
    </>
  );
}

// ── 5. Chats — every user's saved conversations, grouped by user ─────────────
// Both chat types live in mase_chats: general RevOps chats (sidebar) and per-deal
// "Ask AI" chats (title marked "[deal:<oid>]"). RLS scopes rows to their owner, so
// this reads via the admin service-role route /api/admin/chats. Each user is an
// accordion; a chat opens a read-only transcript (fetched on demand).
type AdminChat = { id: string; type: "deal" | "general"; oid: string | null; title: string; created_at: string | null; updated_at: string | null };
type AdminChatUserRow = { user_id: string; email: string | null; name: string | null; chatCount: number; lastActivity: string | null; chats: AdminChat[] };

function ChatsSection() {
  const [users, setUsers] = useState<AdminChatUserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/chats", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Error ${r.status}`); setUsers([]); }
      else setUsers(Array.isArray(j.users) ? j.users : []);
    } catch (e: any) { setErr(e?.message || String(e)); setUsers([]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleUser = (uid: string) => setExpanded((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });

  async function openChat(c: AdminChat) {
    setViewing({ ...c, messages: undefined }); setViewLoading(true);
    try {
      const r = await fetch(`/api/admin/chats/${encodeURIComponent(c.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && !j.error) setViewing(j);
      else setViewing({ ...c, messages: [], _err: j.error || `Error ${r.status}` });
    } catch (e: any) { setViewing({ ...c, messages: [], _err: e?.message || String(e) }); }
    setViewLoading(false);
  }

  const totalChats = (users || []).reduce((n, u) => n + u.chatCount, 0);
  const TypeBadge = ({ t }: { t: "deal" | "general" }) => <span className={`chat-type ${t}`}>{t === "deal" ? "Deal" : "Chat"}</span>;

  return (
    <div className="admin-card">
      <div className="kn-head">
        <div>
          <h3>Chats</h3>
          <p className="admin-desc" style={{ marginBottom: 0 }}>Every user&rsquo;s saved conversations — both the RevOps <b>Chat</b> (sidebar) and per-<b>Deal</b> &ldquo;Ask AI&rdquo; chats. Expand a user, then click a chat to read the full transcript.</p>
        </div>
        <button className="admin-btn kn-refresh" onClick={() => void load()} disabled={loading} title="Refresh">↻</button>
      </div>

      <div className="kn-list-head">
        <h4 style={{ margin: 0, fontSize: 13.5 }}>Users <span className="admin-meta">({loading && !users ? "…" : (users?.length || 0)})</span></h4>
        <span className="admin-meta">{totalChats} chat{totalChats === 1 ? "" : "s"}</span>
      </div>
      {err && <div className="admin-note err" style={{ marginBottom: 8 }}>{err}</div>}

      <div className="admin-doclist">
        {(!users || users.length === 0) && !loading ? (
          <div className="admin-meta" style={{ padding: "18px 14px" }}>No chats found.</div>
        ) : (users || []).map((u) => {
          const open = expanded.has(u.user_id);
          const label = u.name || u.email || u.user_id;
          return (
            <div key={u.user_id} className="chat-acc">
              <div className="admin-docrow chat-acc-head" onClick={() => toggleUser(u.user_id)} title={open ? "Collapse" : "Expand"}>
                <span className="admin-docname">
                  <span className="chat-chev" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
                  <b>{label}</b>
                  {u.name && u.email ? <span className="admin-meta" style={{ marginLeft: 8 }}>{u.email}</span> : null}
                </span>
                <span className="admin-meta">{u.chatCount} chat{u.chatCount === 1 ? "" : "s"}{u.lastActivity ? ` · ${String(u.lastActivity).slice(0, 10)}` : ""}</span>
              </div>
              {open ? (
                <div className="chat-acc-body">
                  {u.chats.length === 0 ? <div className="admin-meta" style={{ padding: "8px 14px" }}>No chats.</div> : u.chats.map((c) => (
                    <div key={c.id} className="admin-docrow kn-docrow-click chat-row" onClick={() => void openChat(c)} title="View transcript">
                      <span className="admin-docname"><TypeBadge t={c.type} /> {c.title}</span>
                      <span className="kn-row-meta">
                        {c.type === "deal" && c.oid ? <a href={`/deals/${encodeURIComponent(c.oid)}`} className="admin-meta chat-deal-link" onClick={(e) => e.stopPropagation()} title="Open the deal">deal ↗</a> : null}
                        {c.updated_at ? <span className="admin-meta">{String(c.updated_at).slice(0, 10)}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Transcript viewer */}
      {viewing && (
        <div className="kn-modal-overlay" onClick={() => setViewing(null)}>
          <div className="kn-modal kn-view" onClick={(e) => e.stopPropagation()}>
            <div className="kn-modal-head">
              <div className="kn-view-title">
                <h3>{viewing.title || "Chat"}</h3>
                <div className="kn-view-sub">
                  <TypeBadge t={viewing.type === "deal" ? "deal" : "general"} />
                  {(viewing.name || viewing.email) && <span className="admin-meta">{viewing.name || viewing.email}</span>}
                  {Array.isArray(viewing.messages) && <span className="admin-meta">{viewing.messages.length} message{viewing.messages.length === 1 ? "" : "s"}</span>}
                  {viewing.updated_at && <span className="admin-meta">{String(viewing.updated_at).slice(0, 10)}</span>}
                  {viewing.type === "deal" && viewing.oid ? <a href={`/deals/${encodeURIComponent(viewing.oid)}`} className="admin-meta chat-deal-link">open deal ↗</a> : null}
                </div>
              </div>
              <button className="kn-file-x" onClick={() => setViewing(null)} aria-label="Close">✕</button>
            </div>
            <div className="kn-view-body">
              {viewLoading ? (
                <div className="admin-meta" style={{ padding: "20px 4px" }}>Loading transcript…</div>
              ) : viewing._err ? (
                <div className="admin-note err">Couldn&rsquo;t load transcript ({viewing._err}).</div>
              ) : !Array.isArray(viewing.messages) || viewing.messages.length === 0 ? (
                <div className="admin-meta" style={{ padding: "16px 4px" }}>(empty conversation)</div>
              ) : (
                <div className="chat-transcript">
                  {viewing.messages.map((m: any, i: number) => {
                    const role = String(m?.role || "").toLowerCase() === "user" ? "user" : "assistant";
                    const content = typeof m?.content === "string" ? m.content : (m?.content == null ? "" : JSON.stringify(m.content));
                    if (!content.trim()) return null;
                    return (
                      <div key={i} className={`ct-msg ct-${role}`}>
                        <div className="ct-role">{role === "user" ? "User" : "Assistant"}</div>
                        <div className="ct-content">{content}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
