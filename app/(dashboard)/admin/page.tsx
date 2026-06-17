"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";

// Admin → Agent Control. The single place admins manage the task-completion
// agent: its KNOWLEDGE (uploaded docs), its INSTRUCTIONS (system prompt), its
// EXECUTION (runs + sweep), and access. Admin-only — the page gates on
// realIsAdmin and the nav tab is hidden for everyone else; the /api/documents
// and /api/deal-engine/chat/prompt proxies enforce admin server-side too.

// Known knowledge corpora (Supabase project_ids). Uploaded docs are scoped to a
// project; the agent's search_knowledge tool retrieves within the active project.
const CORPORA = [
  { id: "87f864e2-50bf-4015-a0f8-4ed7426b2a50", label: "Bite Size 2.0" },
  { id: "22fbcc90-f594-4fd3-978c-26b9efeced11", label: "Bite Size v1" },
];
const DOC_TYPES = ["playbook", "guide", "email_template", "transcript", "showpad_asset", "other"];
const TEXT_EXT = [".txt", ".md", ".markdown", ".csv", ".json", ".html"];

export default function AdminPage() {
  const { realIsAdmin } = useDashboard();
  if (!realIsAdmin)
    return (
      <div className="dq-lock"><div className="dq-lock-card">
        <div className="dq-lock-ttl">🔒 Admin</div>
        <div className="dq-lock-sub">Agent control is restricted to admins.</div>
      </div></div>
    );
  return <AdminInner />;
}

