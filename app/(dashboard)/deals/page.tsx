"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { aiLabel, fmtAmount, verdictTone, applyStageFix, ownersForVpsStatic, type Rec } from "@/lib/engine/helpers";
import DealDrawer from "@/components/deals/DealDrawer";

// Columns are split so Verdict + AIS sit immediately after Opportunity.
const LEAD_COLS: [string, string, number][] = [
  ["account_name", "Account", 0], ["opp_name", "Opportunity", 0],
];
const REST_COLS: [string, string, number][] = [
  ["stage", "Stage", 0], ["forecast_category", "Forecast", 0],
  ["amount", "Amount", 1], ["close_date", "Close", 0],
  ["days_to_close", "Days", 1], ["owner_name", "Owner", 0],
];
const PAGE_SIZE = 20;

// The Deals table is SERVER-paginated: each request fetches ONE page, and search +
// sort + scope all run in Postgres (GET /api/deal-engine/opportunities?paged=1). This
// is independent of the shared (whole-book) context the aggregate tabs use, so the
// table loads fast and the top search hits the DB across every deal, not just a page.
export default function DealsPage() {
  const { vps, rsds, query, blocked, records, playbook } = useDashboard();
  const [sortKey, setSortKey] = useState("days_to_close");
  const [sortDir, setSortDir] = useState(1);
  const [selected, setSelected] = useState<Rec | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Rec[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Owner scope for the server query — resolved from the static OWNER_VP map (no book).
  const owners = useMemo(() => (rsds.length ? rsds : ownersForVpsStatic(vps)), [vps, rsds]);
  const ownersKey = owners.join("|");

  // Debounce the top search so we hit the DB once the user pauses typing.
  const [dq, setDq] = useState(query);
  useEffect(() => { const t = setTimeout(() => setDq(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  // Any change to the result set returns to page 1.
  useEffect(() => { setPage(1); }, [dq, ownersKey, sortKey, sortDir]);

  useEffect(() => {
    if (blocked) { setRows([]); setTotal(0); setLoading(false); return; }
    let off = false;
    setLoading(true);
    const p = new URLSearchParams({
      paged: "1", limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE),
      sort: sortKey, dir: sortDir > 0 ? "asc" : "desc",
    });
    if (dq) p.set("q", dq);
    if (owners.length) p.set("owners", owners.join(","));
    (async () => {
      try {
        const r = await fetch(`/api/deal-engine/opportunities?${p.toString()}`, { cache: "no-store" });
        const j = await r.json();
        if (off) return;
        setRows((j.records || []).map(applyStageFix));
        setTotal(typeof j.total === "number" ? j.total : (j.records || []).length);
      } catch { if (!off) { setRows([]); setTotal(0); } }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, [page, dq, ownersKey, sortKey, sortDir, blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  const start = (cur - 1) * PAGE_SIZE;

  function sortBy(k: string) {
    if (sortKey === k) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(k === "account_name" || k === "opp_name" || k === "owner_name" ? 1 : 1); }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : "");

  if (blocked) return <div className="empty">No opportunities are assigned to your account.</div>;

  return (
    <>
      <div id="grid">
        <table>
          <thead>
            <tr>
              {LEAD_COLS.map(([k, label]) => (
                <th key={k} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
              ))}
              <th>Verdict</th><th>AIS</th>
              {REST_COLS.map(([k, label]) => (
                <th key={k} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
              ))}
              <th>Conf.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const h = r.hard || {}, ai = r.ai || {};
              const verdict = ai.north_star_verdict && ai.north_star_verdict.verdict;
              const cell = ([k, , numeric]: [string, string, number]) => {
                let v: any = h[k];
                if (k === "amount") v = fmtAmount(v);
                return <td key={k} className={numeric ? "num" : undefined}>{v == null ? "—" : v}</td>;
              };
              return (
                <tr key={r.opp_id} onClick={() => setSelected(r)}>
                  {LEAD_COLS.map(cell)}
                  <td>{verdict ? <span className={`chip ${verdictTone(verdict)}`}>{verdict}</span> : ""}</td>
                  <td>{aiLabel(h, ai.ai_fit_signal)}</td>
                  {REST_COLS.map(cell)}
                  <td className={`conf-${r.analysis_confidence}`}>{r.analysis_confidence || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? (
          <div className="empty" style={{ padding: "28px 12px" }}>No opportunities match the current scope and search.</div>
        ) : null}
        {loading ? <div className="empty" style={{ padding: "20px 12px", opacity: 0.6 }}>Loading deals…</div> : null}
      </div>

      <div className="pager">
        <span>
          Showing <b>{total ? start + 1 : 0}–{start + rows.length}</b> of {total}
        </span>
        <div className="pbtns">
          <button onClick={() => setPage(1)} disabled={cur <= 1 || loading}>« First</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={cur <= 1 || loading}>‹ Prev</button>
          <span className="ppage">Page {cur} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={cur >= totalPages || loading}>Next ›</button>
          <button onClick={() => setPage(totalPages)} disabled={cur >= totalPages || loading}>Last »</button>
        </div>
      </div>

      <DealDrawer record={selected} records={records} playbook={playbook} onClose={() => setSelected(null)} />
    </>
  );
}
