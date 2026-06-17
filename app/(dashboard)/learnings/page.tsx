"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";

// Learning Observatory — the place where Deal Sweep gets smarter over time.
// Reads the operator-behaviour SIGNALS (what people delete / finish / log, by stage)
// and the curated LEARNINGS (manual admin entries + the daily miner's proposals),
// with a switch to promote a learning candidate -> active (or pause/retire it).

const CAT_LABEL: Record<string, string> = {
  risk: "Risk",
  equity: "Equity & credibility",
  assurance: "Delivery assurance",
  differentiation: "Competitive differentiation",
  general: "General",
};
const CAT_COLOR: Record<string, string> = {
  risk: "#D6453B", equity: "#6D4AED", assurance: "#0F9D6B",
  differentiation: "#C9881A", general: "#7E8DA1",
};
const STATUS_COLOR: Record<string, string> = {
  candidate: "#C9881A", active: "#0F9D6B", paused: "#7E8DA1", retired: "#B4BECC",
};
// Canonical stage progression the observatory aligns learnings to.
const STAGE_ORDER = ["Qualified", "Formally Validated", "Shortlisted", "Contracting", "Closed"];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api/deal-engine${path}`, { cache: "no-store", ...init });
  let data: any = null; try { data = await res.json(); } catch { /* */ }
  return { ok: res.ok && data?.ok !== false, status: res.status, data };
}

function chip(text: string, color: string, key?: any) {
  return (
    <span key={key} style={{ display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: 11,
      fontWeight: 600, color: "#fff", background: color, marginRight: 6, marginBottom: 4 }}>{text}</span>
  );
}

// Admin-only gate: the Learning Observatory is an admin surface. Non-admins are
// blocked even on a direct URL (the nav tab is also hidden in the layout).
export default function LearningsPage() {
  const { isAdminView } = useDashboard();
  if (!isAdminView)
    return (
      <div className="dq-lock"><div className="dq-lock-card">
        <div className="dq-lock-ttl">🔒 Learning</div>
        <div className="dq-lock-sub">This view is restricted to admins.</div>
      </div></div>
    );
  return <LearningsPageInner />;
}

function LearningsPageInner() {
  const [learnings, setLearnings] = useState<any[]>([]);
  const [signals, setSignals] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [l, s] = await Promise.all([api("/learnings"), api("/learnings/signals")]);
    if (l.ok) setLearnings(l.data?.learnings || []); else setErr(`learnings ${l.status}`);
    if (s.ok) setSignals(s.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    const r = await api(`/learnings/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (r.ok) load();
  };

  const candidates = useMemo(() => learnings.filter((x) => x.status === "candidate"), [learnings]);
  const live = useMemo(() => learnings.filter((x) => x.status === "active"), [learnings]);
  const paused = useMemo(() => learnings.filter((x) => x.status === "paused" || x.status === "retired"), [learnings]);

  const muted = "var(--muted,#5A6B82)";
  const card: React.CSSProperties = { border: "1px solid var(--line,#E7ECF3)", borderRadius: 12, padding: 16, marginBottom: 16, background: "var(--card,#fff)" };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 60px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Learning Observatory</h1>
        <span style={{ color: muted, fontSize: 13 }}>What the platform is learning to make Deal Sweep better over time.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="sfm-btn confirm" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Close" : "+ Add a learning"}</button>
        <button type="button" className="sfm-btn cancel" onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</button>
      </div>
      {err ? <div style={{ color: "#D6453B", fontSize: 13, marginBottom: 10 }}>Couldn&apos;t load: {err}</div> : null}

      {showAdd ? <AddLearning onDone={() => { setShowAdd(false); load(); }} /> : null}

      {/* SIGNALS — the evidence the observatory learns from */}
      <div style={card}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Signals <span style={{ color: muted, fontWeight: 400, fontSize: 12.5 }}>— operator behaviour the daily miner reads</span></h3>
        {!signals ? <div style={{ color: muted, fontSize: 13 }}>Loading signals…</div> : (
          <>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "8px 0 12px", fontSize: 13 }}>
              <span><b>{signals.totals?.deleted ?? 0}</b> deleted <span style={{ color: muted }}>(low significance)</span></span>
              <span><b>{signals.totals?.completed ?? 0}</b> completed <span style={{ color: muted }}>(prioritised)</span></span>
              <span><b>{signals.totals?.edited ?? 0}</b> edited <span style={{ color: muted }}>(reshaped)</span></span>
              <span><b>{signals.totals?.manual_updates ?? 0}</b> manual updates <span style={{ color: muted }}>(self-logged activity)</span></span>
            </div>
            <SignalTable title="Deleted — people saw no significance" rows={signals.deleted} tone="#D6453B" />
            <SignalTable title="Completed — what people prioritise finishing" rows={signals.completed} tone="#0F9D6B" />
            <SignalTable title="Manual updates — activity people log themselves" rows={signals.manual_updates} tone="#6D4AED" noCat />
          </>
        )}
      </div>

      {/* CANDIDATES — mined, awaiting review */}
      <div style={card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Candidate learnings <span style={{ color: muted, fontWeight: 400, fontSize: 12.5 }}>— proposed, awaiting your switch</span> {chip(String(candidates.length), "#C9881A")}</h3>
        {candidates.length ? candidates.map((x) => (
          <LearningRow key={x.id} x={x} actions={[
            { label: "Activate", color: "#0F9D6B", to: "active" },
            { label: "Dismiss", color: "#B4BECC", to: "retired" },
          ]} onSet={setStatus} />
        )) : <div style={{ color: muted, fontSize: 13 }}>No candidates right now — the daily miner only adds significant ones.</div>}
      </div>

      {/* ACTIVE */}
      <div style={card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Active learnings <span style={{ color: muted, fontWeight: 400, fontSize: 12.5 }}>— applied to future sweeps</span> {chip(String(live.length), "#0F9D6B")}</h3>
        {live.length ? live.map((x) => (
          <LearningRow key={x.id} x={x} actions={[{ label: "Pause", color: "#7E8DA1", to: "paused" }]} onSet={setStatus} />
        )) : <div style={{ color: muted, fontSize: 13 }}>None active yet.</div>}
      </div>

      {/* PAUSED / RETIRED */}
      {paused.length ? (
        <div style={card}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15, color: muted }}>Paused / retired {chip(String(paused.length), "#B4BECC")}</h3>
          {paused.map((x) => (
            <LearningRow key={x.id} x={x} actions={[{ label: "Re-activate", color: "#0F9D6B", to: "active" }]} onSet={setStatus} muted />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SignalTable({ title, rows, tone, noCat }: { title: string; rows: any[]; tone: string; noCat?: boolean }) {
  const muted = "var(--muted,#5A6B82)";
  if (!rows || !rows.length) return null;
  const ordered = [...rows].sort((a, b) => {
    const ai = STAGE_ORDER.indexOf(a.stage), bi = STAGE_ORDER.indexOf(b.stage);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || (b.count - a.count);
  });
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: tone, marginBottom: 4 }}>{title}</div>
      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
        <tbody>
          {ordered.slice(0, 8).map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--line,#EEF2F7)" }}>
              <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap", verticalAlign: "top", fontWeight: 600 }}>{r.stage || "unknown"}</td>
              {!noCat ? <td style={{ padding: "5px 8px", verticalAlign: "top", color: muted, whiteSpace: "nowrap" }}>{CAT_LABEL[r.category] || r.category || "—"}</td> : null}
              <td style={{ padding: "5px 8px", verticalAlign: "top", whiteSpace: "nowrap" }}><b>{r.count}</b>×</td>
              <td style={{ padding: "5px 0", verticalAlign: "top", color: muted }}>{(r.samples || []).slice(0, 2).join("  ·  ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LearningRow({ x, actions, onSet, muted }: { x: any; actions: { label: string; color: string; to: string }[]; onSet: (id: string, s: string) => void; muted?: boolean }) {
  const mutedC = "var(--muted,#5A6B82)";
  return (
    <div style={{ borderTop: "1px solid var(--line,#EEF2F7)", padding: "10px 0", opacity: muted ? 0.6 : 1 }}>
      <div style={{ marginBottom: 3 }}>
        {chip(CAT_LABEL[x.category] || x.category || "general", CAT_COLOR[x.category] || "#7E8DA1")}
        {x.stage_scope && x.stage_scope !== "any" ? chip(x.stage_scope, "#33415C") : null}
        <span style={{ color: STATUS_COLOR[x.status] || mutedC, fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginLeft: 2 }}>{x.status}</span>
        {x.source === "mined" ? <span style={{ color: mutedC, fontSize: 11, marginLeft: 8 }}>auto-mined</span> : <span style={{ color: mutedC, fontSize: 11, marginLeft: 8 }}>by {x.created_by || "admin"}</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{x.title}</div>
      <div style={{ fontSize: 13, color: "var(--text,#1f2733)", marginBottom: 6 }}>{x.body}</div>
      {Array.isArray(x.evidence) && x.evidence.length ? (
        <div style={{ fontSize: 11.5, color: mutedC, marginBottom: 6 }}>Evidence: {x.evidence.map((e: any) => typeof e === "string" ? e : JSON.stringify(e)).slice(0, 3).join("  ·  ")}</div>
      ) : null}
      <div>{actions.map((a) => (
        <button key={a.to} type="button" onClick={() => onSet(x.id, a.to)}
          style={{ marginRight: 8, padding: "3px 12px", borderRadius: 7, border: `1px solid ${a.color}`, background: "transparent", color: a.color, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{a.label}</button>
      ))}</div>
    </div>
  );
}

function AddLearning({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("risk");
  const [stage, setStage] = useState("any");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true); setMsg(null);
    const r = await api("/learnings", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim(), category, stage_scope: stage, source: "manual", status: "active" }) });
    setBusy(false);
    if (r.ok) { setTitle(""); setBody(""); onDone(); } else setMsg("Couldn't save — try again.");
  };
  const input: React.CSSProperties = { width: "100%", font: "inherit", padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line,#D7DEE8)", marginBottom: 8 };
  return (
    <div style={{ border: "1px solid var(--accent,#6D4AED)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Add a learning <span style={{ color: "var(--muted,#5A6B82)", fontWeight: 400, fontSize: 12.5 }}>— admin doc entry point</span></h3>
      <input style={input} placeholder="Short title (e.g. Coupa is priced out for UK mid-market)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea style={{ ...input, resize: "vertical" }} rows={3} placeholder="The learning, in plain language — what the sweep should do differently and why." value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12.5 }}>Category{" "}
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ font: "inherit", padding: "4px 6px" }}>
            {Object.keys(CAT_LABEL).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12.5 }}>Stage{" "}
          <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ font: "inherit", padding: "4px 6px" }}>
            <option value="any">Any stage</option>
            <option value="Qualified->Formally Validated">Qualified → Formally Validated</option>
            <option value="Formally Validated->Shortlisted">Formally Validated → Shortlisted</option>
            <option value="Shortlisted->Contracting">Shortlisted → Contracting</option>
            <option value="Contracting->Closed">Contracting → Closed</option>
          </select>
        </label>
        <button type="button" className="sfm-btn confirm" disabled={busy || !title.trim() || !body.trim()} onClick={submit}>{busy ? "Saving…" : "Add learning"}</button>
        {msg ? <span style={{ color: "#D6453B", fontSize: 12.5 }}>{msg}</span> : null}
      </div>
    </div>
  );
}
