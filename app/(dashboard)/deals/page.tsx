"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { aiLabel, fmtAmount, verdictTone, type Rec } from "@/lib/engine/helpers";
import DealDrawer from "@/components/deals/DealDrawer";

const COLS: [string, string, number][] = [
  ["account_name", "Account", 0], ["opp_name", "Opportunity", 0], ["stage", "Stage", 0],
  ["forecast_category", "Forecast", 0], ["amount", "Amount", 1], ["close_date", "Close", 0],
  ["days_to_close", "Days", 1], ["owner_name", "Owner", 0],
];
const PAGE_SIZE = 50;

export default function DealsPage() {
  const { filtered, records, playbook } = useDashboard();
  const [sortKey, setSortKey] = useState("days_to_close");
  const [sortDir, setSortDir] = useState(1);
  const [selected, setSelected] = useState<Rec | null>(null);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = (a.hard || {})[sortKey], bv = (b.hard || {})[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  // Reset to page 1 whenever the result set or sort changes.
  useEffect(() => { setPage(1); }, [filtered, sortKey, sortDir]);

  const start = (cur - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  if (!filtered.length) {
    return <div className="empty">No opportunities match the current scope and filters.</div>;
  }

  function sortBy(k: string) {
    if (sortKey === k) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(1); }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : "");

  return (
    <>
      <div id="grid">
        <table>
          <thead>
            <tr>
              {COLS.map(([k, label]) => (
                <th key={k} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
              ))}
              <th>Verdict</th><th>AIS</th><th>Conf.</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const h = r.hard || {}, ai = r.ai || {};
              const verdict = ai.north_star_verdict && ai.north_star_verdict.verdict;
              return (
                <tr key={r.opp_id} onClick={() => setSelected(r)}>
                  {COLS.map(([k, , numeric]) => {
                    let v: any = h[k];
                    if (k === "amount") v = fmtAmount(v);
                    return <td key={k} className={numeric ? "num" : undefined}>{v == null ? "—" : v}</td>;
                  })}
                  <td>{verdict ? <span className={`chip ${verdictTone(verdict)}`}>{verdict}</span> : ""}</td>
                  <td>{aiLabel(h, ai.ai_fit_signal)}</td>
                  <td className={`conf-${r.analysis_confidence}`}>{r.analysis_confidence || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span>
          Showing <b>{rows.length ? start + 1 : 0}–{Math.min(start + PAGE_SIZE, rows.length)}</b> of {rows.length}
        </span>
        <div className="pbtns">
          <button onClick={() => setPage(1)} disabled={cur === 1}>« First</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={cur === 1}>‹ Prev</button>
          <span className="ppage">Page {cur} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={cur === totalPages}>Next ›</button>
          <button onClick={() => setPage(totalPages)} disabled={cur === totalPages}>Last »</button>
        </div>
      </div>

      <DealDrawer record={selected} records={records} playbook={playbook} onClose={() => setSelected(null)} />
    </>
  );
}