function AdminInner() {
  const [tab, setTab] = useState<"docs" | "instructions" | "execution" | "access">("docs");
  return (
    <div id="adminview">
      <div className="todo-top"><div className="ttl"><b>Agent Control</b> — manage the task-completion agent: knowledge, instructions, execution, and access.</div></div>
      <div className="admin-tabs">
        {([["docs", "Knowledge"], ["instructions", "Instructions"], ["execution", "Execution"], ["access", "Access & Config"]] as const).map(([k, label]) => (
          <button key={k} className={`admin-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="admin-body">
        {tab === "docs" && <DocumentsSection />}
        {tab === "instructions" && <InstructionsSection />}
        {tab === "execution" && <ExecutionSection />}
        {tab === "access" && <AccessSection />}
      </div>
    </div>
  );
}

// ── 1. Knowledge / Documents ───────────────────────────────────────────────
function DocumentsSection() {
  const [corpus, setCorpus] = useState(CORPORA[0].id);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const loadDocs = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await fetch(`/api/documents?project_id=${encodeURIComponent(corpus)}`, { cache: "no-store" });
      const j = await r.json();
      setDocs(Array.isArray(j) ? j : j.documents || j.rows || []);
    } catch { setDocs([]); }
    setListLoading(false);
  }, [corpus]);
  useEffect(() => { void loadDocs(); }, [loadDocs]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!TEXT_EXT.some((x) => lower.endsWith(x))) {
      setNote(`Only text files (${TEXT_EXT.join(", ")}) + paste are supported in v1. PDF/DOCX extraction is coming with the ingestion upgrade — for now paste the text.`);
      return;
    }
    if (f.size > 2_000_000) { setNote("File too large (>2 MB of text). Split it."); return; }
    const reader = new FileReader();
    reader.onload = () => { setContent(String(reader.result || "")); setFileName(f.name); if (!title) setTitle(f.name.replace(/\.[^.]+$/, "")); setNote(null); };
    reader.readAsText(f);
  }

  async function upload() {
    if (!content.trim()) { setNote("Add content (upload a text file or paste)."); return; }
    if (!title.trim()) { setNote("Give the document a title."); return; }
    setBusy(true); setNote(null);
    try {
      // doc_type is encoded into the name until the document_chunks schema gains a
      // doc_type column (P1) — so it stays visible/filterable in retrieval results.
      const name = `[${docType}] ${title.trim()}`;
      const r = await fetch("/api/documents/upload", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, content, project_id: corpus }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setNote(j.error || `Upload failed (${r.status})`);
      else {
        setNote(`Uploaded "${name}" — chunked + embedded into the corpus.`);
        setTitle(""); setContent(""); setFileName("");
        void loadDocs();
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setBusy(false);
  }

  return (
    <div className="admin-card">
      <h3>Upload knowledge</h3>
      <p className="admin-desc">Docs you upload here are chunked, embedded, and stored in the chosen corpus — the agent retrieves them via search_knowledge when completing tasks. Tag the type so retrieval can route by it.</p>
      <div className="admin-row">
        <label>Corpus
          <select value={corpus} onChange={(e) => setCorpus(e.target.value)}>
            {CORPORA.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>Type
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="grow">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Enterprise objection-handling playbook" />
        </label>
      </div>
      <div className="admin-row">
        <input type="file" accept={TEXT_EXT.join(",")} onChange={onFile} />
        {fileName && <span className="admin-meta">{fileName} · {content.length.toLocaleString()} chars</span>}
      </div>
      <textarea className="admin-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder="…or paste the document text here" rows={8} />
      <div className="admin-actions">
        <button className="admin-btn primary" onClick={upload} disabled={busy}>{busy ? "Uploading…" : "Upload to corpus"}</button>
        {note && <span className="admin-note">{note}</span>}
      </div>

      <h3 style={{ marginTop: 24 }}>Documents in corpus {listLoading ? "…" : `(${docs.length})`}</h3>
      <div className="admin-doclist">
        {docs.length === 0 && !listLoading ? <div className="admin-meta">No documents in this corpus yet.</div> :
          docs.slice(0, 200).map((d, i) => (
            <div key={d.id || i} className="admin-docrow"><span className="admin-docname">{d.name || d.title || d.id}</span></div>
          ))}
      </div>
    </div>
  );
}

// ── 2. Instructions (system prompt) ─────────────────────────────────────────
function InstructionsSection() {
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
      const r = await fetch("/api/deal-engine/chat/prompt", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) setNote(j.error || `Error ${r.status}`);
      else {
        const p = j.is_override ? (j.prompt || "") : (j.default || "");
        setPrompt(p); setServerPrompt(p); setDefaultPrompt(j.default || ""); setIsOverride(!!j.is_override);
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(value: string) {
    setSaving(true); setNote(null);
    try {
      const r = await fetch("/api/deal-engine/chat/prompt", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setNote(j.error || `Error ${r.status}`);
      else {
        const applied = value.trim() ? value : defaultPrompt;
        setServerPrompt(applied); setPrompt(applied); setIsOverride(!!j.is_override);
        setNote(value.trim() ? "Saved — applies to every agent run on the next message." : "Reset to the built-in default.");
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setSaving(false);
  }

  const dirty = prompt !== serverPrompt;
  return (
    <div className="admin-card">
      <h3>Agent instructions {isOverride && <span className="ap-tag ap-custom">custom</span>}</h3>
      <p className="admin-desc">The system prompt that governs how the agent behaves for everyone. Edits apply to the next message of every run. Leave empty + save to reset to the built-in default.</p>
      {loading ? <div className="admin-meta">Loading…</div> : (
        <>
          <textarea className="admin-textarea mono" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={18} />
          <div className="admin-actions">
            <button className="admin-btn primary" onClick={() => save(prompt)} disabled={saving || !dirty}>{saving ? "Saving…" : "Save instructions"}</button>
            <button className="admin-btn" onClick={() => save("")} disabled={saving}>Reset to default</button>
            {dirty && <span className="admin-meta">unsaved changes</span>}
            {note && <span className="admin-note">{note}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── 3. Execution (runs + sweep) ─────────────────────────────────────────────
function ExecutionSection() {
  const [sweep, setSweep] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        fetch("/api/deal-engine/sweep/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/deal-engine/trigger-logs", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setSweep(s);
      setLogs((t?.rows || (Array.isArray(t) ? t : [])).slice(0, 25));
    } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const c = sweep ? {
    done: sweep.done || 0, failed: sweep.failed || 0, working: sweep.working ?? (sweep.in_progress || 0),
    waiting: sweep.waiting || 0, status: sweep.status,
  } : null;
  return (
    <div className="admin-card">
      <h3>Agent execution</h3>
      <p className="admin-desc">Live state of the sweep worker (the engine that runs the agent per deal) and the most recent runs. Full detail + per-deal records on the <a href="/runs">Runs</a> tab.</p>
      {c && (
        <div className="dq-sync" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          <div className="dq-stat"><b style={{ color: c.status === "running" ? "var(--green-ink)" : undefined }}>{c.status || "idle"}</b><span>worker</span></div>
          <div className="dq-stat"><b>{c.done}</b><span>done</span></div>
          <div className="dq-stat"><b>{c.working}</b><span>in flight</span></div>
          <div className="dq-stat"><b>{c.waiting}</b><span>waiting</span></div>
          <div className="dq-stat"><b style={c.failed ? { color: "var(--red-ink)" } : undefined}>{c.failed}</b><span>failed</span></div>
        </div>
      )}
      <div className="admin-actions"><button className="admin-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh"}</button></div>
      <div className="admin-doclist" style={{ marginTop: 12 }}>
        {logs.length === 0 ? <div className="admin-meta">No recent runs.</div> :
          logs.map((r, i) => (
            <div key={i} className="admin-docrow">
              <span className="admin-docname">{(r.opp_name || r.account_name || r.opp_id || "—")}</span>
              <span className="admin-meta">{r.source || ""} · {r.status || ""} · {r.created_at ? String(r.created_at).slice(0, 16).replace("T", " ") : ""}</span>
            </div>
          ))}
      </div>
    </div>
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
