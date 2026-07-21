"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// The Deals book table (moved out of app/(dashboard)/deals/page.tsx so it can live in the
// persistent deals/layout.tsx). Staying mounted across /deals and /deals/[id] preserves
// scroll + pagination while the URL-driven drawer opens over it. Clicking a row now
// NAVIGATES to /deals/[id] (a shareable URL) instead of holding the open deal in state.
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useDealDrawer } from "@/components/deals/DrawerController";
import { ceoAreaLabel, fmtAmount } from "@/lib/engine/helpers";
import { prefetchDeal } from "@/lib/engine/dealCache";
import { ScoreCell } from "@/components/deals/DealScores";
import { Monogram } from "@/components/ui/Monogram";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

// Skeleton mirror of the book table — the table chrome (border/radius via #grid) with a
// header row and ~12 placeholder rows, so the table is visibly THERE the instant the route
// opens and just fills in with data, instead of a centred spinner on a blank canvas.
// Column count is DERIVED (toggle + favourite + lead + rest) so adding a column to
// REST_COLS can never again leave the skeleton narrower than the table it stands in for.
// Every permission-gated column is excluded, because none of those gates are known while
// we're still loading: the two score columns (canSeeScores) and Executive Connect
// (isAdminView). Counting them here would leave the skeleton WIDER than the table for
// everyone who cannot see them, which is the same lie in the other direction.
function DealsBoardSkeleton() {
  return (
    <div id="grid">
      <table>
        <thead>
          <tr>
            {Array.from({ length: SKEL_COLS }).map((_, i) => (
              <th key={i}><Skeleton className="h-3 w-16" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: SKEL_COLS }).map((_, c) => (
                <td key={c}>
                  {c === 0
                    ? <div className="flex items-center gap-2"><Skeleton className="size-7 rounded-lg" /><Skeleton className="h-3 w-28" /></div>
                    : <Skeleton className="h-3" style={{ width: `${40 + ((r * 7 + c * 13) % 45)}%` }} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCORE_COLS: [string, string, string][] = [
  ["win_position", "Zycus win position", "Zycus Win Position Score"],
  ["deal_momentum", "Deal momentum", "Deal Momentum Score"],
];
const SCORE_KEYS = new Set(SCORE_COLS.map(([k]) => k));

const LEAD_COLS: [string, string, number][] = [
  ["account_name", "Account", 0], ["opp_name", "Opportunity", 0],
];
const REST_COLS: [string, string, number][] = [
  ["stage", "Stage", 0], ["forecast_category", "Forecast", 0],
  ["amount", "Amount", 1], ["close_date", "Close", 0],
  ["days_to_close", "Days", 1], ["owner_name", "Owner", 0],
];
const SKEL_COLS = 2 + LEAD_COLS.length + REST_COLS.length;
const PAGE_SIZE = 20;

// ── Executive Connect ───────────────────────────────────────────────────────────
// Has a physically in-person meeting happened with a senior BUYER-side person present?
// Lives at r.ai.exec_f2f (NOT r.hard) — hence its own cell renderer rather than the
// generic cell() closure. Read deal_engine_f2f.py before touching any of this: the whole
// verdict is inference over free text, because the Salesforce fields built for it
// (Event.Location_Medium__c, Meeting_Sub_Type__c) are 100% NULL org-wide. A hand-tuned
// pass still got 2 of 6 "done" verdicts wrong before adversarial review, so the evidence
// string is MANDATORY on every non-none value — never a bare verdict with nothing behind it.
const F2F_KEY = "exec_f2f";

// Sort rank: done > in-person-confirmed > planned > none. `undefined` stays undefined so
// the existing null-last rule in the rows comparator catches never-swept deals.
function f2fRank(f: any): number | undefined {
  if (!f || !f.status) return undefined;
  if (f.status === "done") return 4;
  if (f.status === "planned") return f.near_miss ? 3 : 2;
  return 1;
}

// Local date formatter — fmtDate isn't exported from helpers, and DealScores.tsx keeps its
// own copy for the same reason. Same shape, so the chip reads like the rest of the book.
const fmtF2FDate = (s: any) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

// A "done" older than this is history, not a current relationship signal (real case: ACEN
// at 594 days). Still true, still shown — just greyed, with the age spelled out on hover.
const F2F_STALE_DAYS = 180;

const F2F_CHIP: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
  borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap", cursor: "help",
};

function ExecF2FCell({ f2f }: { f2f: any }) {
  // NEVER swept for this ≠ no evidence found. A deal the module has not run on gets the
  // same em-dash as any other absent fact; only a real "none" verdict says "No evidence".
  if (!f2f || !f2f.status) return <>—</>;

  const { status, date, exec_name, exec_title, days_stale, near_miss } = f2f;

  // "none" is the one verdict with no tooltip — there is nothing to cite. It is also
  // deliberately NOT phrased as "Not yet": absence of a keyword is not proof a meeting
  // did not happen (measured: 20 provable false blanks in the book).
  if (status === "none") {
    return <span style={{ color: "var(--ink-faint, #98a1b3)" }}>No evidence</span>;
  }

  // near_miss carries days_stale too (deal_engine_f2f.py sets it on that branch and leaves it
  // null on a plain "planned"), so a 594-day-old confirmed in-person meeting must grey out
  // exactly like a stale "done" — it was landing in the one bucket the guard skipped.
  const stale = (status === "done" || near_miss) && typeof days_stale === "number" && days_stale > F2F_STALE_DAYS;
  const label = status === "done"
    ? `Done${date ? " · " + fmtF2FDate(date) : ""}`
    : near_miss ? "Met, no exec" : "Planned";
  // done = positive; anything stale is greyed out so a 594-day-old meeting cannot read as
  // current; near-miss "Met, no exec" gets its own amber — the meeting is CONFIRMED there
  // and only the seniority is unproven, which is the most valuable distinction here.
  const tone = stale
    ? { background: "#f4f5f7", border: "1px solid #e0e2e8", color: "var(--muted)" }
    : status === "done"
      ? { background: "#f1f8f3", border: "1px solid #b5d4bd", color: "#1b6e3a" }
      : near_miss
        ? { background: "#fdf4e3", border: "1px solid #ecd9ad", color: "#8a5a00" }
        : { background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--ink2)" };

  // The tooltip is a BRIEF, not a data dump: it states the SITUATION — a meeting happened
  // without a senior exec, or an exec meeting is only planned — and never how the record was
  // captured (email / call / Avoma / next-step). The raw subject line is deliberately not
  // shown; the substance is what happened + who + when, the channel is plumbing.
  const headline = status === "done"
    ? "A face-to-face meeting with a senior (C-level) executive has taken place."
    : near_miss
      ? "A face-to-face meeting has taken place, but no senior (C-level) executive was in it."
      : "A senior-executive face-to-face is planned — it has not happened yet.";
  const dateLine = date
    ? (status === "planned" && !near_miss ? `Planned for ${fmtF2FDate(date)}` : `Took place ${fmtF2FDate(date)}`)
    : null;
  const execLine = exec_name ? `${exec_name}${exec_title ? ` — ${exec_title}` : ""}` : null;
  const staleLine = stale ? `${days_stale} days ago — history, not a current signal.` : null;

  // The tooltip is the ONLY tooltip on the chip — do NOT also set a native title=, or hover
  // fires both and the styled card and the raw browser box stack under the cursor. tabIndex={0}
  // makes the chip focusable, so Radix opens on keyboard focus as well as hover.
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span tabIndex={0} style={{ ...F2F_CHIP, ...tone }}>{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs duration-100">
        <div style={{ display: "grid", gap: 5 }}>
          <div style={{ fontWeight: 700 }}>{headline}</div>
          {execLine ? <div>{execLine}</div> : null}
          {dateLine ? <div>{dateLine}</div> : null}
          {staleLine ? <div style={{ opacity: 0.85 }}>{staleLine}</div> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function DealsBoard() {
  const { open: openDeal } = useDealDrawer();
  const { filtered, loading, canSeeScores, realIsAdmin, isAdminView, isFav, toggleFav, statsOff, toggleStats } = useDashboard();
  const [sortKey, setSortKey] = useState("days_to_close");
  const [sortDir, setSortDir] = useState(1);
  const [page, setPage] = useState(1);

  // Open a deal = the layout's drawer controller opens it INSTANTLY from the in-memory slim
  // record (openDeal above), and updates the /deals/<id> URL in the background for sharing.

  const rows = useMemo(() => {
    const getv = (r: any) => SCORE_KEYS.has(sortKey)
      ? (((r.ai || {}).deal_scores || {}).headline || {})[sortKey]
      : sortKey === F2F_KEY
        ? f2fRank((r.ai || {})[F2F_KEY])
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
  useEffect(() => { setPage(1); }, [filtered, sortKey, sortDir]);

  const start = (cur - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  if (loading && !rows.length) {
    return <DealsBoardSkeleton />;
  }
  if (!rows.length) {
    return <div className="empty">No opportunities match the current scope and filters.</div>;
  }

  function sortBy(k: string) {
    if (sortKey === k) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(1); }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : "");

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
      // Admin-gated in the export exactly as it is in the table — same isAdminView gate the
      // CeoHelp/CeoAreas pair below uses, so an admin reading a rep's book exports the book
      // that rep can see. Verdict and evidence travel TOGETHER — an exported "Done" with
      // nothing behind it is exactly the unciteable assertion this column exists to prevent.
      ...(isAdminView ? ([
        ["ExecutiveConnect", (r) => {
          const f = (r.ai || {})[F2F_KEY];
          if (!f || !f.status) return "";
          if (f.status === "none") return "No evidence";
          if (f.status === "done") return `Done${f.date ? " " + f.date : ""}${f.days_stale != null ? ` (${f.days_stale}d ago)` : ""}`;
          return f.near_miss ? "Met, no exec" : "Planned";
        }],
        ["ExecutiveConnectEvidence", (r) => ((r.ai || {})[F2F_KEY] || {}).evidence],
      ] as [string, (r: any) => unknown][]) : []),
      ["Win", (r) => hl(r).win_position],
      ["Momentum", (r) => hl(r).deal_momentum],
      ["Commitment", (r) => hl(r).customer_commitment],
      ["Risk", (r) => hl(r).deal_risk],
      ["Read", (r) => hl(r).read],
      ["Verdict", (r) => ((r.ai || {}).north_star_verdict || {}).verdict],
      ...(isAdminView ? ([
        ["CeoHelp", (r) => { const ci = (r.ai || {}).ceo_intervention; return ci ? (ci.needed ? `Yes (${ci.priority || ""})` : "No") : ""; }],
        ["CeoAreas", (r) => { const ci = (r.ai || {}).ceo_intervention; return ci && ci.needed ? (ci.areas || []).map(ceoAreaLabel).join("; ") : ""; }],
      ] as [string, (r: any) => unknown][]) : []),
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
              <th title="The toggle button includes or excludes a deal from the top pipeline totals" style={{ width: 64, textAlign: "center" }}>Toggle</th>
              <th aria-label="Favourite" style={{ width: 30, textAlign: "center" }} />
              {LEAD_COLS.map(([k, label]) => (
                <th key={k} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
              ))}
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
              {/* Executive Connect gets its own block rather than a REST_COLS entry: it is
                  gated on isAdminView, not the canSeeScores its neighbours share. */}
              {isAdminView ? (
                <th onClick={() => sortBy(F2F_KEY)}>Executive Connect{arrow(F2F_KEY)}</th>
              ) : null}
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
              const inTotals = !statsOff.has(r.opp_id);
              return (
                <tr
                  key={r.opp_id}
                  onClick={() => openDeal(r.opp_id)}
                  // Warm the full record on hover so the drawer's detail is already loaded by
                  // the time you click. (Opening is now a ?deal=<id> query-param change on the
                  // same /deals route — no route navigation to prefetch.)
                  onMouseEnter={() => prefetchDeal(r.opp_id)}
                  style={{ cursor: "pointer" }}
                >
                  <td className="statscell" style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={inTotals}
                      title={inTotals ? "Counted in the top pipeline totals — click to exclude this deal" : "Excluded from the top pipeline totals — click to include"}
                      onClick={(e) => { e.stopPropagation(); toggleStats(r.opp_id); }}
                      style={{
                        width: 30, height: 17, borderRadius: 999, border: "none", cursor: "pointer",
                        position: "relative", padding: 0, verticalAlign: "middle",
                        background: inTotals ? "#5b5bf0" : "var(--line, #d7d7e2)", transition: "background .15s ease",
                      }}
                    >
                      <span style={{
                        position: "absolute", top: 2, left: inTotals ? 15 : 2, width: 13, height: 13,
                        borderRadius: "50%", background: "#fff", transition: "left .15s ease",
                        boxShadow: "0 1px 2px rgba(0,0,0,.25)",
                      }} />
                    </button>
                  </td>
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
                  {canSeeScores && SCORE_COLS.map(([k]) => (
                    <td key={k} className="num scorecell"><ScoreCell ds={ai.deal_scores} k={k} /></td>
                  ))}
                  {isAdminView ? <td><ExecF2FCell f2f={ai[F2F_KEY]} /></td> : null}
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
    </>
  );
}
