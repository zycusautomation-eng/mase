"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { healthLabel } from "@/lib/engine/helpers";

// Runs / inspection dashboard. Reads the AWS backend (via the same-origin proxy)
// and shows every tracked opportunity, when it was last swept / triggered, the
// analysis that was produced (pulse, verdict, moves, MEDDPICC), AND the RAW
// backend record JSON — so the rendered front-end can be checked against the
// actual stored data. Pure read; refresh on demand (no 24/7 polling).

const fmtAmt = (a: any) => (a == null || a === "" ? "—" : "$" + Number(a).toLocaleString());
const d10 = (s: any) => (s ? String(s).slice(0, 10) : "—");
const items = (v: any): any[] => (Array.isArray(v) ? v : (v && v.items) || []);
const pulseColor = (s?: string) =>
  s === "live" ? "#0F9D6B" : s === "cooling" ? "#C9881A" : s === "dark" ? "#D6453B" : "#7E8DA1";

// Admin-only gate: Runs is a diagnostics surface. Non-admins are blocked even on
// a direct URL (the nav tab is also hidden in the dashboard layout).
export default function RunsPage() {
  const { isAdminView } = useDashboard();
  if (!isAdminView)
    return (
      <div className="dq-lock"><div className="dq-lock-card">
        <div className="dq-lock-ttl">🔒 Runs</div>
        <div className="dq-lock-sub">This view is restricted to admins.</div>
      </div></div>
    );
  return <RunsPageInner />;
}

