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

// Known knowledge corpora (Supabase project_ids). Uploaded docs are scoped to a
// project; the agent's search_knowledge tool retrieves within the active project.
const CORPORA = [
  { id: "87f864e2-50bf-4015-a0f8-4ed7426b2a50", label: "Bite Size 2.0" },
  { id: "22fbcc90-f594-4fd3-978c-26b9efeced11", label: "Bite Size v1" },
];
const DOC_TYPES = ["playbook", "guide", "email_template", "transcript", "showpad_asset", "other"];
const TEXT_EXT = [".txt", ".md", ".markdown", ".csv", ".json", ".html"];
const BIN_EXT = [".pdf", ".docx"]; // extracted server-side via pypdf / python-docx
const ACCEPT_EXT = [...TEXT_EXT, ...BIN_EXT];

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
  return (
    <div id="adminview">
      <div className="todo-top"><div className="ttl"><b>Agent Control</b> — manage the agents: knowledge, the todo-runner prompt, the deal-sweep prompt, execution, and access.</div></div>
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
  const [corpus, setCorpus] = useState(CORPORA[0].id);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [fileB64, setFileB64] = useState("");
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
    if (!ACCEPT_EXT.some((x) => lower.endsWith(x))) {
      setNote(`Unsupported file. Allowed: ${ACCEPT_EXT.join(", ")} — or paste text.`);
      return;
    }
    if (f.size > 15_000_000) { setNote("File too large (>15 MB). Split it."); return; }
    setNote(null);
    setFileName(f.name);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    const isBin = BIN_EXT.some((x) => lower.endsWith(x));
    const reader = new FileReader();
    if (isBin) {
      // PDF/DOCX → base64; the server extracts the text (pypdf / python-docx).
      reader.onload = () => { const s = String(reader.result || ""); setFileB64(s.includes(",") ? s.split(",")[1] : s); setContent(""); };
      reader.readAsDataURL(f);
    } else {
      reader.onload = () => { setContent(String(reader.result || "")); setFileB64(""); };
      reader.readAsText(f);
    }
  }

  async function upload() {
    if (!content.trim() && !fileB64) { setNote("Add content (upload a file or paste text)."); return; }
    if (!title.trim()) { setNote("Give the document a title."); return; }
    setBusy(true); setNote(null);
    try {
      // Send doc_type as a real field + a clean title. The backend stores doc_type
      // natively once the column exists, else encodes it into the name. PDF/DOCX go
      // as base64 (file_b64 + filename) for server-side extraction.
      const body: Record<string, unknown> = { name: title.trim(), project_id: corpus, doc_type: docType };
      if (fileB64) { body.file_b64 = fileB64; body.filename = fileName; }
      else body.content = content;
      const r = await fetch("/api/documents/upload", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j.error) setNote(j.error || `Upload failed (${r.status})`);
      else {
        setNote(`Uploaded "${title.trim()}" — chunked + embedded into the corpus.`);
        setTitle(""); setContent(""); setFileB64(""); setFileName("");
        void loadDocs();
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setBusy(false);
  }

  return (
    <div className="admin-card">
      <h3>Upload knowledge</h3>
      <p className="admin-desc">Docs you upload here are chunked, embedded, and stored in the chosen corpus — the agent retrieves them via search_knowledge when completing tasks. Tag the type so retrieval can route by it. Supports text, Markdown, CSV, PDF, and DOCX (or paste text).</p>
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
        <input type="file" accept={ACCEPT_EXT.join(",")} onChange={onFile} />
        {fileName && <span className="admin-meta">{fileName}{content ? ` · ${content.length.toLocaleString()} chars` : fileB64 ? " · binary (server-extracted)" : ""}</span>}
      </div>
      <textarea className="admin-textarea" value={content} onChange={(e) => { setContent(e.target.value); if (fileB64) { setFileB64(""); setFileName(""); } }} placeholder="…or paste the document text here" rows={8} />
      <div className="admin-actions">
        <button className="admin-btn primary" onClick={upload} disabled={busy}>{busy ? "Uploading…" : "Upload to corpus"}</button>
        {note && <span className="admin-note">{note}</span>}
      </div>

      <h3 style={{ marginTop: 24 }}>Documents in corpus {listLoading ? "…" : `(${docs.length})`}</h3>
      <div className="admin-doclist">
        {docs.length === 0 && !listLoading ? <div className="admin-meta">No documents in this corpus yet.</div> :
          docs.slice(0, 200).map((d, i) => (
            <div key={d.id || i} className="admin-docrow">
              <span className="admin-docname">{d.name || d.title || d.id}</span>
              {d.doc_type && <span className="admin-meta">{d.doc_type}</span>}
            </div>
          ))}
      </div>
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
