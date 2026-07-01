"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { aiLabel, fmtAmount, type Rec } from "@/lib/engine/helpers";
import DealDrawer from "@/components/deals/DealDrawer";
import { ScoreCell } from "@/components/deals/DealScores";
import { Monogram } from "@/components/ui/Monogram";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Separate, sortable Deal-Score columns (read from ai.deal_scores.headline).
// [key, header label, hover tooltip].
const SCORE_COLS: [string, string, string][] = [
  ["win_position", "Zycus win position", "Zycus Win Position Score"],
  ["deal_momentum", "Deal momentum", "Deal Momentum Score"],
];
const SCORE_KEYS = new Set(SCORE_COLS.map(([k]) => k));
import { PageLoader } from "@/components/ui/page-loader";

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

// The book is loaded SLIM (~20x smaller — see DashboardContext), so it loads fast and
// then filtering, sorting, paging (20/page) and the top search are all instant on the
// client. The 5 refinement filters (forecast/country/size/AI/quarter) run here because
// AI excitement is a computed tier (status OR score OR fit signal) the DB can't filter
// without a dedicated column. The full per-deal record is fetched on drawer open.
export default function DealsPage() {
  const { filtered, records, playbook, loading, canSeeScores, realIsAdmin, isFav, toggleFav } = useDashboard();
  const [sortKey, setSortKey] = useState("days_to_close");
  const [sortDir, setSortDir] = useState(1);
  const [selected, setSelected] = useState<Rec | null>(null);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    // Deal-score keys sort on ai.deal_scores.headline; everything else on the hard fact.
    const getv = (r: any) => SCORE_KEYS.has(sortKey)
      ? (((r.ai || {}).deal_scores || {}).headline || {})[sortKey]
      : (r.hard || {})[sortKey];
    return [...filtered].sort((a, b) => {
      const av = getv(a), bv = getv(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  // Reset to page 1 whenever the result set or sort changes (e.g. a filter or search).
  useEffect(() => { setPage(1); }, [filtered, sortKey, sortDir]);

  const start = (cur - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  if (loading && !rows.length) {
    return <PageLoader label="Loading deals…" />;
  }
  if (!rows.length) {
    return <div className="empty">No opportunities match the current scope and filters.</div>;
  }

  function sortBy(k: string) {
    if (sortKey === k) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(1); }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : "");

  // Admin-only: export every deal currently matching the scope + filters + search
  // (the whole result set, not just the visible page) to a CSV the browser downloads.
  const exportCSV = () => {
    const hl = (r: any) => (((r.ai || {}).deal_scores || {}).headline || {});
    const cols: [string, (r: any) => unknown][] = [
      ["Account", (r) => (r.hard || {}).account_name],
      ["Opportunity", (r) => (r.hard || {}).opp_name],
      ["Stage", (r) => (r.hard || {}).stage],
      ["Forecast", (r) => (r.hard || {}).forecast_category],
      ["Amount", (r) => (r.hard || {}).amount],
      ["CloseDate", (r) => (r.hard || {}).close_date],
      ["DaysToClose", (r) => (r.hard || {}).days_to_close],
      ["Owner", (r) => (r.hard || {}).owner_name],
      ["Win", (r) => hl(r).win_position],
      ["Momentum", (r) => hl(r).deal_momentum],
      ["Commitment", (r) => hl(r).customer_commitment],
      ["Risk", (r) => hl(r).deal_risk],
      ["Read", (r) => hl(r).read],
      ["Verdict", (r) => ((r.ai || {}).north_star_verdict || {}).verdict],
      ["OppId", (r) => r.opp_id],
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => c[0]).join(",")];
    for (const r of rows) lines.push(cols.map((c) => esc(c[1](r))).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deals_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div id="grid">
        <table>
          <thead>
            <tr>
              <th aria-label="Favourite" style={{ width: 30, textAlign: "center" }} />
              {LEAD_COLS.map(([k, label]) => (
                <th key={k} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
              ))}
              <th>AIS</th>
              {canSeeScores && SCORE_COLS.map(([k, label, tip]) => (
                <Tooltip key={k} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <th className="num scorehd" onClick={() => sortBy(k)}>
                      <span className="scorehd-stack">
                        {label.split(" ").map((w, i) => <span key={i}>{w}</span>)}
                      </span>
                      {arrow(k)}
                    </th>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs duration-100">{tip}</TooltipContent>
                </Tooltip>
              ))}
              {REST_COLS.map(([k, label]) => (
                <th key={k} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const h = r.hard || {}, ai = r.ai || {};
              const cell = ([k, , numeric]: [string, string, number]) => {
                let v: any = h[k];
                if (k === "amount") v = fmtAmount(v);
                if (k === "account_name") return (
                  <td key={k}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <Monogram name={h.account_name || r.opp_id} kind="account" size={26} />
                      <span style={{ fontWeight: 600 }}>{v == null ? "—" : v}</span>
                    </span>
                  </td>
                );
                return <td key={k} className={numeric ? "num" : undefined}>{v == null ? "—" : v}</td>;
              };
              const fav = isFav(r.opp_id);
              return (
                <tr key={r.opp_id} onClick={() => setSelected(r)}>
                  <td className="favcell" style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      title={fav ? "Remove from favourites" : "Add to favourites"}
                      aria-pressed={fav}
                      onClick={(e) => { e.stopPropagation(); toggleFav(r.opp_id); }}
                      style={{
                        border: "none", background: "none", cursor: "pointer", padding: 2,
                        fontSize: 16, lineHeight: 1, color: fav ? "#f0b400" : "var(--ink-faint, #c4c4cf)",
                      }}
                    >
                      {fav ? "★" : "☆"}
                    </button>
                  </td>
                  {LEAD_COLS.map(cell)}
                  <td>{aiLabel(h, ai.ai_fit_signal)}</td>
                  {canSeeScores && SCORE_COLS.map(([k]) => (
                    <td key={k} className="num scorecell"><ScoreCell ds={ai.deal_scores} k={k} /></td>
                  ))}
                  {REST_COLS.map(cell)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span>Showing <b>{rows.length ? start + 1 : 0}–{Math.min(start + PAGE_SIZE, rows.length)}</b> of {rows.length}</span>
          {realIsAdmin ? (
            <button
              type="button"
              onClick={exportCSV}
              title="Export all matching deals to CSV (admin only)"
              style={{
                border: "1px solid var(--line)", background: "var(--surface)", color: "var(--accent)",
                borderRadius: 8, padding: "5px 11px", fontSize: 12.5, fontWeight: 650, cursor: "pointer",
              }}
            >⤓ Export CSV</button>
          ) : null}
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
