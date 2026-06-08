"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { computeDataQuality, dqToCsv, type DQResult } from "@/lib/engine/dataQuality";

// Soft client-side gate (keeps casual eyes out — not real security; the data
// loads in the other tabs too). Change via NEXT_PUBLIC_DQ_PASSCODE on the host.
const PASS = process.env.NEXT_PUBLIC_DQ_PASSCODE || "Mased@123";
const UNLOCK_KEY = "mase_dq_unlocked";
const tone = (s: number) => (s >= 85 ? "good" : s >= 65 ? "warn" : "bad");

export default function DataQualityPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);
  const [res, setRes] = useState<DQResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showLag, setShowLag] = useState(false);

  useEffect(() => { try { if (sessionStorage.getItem(UNLOCK_KEY) === "1") setUnlocked(true); } catch {} }, []);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [oppR, tlR] = await Promise.all([
        fetch("/api/deal-engine/opportunities", { cache: "no-store" }),
        fetch("/api/deal-engine/trigger-logs", { cache: "no-store" }).catch(() => null),
      ]);
      const j = await oppR.json();
      if (!oppR.ok) throw new Error(j?.error || `Request failed (${oppR.status})`);
      let logs: any[] = [];
      try { if (tlR && tlR.ok) { const t = await tlR.json(); logs = t.rows || (Array.isArray(t) ? t : []); } } catch {}
      setRes(computeDataQuality(j.records || [], logs));
      setCheckedAt(new Date().toLocaleString());
    } catch (e: any) { setError(e?.message || String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { if (unlocked && !res && !loading) run(); }, [unlocked, res, loading, run]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw === PASS) { setUnlocked(true); try { sessionStorage.setItem(UNLOCK_KEY, "1"); } catch {} }
    else setPwErr(true);
  }
  function exportCsv() {
    if (!res) return;
    const blob = new Blob([dqToCsv(res)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `mase-sync-quality-${res.today}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!unlocked) {
    return (
      <div className="dq-lock">
        <form className="dq-lock-card" onSubmit={submit}>
          <div className="dq-lock-ttl">🔒 Sync Quality</div>
          <div className="dq-lock-sub">Enter the passcode to view sync-quality diagnostics.</div>
          <input type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setPwErr(false); }} placeholder="Passcode" />
          {pwErr ? <div className="dq-lock-err">Incorrect passcode.</div> : null}
          <button type="submit">Unlock</button>
        </form>
      </div>
    );
  }

  return (
    <div id="dqview">
      <div className="todo-top">
        <div className="ttl">
          Sync quality of the swept Salesforce + Avoma book — scored against the latest data at check time.
          {checkedAt ? <> · <b>Checked {checkedAt}</b></> : ""}{res ? ` · ${res.total} deals` : ""}
        </div>
        <div className="dq-actions">
          <button className="fclear" onClick={run} disabled={loading}>{loading ? "Checking…" : "↻ Re-run check"}</button>
          <button className="fclear" onClick={exportCsv} disabled={!res}>Export CSV</button>
          <button className="fclear" disabled title="Triggers a fresh Avoma/Salesforce sweep, then re-checks — enabled once the backend endpoint exists">Re-sweep &amp; re-check (soon)</button>
        </div>
      </div>

      {error ? (
        <div className="empty">Couldn&apos;t run the check.<br /><br /><span className="err">{error}</span></div>
      ) : !res ? (
        <div className="empty">{loading ? "Running sync-quality check…" : "…"}</div>
      ) : (
        <>
          <div className="dq-overall card">
            <div className={`dq-score ${tone(res.overall)}`}>{res.overall}<span>/100</span></div>
            <div className="dq-overall-lab">Overall sync quality
              <div className="td-meta">across {res.total} opportunities · {res.dimensions.length} dimensions · lower = more gaps to fix</div>
            </div>
          </div>

          {/* Sync activity — re-sweeps vs triggers received */}
          <div className="dq-sync card">
            <div className="dq-stat"><b>{res.sync.reSweeps}</b><span>re-sweeps logged</span></div>
            <div className="dq-stat"><b>{res.sync.distinctOpps}</b><span>distinct opportunities re-swept</span></div>
            <div className="dq-stat"><b>{res.sync.bySource.salesforce_trigger || 0}</b><span>from Salesforce triggers</span></div>
            <div className="dq-stat"><b>{res.sync.bySource.sweep || 0}</b><span>bulk sweep</span></div>
            <div className="dq-stat"><b>{res.sync.bySource.manual || 0}</b><span>manual</span></div>
            <div className="dq-stat"><b>{res.sync.bySource.scheduled || 0}</b><span>scheduled (7am/6pm)</span></div>
            <button type="button" className={`dq-stat dq-stat-btn ${res.sync.changedNotReswept ? "warn" : "good"}`} onClick={() => res.sync.changedNotReswept && setShowLag((s) => !s)} title="Click to list the accounts">
              <b>{res.sync.changedNotReswept}</b><span>changed but not re-swept{res.sync.changedNotReswept ? (showLag ? " ▾" : " ▸") : ""}</span>
            </button>
          </div>

          {showLag && res.sync.laggers.length ? (
            <div className="card dq-lag">
              <div className="dq-lag-h">Changed but not re-swept — {res.sync.laggers.length} accounts <span className="td-meta">(newest Salesforce change is after the last sweep)</span></div>
              <table className="itab">
                <thead><tr><th>Account</th><th>Opportunity</th><th>Owner</th><th>Last change</th><th>Last swept</th><th>Behind</th></tr></thead>
                <tbody>
                  {res.sync.laggers.map((l, i) => (
                    <tr key={i}>
                      <td className="owner">{l.acct}</td>
                      <td>{l.opp}</td>
                      <td>{l.owner}</td>
                      <td>{l.change} <span className="meta">· {l.kind}</span></td>
                      <td>{l.sweptAt}</td>
                      <td className="num">{l.daysBehind}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="dq-grid">
            {res.dimensions.map((d) => (
              <div className="card dq-dim" key={d.key}>
                <div className="dq-dim-h"><span className="dq-dim-lab">{d.label}</span><span className={`dq-pill ${tone(d.score)}`}>{d.score}</span></div>
                <ul className="dq-checks">
                  {d.checks.map((c) => {
                    const clean = c.total ? Math.round((c.total - c.bad) / c.total * 100) : 100;
                    const id = d.key + ":" + c.key, isOpen = open[id];
                    return (
                      <li key={c.key} className={c.bad ? "has-issues" : ""}>
                        <div className="dq-check-row" onClick={() => c.bad && setOpen((o) => ({ ...o, [id]: !o[id] }))} style={{ cursor: c.bad ? "pointer" : "default" }}>
                          <span className="dq-check-lab">{c.bad ? (isOpen ? "▾ " : "▸ ") : ""}{c.label}</span>
                          <span className={`dq-check-n ${c.bad ? (clean >= 85 ? "warn" : "bad") : "good"}`}>{c.bad}/{c.total}</span>
                        </div>
                        {isOpen && c.examples.length ? (
                          <ul className="dq-ex">
                            {c.examples.map((e, i) => (
                              <li key={i}>{e.acct} <span className="meta">· {e.opp}</span>{e.detail ? <span className="dq-ex-d"> — {e.detail}</span> : null}</li>
                            ))}
                            {c.bad > c.examples.length ? <li className="meta">+{c.bad - c.examples.length} more</li> : null}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
