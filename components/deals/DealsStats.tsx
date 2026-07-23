"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deals page header: stat cards (mockup #38). Numbers are REAL, computed from the
// currently-filtered book. Sparklines are illustrative (we don't track historical
// pipeline yet) — shape only.
//
// Two of the cards are click-to-open, because their numbers are blends, not plain
// sums:
//   • Weighted Forecast — OPEN deals only, each amount × a weight by FORECAST CATEGORY.
//   • Weighted Pipeline — OPEN deals only, each amount × a weight by STAGE.
// "Open" excludes Closed Won/Lost, Qualified Out, No Decision, Omitted (see stageBucket).
// Each opens a modal that shows the weighting table that totals to the headline
// number, plus the biggest weighted contributors (each links into its deal page).
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { prefetchDeal } from "@/lib/engine/dealCache";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { verdictTone, vpOf, vpsList, teamOwners, inScope, isDeadDeal } from "@/lib/engine/helpers";
import MultiSelect, { type Opt } from "@/components/MultiSelect";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function fmtM(n: number): string {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n || 0);
}

// Forecast-category → weight. Case-insensitive and tolerant of the real Salesforce
// strings ("Upside Key Deal" sometimes arrives as just "Upside"). The headline number
// and the modal both derive from this one place so they can never drift apart.
function fcBucket(fc: any): { key: string; label: string; weight: number; order: number } {
  const k = String(fc || "").toLowerCase();
  if (k === "commit") return { key: "commit", label: "Commit", weight: 0.9, order: 1 };
  if (k.includes("upside")) return { key: "upside", label: "Upside Key Deal", weight: 0.85, order: 2 };
  if (k.includes("best")) return { key: "best", label: "Best Case", weight: 0.75, order: 3 };
  if (k === "pipeline") return { key: "pipeline", label: "Pipeline", weight: 0.1, order: 4 };
  return { key: "other", label: "Other / blank", weight: 0.15, order: 5 };
}

// Stage → weight for Weighted PIPELINE. Returns null for closed/dead stages, which are
// excluded entirely (open pipeline only). Order matters: check the more specific names
// (Qualified Out, Contract Signed) before the general ones (Qualified, Contract).
function stageBucket(stage: any): { key: string; label: string; weight: number; order: number } | null {
  const k = String(stage || "").toLowerCase();
  if (k.includes("closed") || k.includes("qualified out") || k.includes("no decision") || k.includes("omitted")) return null;
  if (k.includes("contract signed") || k.includes("po received")) return { key: "signed", label: "Contract Signed / PO Received", weight: 1.0, order: 7 };
  if (k.includes("contract")) return { key: "contracting", label: "Contracting", weight: 0.8, order: 6 };
  if (k.includes("vendor select") || k === "selected") return { key: "selected", label: "Vendor Selected", weight: 0.75, order: 5 };
  if (k.includes("shortlist")) return { key: "shortlist", label: "Shortlisted", weight: 0.5, order: 4 };
  if (k.includes("evaluation") || k.includes("formal eval")) return { key: "eval", label: "Formal Evaluation", weight: 0.2, order: 3 };
  if (k.includes("qualified")) return { key: "qualified", label: "Qualified", weight: 0.1, order: 2 };
  if (k.includes("initial interest")) return { key: "initial", label: "Initial Interest", weight: 0, order: 1 };
  return { key: "other", label: "Other (open)", weight: 0, order: 8 };
}

// Circular gauge for the AI-score card — a grey track ring + an arc filled to `value`%
// in the score's colour. Center is intentionally empty (the number sits beside it, big).
function ScoreRing({ value, color }: { value: number; color: string }) {
  const r = 27, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" className="dl-ring" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line2)" strokeWidth={6} />
      <circle
        cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}

type Row = { label: string; count: number; raw: number; weight: number; wtd: number };
type TopDeal = { id: string; account: string; label: string; weight: number; raw: number; wtd: number };