function RunsPageInner() {
  const [recs, setRecs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [sweep, setSweep] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"swept_at" | "amount" | "account">("swept_at");
  const [open, setOpen] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [oR, tR, sR] = await Promise.all([
        fetch("/api/deal-engine/opportunities", { cache: "no-store" }),
        fetch("/api/deal-engine/trigger-logs", { cache: "no-store" }).catch(() => null),
        fetch("/api/deal-engine/sweep/status", { cache: "no-store" }).catch(() => null),
      ]);
      const oj = await oR.json();
      if (!oR.ok) throw new Error(oj?.error || `opportunities ${oR.status}`);
      setRecs(oj.records || oj.opportunities || []);
      try { if (tR && tR.ok) { const t = await tR.json(); setLogs(t.rows || (Array.isArray(t) ? t : [])); } } catch {}
      try { if (sR && sR.ok) setSweep(await sR.json()); } catch {}
      setFetchedAt(new Date().toLocaleString());
    } catch (e: any) { setErr(e?.message || String(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // trigger/run history grouped by 15-char opp id
  const logsByOpp = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const l of logs) {
      const id = String(l.opp_id_15 || l.opp_id || "").slice(0, 15);
      if (!id) continue; (m[id] = m[id] || []).push(l);
    }
    return m;
  }, [logs]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    let r = recs.map((x) => {
      const h = x.hard || {}; const ai = x.ai || {};
      return {
        rec: x, opp_id: x.opp_id, id15: String(x.opp_id || "").slice(0, 15),
        account: h.account_name || "—", opp: h.opp_name || x.opp_id, owner: h.owner_name || "—",
        stage: h.stage || "—", amount: Number(h.amount) || 0, swept_at: x.swept_at || "",
        pulse: (x.pulse || {}).state || "", verdict: (ai.north_star_verdict || {}).verdict || "",
        moves: items(ai.recommended_moves).length, conf: x.analysis_confidence || "",
      };
    });
    if (t) r = r.filter((x) => (x.account + " " + x.opp + " " + x.owner + " " + x.stage).toLowerCase().includes(t));
    r.sort((a, b) =>
      sortKey === "amount" ? b.amount - a.amount
      : sortKey === "account" ? a.account.localeCompare(b.account)
      : String(b.swept_at).localeCompare(String(a.swept_at)));
    return r;
  }, [recs, q, sortKey]);

  const sweptToday = useMemo(() => {
    const t = new Date().toISOString().slice(0, 10);
    return recs.filter((x) => String(x.swept_at || "").slice(0, 10) >= t).length;
  }, [recs]);

  const s = sweep || {};
  const sc = s.counts || { done: s.done, failed: s.failed, working: s.working ?? s.in_progress, waiting: s.waiting, total: s.total };

  return (
    <div style={{ padding: "0 4px 60px" }}>
      <div className="todo-top">
        <div className="ttl">
          Runs &amp; backend inspector — every tracked opportunity, when it was swept/triggered, the analysis produced, and the raw stored record.
          {fetchedAt ? <> · fetched {fetchedAt}</> : ""}{recs.length ? ` · ${recs.length} opps · ${sweptToday} swept today` : ""}
        </div>
        <div className="dq-actions">
          <button className="fclear" onClick={load} disabled={loading}>{loading ? "Loading…" : "↻ Refresh"}</button>
        </div>
      </div>

      {/* sweep queue strip */}
      {sweep ? (
        <div className="card dq-sync" style={{ flexWrap: "wrap", marginBottom: 14 }}>
          <div className="dq-stat"><b style={{ color: s.status === "running" ? "var(--green-ink, #0F9D6B)" : undefined }}>{s.status || "idle"}</b><span>sweep status</span></div>
          <div className="dq-stat"><b>{sc.done ?? 0}/{sc.total ?? 0}</b><span>done</span></div>
          <div className="dq-stat"><b>{sc.working ?? 0}</b><span>in flight</span></div>
          <div className="dq-stat"><b>{sc.waiting ?? 0}</b><span>waiting</span></div>
          <div className="dq-stat"><b style={(sc.failed ? { color: "var(--red-ink, #D6453B)" } : undefined)}>{sc.failed ?? 0}</b><span>failed / dark</span></div>
          {s.run_id ? <div className="dq-stat"><b style={{ fontSize: 13 }}>{s.run_id}</b><span>run id</span></div> : null}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "0 0 10px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter account / owner / stage…"
          style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--line, #E2E8F2)", borderRadius: 8, fontSize: 14 }} />
        <span style={{ fontSize: 13, color: "var(--muted, #5A6B82)" }}>sort</span>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} style={{ padding: "8px", borderRadius: 8, border: "1px solid var(--line,#E2E8F2)" }}>
          <option value="swept_at">Last swept (newest)</option>
          <option value="amount">Amount</option>
          <option value="account">Account A–Z</option>
        </select>
      </div>

      {err ? <div className="empty">Couldn&apos;t load.<br /><span className="err">{err}</span></div> : null}

      <div className="tbl-wrap" style={{ border: "1px solid var(--line,#E2E8F2)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ background: "var(--navy,#0A1A33)", color: "#DCEBFF", textAlign: "left" }}>
              {["Account", "Opportunity", "Owner", "Stage", "Amount", "Pulse", "Verdict", "Moves", "Swept", "Conf", ""].map((h) => (
                <th key={h} style={{ padding: "10px 12px", fontSize: 11.5, letterSpacing: ".04em", textTransform: "uppercase", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.opp_id;
              return (
                <RowAndDetail key={r.opp_id} r={r} isOpen={isOpen}
                  onToggle={() => setOpen(isOpen ? null : r.opp_id)}
                  triggers={logsByOpp[r.id15] || []}
                  showRaw={!!showRaw[r.opp_id]}
                  toggleRaw={() => setShowRaw((p) => ({ ...p, [r.opp_id]: !p[r.opp_id] }))} />
              );
            })}
            {!rows.length && !loading ? <tr><td colSpan={11} style={{ padding: 24, textAlign: "center", color: "var(--muted,#5A6B82)" }}>No opportunities.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowAndDetail({ r, isOpen, onToggle, triggers, showRaw, toggleRaw }: any) {
  const td: any = { padding: "9px 12px", borderTop: "1px solid var(--line,#E2E8F2)", verticalAlign: "top" };
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: isOpen ? "#F4F7FB" : undefined }}>
        <td style={{ ...td, fontWeight: 600, color: "var(--navy,#0A1A33)" }}>{r.account}</td>
        <td style={td}>{r.opp}</td>
        <td style={td}>{r.owner}</td>
        <td style={td}>{r.stage}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtAmt(r.amount)}</td>
        <td style={td}>{r.pulse ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: "#fff", background: pulseColor(r.pulse) }}>{r.pulse}</span> : "—"}</td>
        <td style={td}>{healthLabel(r.verdict)}</td>
        <td style={{ ...td, textAlign: "center" }}>{r.moves}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{d10(r.swept_at)}</td>
        <td style={td}>{r.conf || "—"}</td>
        <td style={{ ...td, color: "var(--blue,#1F6FEB)" }}>{isOpen ? "▾" : "▸"}</td>
      </tr>
      {isOpen ? (
        <tr><td colSpan={11} style={{ padding: 0, borderTop: "1px solid var(--line,#E2E8F2)", background: "#FAFCFF" }}>
          <Detail rec={r.rec} triggers={triggers} showRaw={showRaw} toggleRaw={toggleRaw} />
        </td></tr>
      ) : null}
    </>
  );
}

function Detail({ rec, triggers, showRaw, toggleRaw }: any) {
  const ai = rec.ai || {}; const pulse = rec.pulse || {};
  const nv = ai.north_star_verdict || {};
  const moves = items(ai.recommended_moves);
  const medd = ai.meddpicc || {};
  const sect: any = { padding: "12px 16px", borderRight: "1px solid var(--line,#E2E8F2)" };
  const h4: any = { margin: "0 0 6px", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--blue,#1F6FEB)", fontWeight: 700 };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {/* left: rendered analysis */}
        <div style={sect}>
          <h4 style={h4}>Pulse</h4>
          {pulse.state ? (
            <p style={{ margin: "0 0 10px", fontSize: 13 }}>
              <b style={{ color: pulseColor(pulse.state) }}>{pulse.state.toUpperCase()}</b> · {pulse.summary || ""}
              {pulse.rep_outreach?.detected ? <><br /><span style={{ color: "var(--muted,#5A6B82)" }}>Rep outreach {pulse.rep_outreach.date}: {pulse.rep_outreach.note}</span></> : null}
            </p>
          ) : <p style={{ color: "var(--muted,#5A6B82)", fontSize: 13 }}>No pulse on this record.</p>}

          <h4 style={h4}>Verdict</h4>
          <p style={{ margin: "0 0 10px", fontSize: 13 }}><b>{healthLabel(nv.verdict)}</b> {nv.headline ? `· ${nv.headline}` : ""}</p>

          <h4 style={h4}>Recommended moves ({moves.length})</h4>
          <ol style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13 }}>
            {moves.map((m: any, i: number) => (
              <li key={i} style={{ marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>[{m.owner}]</span> {m.action} {m.act_by ? <span style={{ color: "var(--muted,#5A6B82)" }}>(by {m.act_by})</span> : null}
              </li>
            ))}
            {!moves.length ? <li style={{ color: "var(--muted,#5A6B82)" }}>none</li> : null}
          </ol>

          <h4 style={h4}>MEDDPICC</h4>
          <div style={{ fontSize: 12.5 }}>
            {Object.keys(medd).length ? Object.entries(medd).map(([k, v]: any) => (
              <div key={k} style={{ marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{k}</span>: <span style={{ color: v?.status === "confirmed" ? "#0F9D6B" : v?.status === "gap" ? "#D6453B" : "#C9881A" }}>{v?.status || "?"}</span>
              </div>
            )) : <span style={{ color: "var(--muted,#5A6B82)" }}>none</span>}
          </div>
        </div>

        {/* right: trigger history + raw record */}
        <div style={{ padding: "12px 16px" }}>
          <h4 style={h4}>Run / trigger history ({triggers.length})</h4>
          {triggers.length ? (
            <table style={{ width: "100%", fontSize: 12, marginBottom: 10 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--muted,#5A6B82)" }}><th>When</th><th>Source</th><th>Status</th></tr></thead>
              <tbody>{triggers.slice(0, 8).map((t: any, i: number) => (
                <tr key={i}><td>{d10(t.started_at || t.created_at)}</td><td>{t.source || "—"}</td><td>{t.status || (t.error ? "error" : "—")}</td></tr>
              ))}</tbody>
            </table>
          ) : <p style={{ color: "var(--muted,#5A6B82)", fontSize: 13 }}>No trigger-log rows for this opp.</p>}

          <div style={{ marginTop: 6 }}>
            <button className="fclear" onClick={toggleRaw}>{showRaw ? "▾ Hide raw backend record" : "▸ Show raw backend record (compare with UI)"}</button>
            {showRaw ? (
              <pre style={{ marginTop: 8, maxHeight: 420, overflow: "auto", background: "#0E1726", color: "#CFE0F7", padding: 12, borderRadius: 8, fontSize: 11.5, lineHeight: 1.45 }}>
                {JSON.stringify(rec, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