// Shared breakdown modal for the two weighted cards.
function WeightedModal({ label, big, sub, catCol, rows, totalLabel, totalCount, totalRaw, totalWtd, totalWeightCell, top, onClose, onDeal, onSeeAll, seeAllCount, activeTab, onTab }: {
  label: string; big: string; sub: string; catCol: string;
  rows: Row[]; totalLabel: string; totalCount: number; totalRaw: number; totalWtd: number; totalWeightCell: string;
  top: TopDeal[]; onClose: () => void; onDeal: (id: string) => void; onSeeAll?: () => void; seeAllCount?: number;
  activeTab?: "forecast" | "pipeline"; onTab?: (t: "forecast" | "pipeline") => void;
}) {
  // PORTAL to <body>. This modal is rendered from inside `.dl-head`, which is
  // `position:sticky; z-index:30` — a STACKING CONTEXT. Trapped inside it, the modal's
  // own z-index:96 only ranks it within `.dl-head`, so the sibling `.filterbar` (also
  // z-index:30 but LATER in the DOM) painted straight over the modal. Portalling to
  // body escapes that context so z-index:96 is page-level and the overlay covers the
  // filter bar. Same pattern as DealDrawer.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="statmodal-back" onClick={onClose} />
      <div className="statmodal" role="dialog" aria-modal="true" aria-label={`${label} breakdown`}>
        <div className="wf-h">
          <div>
            <div className="wf-title">{label}</div>
            <div className="wf-big">{big}</div>
            <div className="wf-sub">{sub}</div>
          </div>
          <button className="wf-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {onTab ? (
          <div className="wf-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={activeTab === "forecast"}
              className={`wf-tab ${activeTab === "forecast" ? "active" : ""}`} onClick={() => onTab("forecast")}>
              Weighted forecast
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "pipeline"}
              className={`wf-tab ${activeTab === "pipeline" ? "active" : ""}`} onClick={() => onTab("pipeline")}>
              Weighted pipeline
            </button>
          </div>
        ) : null}

        <div className="wf-sec">
          <h4>How the number is built</h4>
          <table className="wf-table">
            <thead>
              <tr><th>{catCol}</th><th>Deals</th><th>Raw value</th><th>Weight</th><th>Weighted</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.count}</td>
                  <td>{fmtM(r.raw)}</td>
                  <td><span className="wf-wt">×{r.weight.toFixed(2)}</span></td>
                  <td>{fmtM(r.wtd)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>{totalLabel}</td>
                <td>{totalCount}</td>
                <td>{fmtM(totalRaw)}</td>
                <td><span className="wf-wt">{totalWeightCell}</span></td>
                <td>{fmtM(totalWtd)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="wf-sec">
          <h4>Top weighted contributors</h4>
          <table className="wf-table">
            <thead>
              <tr><th>Deal</th><th>{catCol}</th><th>Raw</th><th>Weight</th><th>Weighted</th></tr>
            </thead>
            <tbody>
              {top.map((d) => (
                <tr key={d.id} className="wf-deal" onClick={() => onDeal(d.id)} onMouseEnter={() => prefetchDeal(d.id)} title="Open deal">
                  <td>{d.account}</td>
                  <td>{d.label}</td>
                  <td>{fmtM(d.raw)}</td>
                  <td><span className="wf-wt">×{d.weight.toFixed(2)}</span></td>
                  <td>{fmtM(d.wtd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {onSeeAll ? (
          <div className="wf-foot">
            <button className="wf-seeall" onClick={onSeeAll}>See all {seeAllCount} deals →</button>
          </div>
        ) : null}
      </div>
    </>,
    document.body
  );
}

// Full right-side drawer: every deal behind a weighted number, filterable by VP / RSD
// and sortable. `base` is the open-deal set (already global-scoped); `weightOf`/`basisOf`
// describe the weighting (forecast category OR stage), so one drawer serves both cards.
function WeightedDrawer({ title, basisCol, base, weightOf, basisOf, onClose, onDeal }: {
  title: string; basisCol: string; base: any[];
  weightOf: (r: any) => number; basisOf: (r: any) => string;
  onClose: () => void; onDeal: (id: string) => void;
}) {
  const [dVps, setDVps] = useState<string[]>([]);
  const [dRsds, setDRsds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<"wtd" | "raw" | "weight" | "account" | "owner">("wtd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amt = (r: any) => Number(r.hard?.amount) || 0;
  const vpOpts: Opt[] = vpsList(base).map((v) => ({ value: v, label: v }));
  const rsdOpts: Opt[] = teamOwners(base, dVps).map((o) => ({ value: o, label: o }));

  const rows = base
    .filter((r) => inScope(r, dVps, dRsds))
    .map((r) => {
      const raw = amt(r); const weight = weightOf(r);
      return { id: r.opp_id, account: r.hard?.account_name || r.hard?.opp_name || "—", owner: r.hard?.owner_name || "—", vp: vpOf(r) || "—", basis: basisOf(r), raw, weight, wtd: raw * weight };
    });
  const sumRaw = rows.reduce((n, d) => n + d.raw, 0);
  const sumWtd = rows.reduce((n, d) => n + d.wtd, 0);
  const pct = sumRaw ? Math.round((sumWtd / sumRaw) * 100) : 0;

  const sorted = [...rows].sort((a, b) => {
    const av = (a as any)[sortKey], bv = (b as any)[sortKey];
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const setSort = (k: typeof sortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "account" || k === "owner" ? "asc" : "desc"); }
  };
  const arrow = (k: typeof sortKey) => (sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "");
  const dirty = dVps.length > 0 || dRsds.length > 0;

  // Portalled to <body> for the same reason as WeightedModal: `.dl-head` is a
  // sticky z-index:30 stacking context, so this drawer's z-index:98 would otherwise
  // be trapped beneath the later-in-DOM `.filterbar`.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="wfd-back" onClick={onClose} />
      <aside className="wfd" role="dialog" aria-modal="true" aria-label={`${title} — all deals`}>
        <div className="wfd-h">
          <div className="wf-h" style={{ padding: 0, border: "none" }}>
            <div>
              <div className="wf-title">{title} · all deals</div>
              <div className="wf-big">{fmtM(sumWtd)}</div>
              <div className="wf-sub">{pct}% of {fmtM(sumRaw)} open pipeline · {rows.length} deals weighted by {basisCol.toLowerCase()}</div>
            </div>
            <button className="wf-x" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="filterbar" style={{ padding: "12px 22px", margin: 0, borderBottom: "1px solid var(--line)" }}>
          <MultiSelect allLabel="All VPs" options={vpOpts} selected={dVps} onChange={(v) => { setDVps(v); setDRsds([]); }} />
          <MultiSelect allLabel={dVps.length ? "All in selected teams" : "All RSDs"} options={rsdOpts} selected={dRsds} onChange={setDRsds} />
          {dirty ? <button className="fclear" onClick={() => { setDVps([]); setDRsds([]); }}>Clear</button> : null}
          <span className="fcount">{rows.length} deal{rows.length === 1 ? "" : "s"}</span>
        </div>

        <div className="wfd-body">
          <table className="wf-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => setSort("account")}>Deal{arrow("account")}</th>
                <th className="sortable lft" onClick={() => setSort("owner")}>Owner{arrow("owner")}</th>
                <th className="lft">VP</th>
                <th className="lft">{basisCol}</th>
                <th className="sortable" onClick={() => setSort("raw")}>Raw{arrow("raw")}</th>
                <th className="sortable" onClick={() => setSort("weight")}>Weight{arrow("weight")}</th>
                <th className="sortable" onClick={() => setSort("wtd")}>Weighted{arrow("wtd")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id} className="wf-deal" onClick={() => onDeal(d.id)} onMouseEnter={() => prefetchDeal(d.id)} title="Open deal">
                  <td>{d.account}</td>
                  <td className="lft">{d.owner}</td>
                  <td className="lft">{d.vp}</td>
                  <td className="lft">{d.basis}</td>
                  <td>{fmtM(d.raw)}</td>
                  <td><span className="wf-wt">×{d.weight.toFixed(2)}</span></td>
                  <td>{fmtM(d.wtd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>
    </>,
    document.body
  );
}

// Skeleton mirror of the hero — the big pipeline card on the left + AI-score / at-risk cards
// on the right, so the shell paints instantly while the book loads (no spinner-gated blank).
function StatsSkeleton() {
  return (
    <div className="dl-head">
      <div className="dl-hero">
        <Card className="dl-bigcard">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-4 h-9 w-40" />
          <Skeleton className="mt-2 h-3 w-32" />
          <Skeleton className="mt-4 h-3.5 w-full rounded-full" />
          <div className="mt-3 flex gap-4">
            <Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-20" />
          </div>
        </Card>
        <div className="dl-hero-right">
          <Card className="dl-aicard">
            <Skeleton className="h-3 w-16" />
            <div className="mt-3 flex items-center gap-3">
              <Skeleton className="size-16 rounded-full" />
              <div className="space-y-2"><Skeleton className="h-7 w-12" /><Skeleton className="h-3 w-16" /></div>
            </div>
          </Card>
          <Card className="dl-riskcard">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DealsStats() {
  const { filtered, statsOff, loading } = useDashboard();
  const router = useRouter();
  const [open, setOpen] = useState<null | "forecast" | "pipeline">(null);
  const [drawer, setDrawer] = useState<null | "forecast" | "pipeline">(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Dead deals (won / lost / qualified out / omitted) are already hidden from the lists
  // by keepRecord; this is the same canonical test as a safety net so no rollup can ever
  // count one even if it reaches here another way.
  // Per-row toggle: deals switched OFF (in statsOff) are excluded from EVERY top card
  // (pipeline / commit / at-risk / AI score / both weighted) — they stay in the list,
  // they just don't count toward the totals. Everything below flows from `recs`.
  const recs = filtered.filter((r: any) => !isDeadDeal(r) && !statsOff.has(r.opp_id));
  const amt = (r: any) => Number(r.hard?.amount) || 0;
  const isAtRisk = (r: any) => { const v = verdictTone(r.ai?.north_star_verdict?.verdict); return v === "v-slow" || v === "v-off"; };
  const pipeline = recs.reduce((n, r) => n + amt(r), 0);
  const commitRecs = recs.filter((r: any) => r.hard?.forecast_category === "Commit");
  const commit = commitRecs.reduce((n, r) => n + amt(r), 0);
  const atRiskRecs = recs.filter(isAtRisk);
  const atRisk = atRiskRecs.reduce((n, r) => n + amt(r), 0);
  const score = (r: any) => { const c = r.analysis_confidence; return c === "High" ? 85 : c === "Medium" ? 62 : c === "Low" ? 40 : 60; };
  const aiScore = recs.length ? Math.round(recs.reduce((n, r) => n + score(r), 0) / recs.length) : 0;
  const aiLabel = aiScore >= 75 ? "Very Good" : aiScore >= 55 ? "Good" : "Fair";
  const aiColor = aiScore >= 75 ? "#1f9d57" : aiScore >= 55 ? "#d99a00" : "#d6453b";

  // Both weighted views run over OPEN deals only — closed/dead stages (Closed Won/Lost,
  // Qualified Out, No Decision, Omitted) are excluded from the weighted sums AND the base.
  const openRecs = recs.filter((r: any) => stageBucket(r.hard?.stage) !== null);
  const openBase = openRecs.reduce((n, r) => n + amt(r), 0);
  const openCount = openRecs.length;
  const excluded = recs.length - openCount;

  // --- Weighted FORECAST (by forecast category, open deals only) ---
  const weighted = openRecs.reduce((n, r) => n + amt(r) * fcBucket(r.hard?.forecast_category).weight, 0);
  const weightedPct = openBase ? Math.round((weighted / openBase) * 100) : 0;
  const fcGrouped: Record<string, Row> = {};
  for (const r of openRecs) {
    const b = fcBucket(r.hard?.forecast_category);
    const g = fcGrouped[b.key] || (fcGrouped[b.key] = { label: b.label, weight: b.weight, count: 0, raw: 0, wtd: 0 });
    g.count += 1; g.raw += amt(r);
  }
  const fcRows = Object.values(fcGrouped).map((g) => ({ ...g, wtd: g.raw * g.weight }))
    .sort((a, b) => b.weight - a.weight);
  const fcTop: TopDeal[] = openRecs
    .map((r: any) => { const b = fcBucket(r.hard?.forecast_category); const raw = amt(r); return { id: r.opp_id, account: r.hard?.account_name || r.hard?.opp_name || "—", label: b.label, weight: b.weight, raw, wtd: raw * b.weight }; })
    .filter((d) => d.raw > 0).sort((a, b) => b.wtd - a.wtd).slice(0, 8);

  // --- Weighted PIPELINE (by stage, open deals only) ---
  const stGrouped: Record<string, Row & { order: number }> = {};
  let weightedPipe = 0;
  const stTopSrc: TopDeal[] = [];
  for (const r of openRecs) {
    const b = stageBucket(r.hard?.stage)!; // non-null: openRecs excludes closed/dead
    const raw = amt(r);
    weightedPipe += raw * b.weight;
    const g = stGrouped[b.key] || (stGrouped[b.key] = { label: b.label, weight: b.weight, count: 0, raw: 0, wtd: 0, order: b.order });
    g.count += 1; g.raw += raw;
    stTopSrc.push({ id: r.opp_id, account: r.hard?.account_name || r.hard?.opp_name || "—", label: b.label, weight: b.weight, raw, wtd: raw * b.weight });
  }
  const stRows = Object.values(stGrouped).map((g) => ({ ...g, wtd: g.raw * g.weight })).sort((a, b) => a.order - b.order);
  const stTop = stTopSrc.filter((d) => d.raw > 0).sort((a, b) => b.wtd - a.wtd).slice(0, 8);
  const weightedPipePct = openBase ? Math.round((weightedPipe / openBase) * 100) : 0;

  // ── Hero: pipeline-composition bar (a layered forecast-confidence view of the total) ──
  // Commit (raw) → Weighted forecast ($-weighted) → Best case (raw best/upside) → Remaining
  // (the long tail). Widths are normalised to their own sum so the bar always fills exactly.
  const bestCase = openRecs
    .filter((r: any) => ["best", "upside"].includes(fcBucket(r.hard?.forecast_category).key))
    .reduce((n, r) => n + amt(r), 0);
  const remaining = Math.max(0, pipeline - commit - weighted - bestCase);
  const segs = [
    { key: "commit", label: "Commit", value: commit, color: "#3448d6" },
    { key: "weighted", label: "Weighted forecast", value: weighted, color: "#7c4dff" },
    { key: "best", label: "Best case", value: bestCase, color: "#1f9d57" },
    { key: "remaining", label: "Remaining", value: remaining, color: "var(--line2)" },
  ];
  const segTotal = segs.reduce((n, s) => n + s.value, 0) || 1;
  // "X of Y in view": Y = deals in the book (dead already excluded), X = those still counted
  // (a per-row toggle can switch a deal out of the totals without hiding it from the list).
  const inBook = filtered.filter((r: any) => !isDeadDeal(r)).length;

  // "triage now" jumps the user down to the deal table so they can start working the at-risk list.
  const triage = () => document.getElementById("grid")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Fast open, same as the deals list: a ?deal=<id> QUERY change on the same /deals segment
  // (the deals layout's URL-sync opens the drawer instantly) — NOT a /deals/<id> segment change,
  // which mounts a whole route and is what made this laggy.
  const goDeal = (id: string) => { if (!id) return; setOpen(null); setDrawer(null); router.push(`/deals?deal=${id}`, { scroll: false }); };

  // Skeleton-first: while the book loads, show the card frames with placeholders instead
  // of flashing real "$0" totals. Hooks above always run first, so this early return is safe.
  if (loading && !filtered.length) return <StatsSkeleton />;

  return (
    <div className="dl-head">
      <div className="dl-hero">
        {/* Total pipeline — the big card. The weighted-forecast callout stays click-to-open
            (the existing breakdown modal), so the drill-down survives the redesign. */}
        <Card
          role="button" tabIndex={0} aria-haspopup="dialog"
          onClick={() => setOpen("forecast")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen("forecast"); } }}
          title="See the full pipeline breakdown"
          className="dl-bigcard dl-bigcard--click"
        >
          <div className="dl-big-top">
            <span className="dl-eyebrow">Total Pipeline</span>
            <div className="dl-wf">
              <span className="dl-wf-label">Weighted forecast</span>
              <span className="dl-wf-val">{fmtM(weighted)}</span>
              <span className="dl-wf-sub">{weightedPct}% of open pipeline</span>
            </div>
          </div>
          <div className="dl-bignum">{fmtM(pipeline)}</div>
          <div className="dl-big-deals">{recs.length} of {inBook} deals in view · <span className="dl-big-more">view breakdown ↗</span></div>
          <div className="dl-bar" role="img" aria-label="Pipeline composition by forecast confidence">
            {segs.map((s) => s.value > 0 ? (
              <span key={s.key} className="dl-seg" title={`${s.label} · ${fmtM(s.value)}`}
                style={{ width: `${(s.value / segTotal) * 100}%`, background: s.color }} />
            ) : null)}
          </div>
          <div className="dl-legend">
            {segs.map((s) => (
              <span key={s.key} className="dl-leg">
                <i style={{ background: s.color }} />{s.label} <b>{fmtM(s.value)}</b>
              </span>
            ))}
          </div>
        </Card>

        {/* Right column: AI score (ring) + At risk */}
        <div className="dl-hero-right">
          <Card className="dl-aicard">
            <span className="dl-eyebrow">AI Score</span>
            <div className="dl-ai-row">
              <ScoreRing value={aiScore} color={aiColor} />
              <div className="dl-ai-meta">
                <span className="dl-ai-num" style={{ color: aiColor }}>{aiScore}</span>
                <span className="dl-ai-badge" style={{ color: aiColor, background: `${aiColor}1a` }}>{aiLabel}</span>
              </div>
            </div>
            <div className="dl-ai-cap">Forecast confidence across book</div>
          </Card>

          <Card className="dl-riskcard">
            <span className="dl-risk-h">⚠ At Risk</span>
            <div className="dl-risk-num">{fmtM(atRisk)}</div>
            <button type="button" className="dl-risk-cta" onClick={triage}>
              {atRiskRecs.length} deals need review · <span>triage now →</span>
            </button>
          </Card>
        </div>
      </div>

      {open ? (
        <WeightedModal
          activeTab={open} onTab={setOpen}
          label={open === "forecast" ? "Weighted forecast" : "Weighted pipeline"}
          big={fmtM(open === "forecast" ? weighted : weightedPipe)}
          sub={open === "forecast"
            ? `${weightedPct}% of ${fmtM(openBase)} open pipeline · ${openCount} open deals weighted by forecast category${excluded > 0 ? ` · ${excluded} closed/excluded` : ""}`
            : `${weightedPipePct}% of ${fmtM(openBase)} open pipeline · ${openCount} open deals weighted by stage${excluded > 0 ? ` · ${excluded} closed/excluded` : ""}`}
          catCol={open === "forecast" ? "Forecast category" : "Stage"}
          rows={open === "forecast" ? fcRows : stRows}
          totalLabel="Open pipeline" totalCount={openCount} totalRaw={openBase}
          totalWtd={open === "forecast" ? weighted : weightedPipe}
          totalWeightCell={`${open === "forecast" ? weightedPct : weightedPipePct}%`}
          top={open === "forecast" ? fcTop : stTop}
          onClose={() => setOpen(null)} onDeal={goDeal}
          onSeeAll={() => { setDrawer(open); setOpen(null); }} seeAllCount={openCount}
        />
      ) : null}

      {drawer === "forecast" ? (
        <WeightedDrawer
          title="Weighted forecast" basisCol="Forecast category" base={openRecs}
          weightOf={(r) => fcBucket(r.hard?.forecast_category).weight}
          basisOf={(r) => fcBucket(r.hard?.forecast_category).label}
          onClose={() => setDrawer(null)} onDeal={goDeal}
        />
      ) : null}

      {drawer === "pipeline" ? (
        <WeightedDrawer
          title="Weighted pipeline" basisCol="Stage" base={openRecs}
          weightOf={(r) => stageBucket(r.hard?.stage)?.weight ?? 0}
          basisOf={(r) => stageBucket(r.hard?.stage)?.label ?? "—"}
          onClose={() => setDrawer(null)} onDeal={goDeal}
        />
      ) : null}
    </div>
  );
}
