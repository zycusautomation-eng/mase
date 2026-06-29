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
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { verdictTone, vpOf, vpsList, teamOwners, inScope } from "@/lib/engine/helpers";
import MultiSelect, { type Opt } from "@/components/MultiSelect";

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

function Spark({ color, up }: { color: string; up: boolean }) {
  const pts = up ? [5, 8, 6, 10, 8, 12, 9, 14, 13] : [13, 10, 12, 8, 10, 6, 9, 5, 6];
  const w = 92, h = 30, max = 16;
  const d = pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }} aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Row = { label: string; count: number; raw: number; weight: number; wtd: number };
type TopDeal = { id: string; account: string; label: string; weight: number; raw: number; wtd: number };

// Shared breakdown modal for the two weighted cards.
function WeightedModal({ label, big, sub, catCol, rows, totalLabel, totalCount, totalRaw, totalWtd, totalWeightCell, top, onClose, onDeal, onSeeAll, seeAllCount }: {
  label: string; big: string; sub: string; catCol: string;
  rows: Row[]; totalLabel: string; totalCount: number; totalRaw: number; totalWtd: number; totalWeightCell: string;
  top: TopDeal[]; onClose: () => void; onDeal: (id: string) => void; onSeeAll?: () => void; seeAllCount?: number;
}) {
  return (
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
                <tr key={d.id} className="wf-deal" onClick={() => onDeal(d.id)} title="Open deal">
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
    </>
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

  return (
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
                <tr key={d.id} className="wf-deal" onClick={() => onDeal(d.id)} title="Open deal">
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
    </>
  );
}

export default function DealsStats() {
  const { filtered } = useDashboard();
  const router = useRouter();
  const [open, setOpen] = useState<null | "forecast" | "pipeline">(null);
  const [drawer, setDrawer] = useState<null | "forecast" | "pipeline">(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A dead deal (Lost / Qualified Out / Omitted — by stage OR forecast category) is not a
  // live opportunity: exclude it from EVERY rollup and total below. Mirrors the backend's
  // deal_engine_scoring.is_dead_deal.
  const isDead = (r: any): boolean => {
    const s = String(r?.hard?.stage || "").toLowerCase();
    const fc = String(r?.hard?.forecast_category || "").toLowerCase();
    return s.includes("closed lost") || s.includes("qualified out") || s.trim() === "lost" || fc === "omitted";
  };
  const recs = filtered.filter((r: any) => !isDead(r));
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

  const goDeal = (id: string) => { if (!id) return; setOpen(null); setDrawer(null); router.push(`/deals/${id}`); };
  const cardKeydown = (which: "forecast" | "pipeline") => (e: any) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(which); } };

  return (
    <div className="dl-head">
      <div className="dl-stats">
        <div className="dl-card">
          <div className="dl-top">Total Pipeline</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(pipeline)}</div><div className="dl-sub">{recs.length} of {recs.length} deals</div></div><div className="dl-spark"><Spark color="#1f9d57" up /></div></div>
        </div>
        <div className="dl-card">
          <div className="dl-top">Commit</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(commit)}</div><div className="dl-sub">{commitRecs.length} deals</div></div><div className="dl-spark"><Spark color="#5b8cff" up /></div></div>
        </div>
        <div className="dl-card">
          <div className="dl-top">At Risk</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(atRisk)}</div><div className="dl-sub">{atRiskRecs.length} deals</div></div><div className="dl-spark"><Spark color="#d6453b" up={false} /></div></div>
        </div>
        <div className="dl-card">
          <div className="dl-top">AI Score</div>
          <div className="dl-row"><div><div className="dl-big">{aiScore}</div><div className="dl-sub" style={{ color: aiColor }}>● {aiLabel}</div></div>
            <div className="dl-donut" style={{ ["--p" as any]: aiScore, ["--c" as any]: aiColor }}><span /></div>
          </div>
        </div>
        <div className="dl-card clickable" role="button" tabIndex={0} aria-haspopup="dialog" onClick={() => setOpen("forecast")} onKeyDown={cardKeydown("forecast")}>
          <div className="dl-top">Weighted Forecast <span className="dl-hint">view ↗</span></div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(weighted)}</div><div className="dl-sub">{weightedPct}% of open pipeline</div></div><div className="dl-spark"><Spark color="#7c4dff" up /></div></div>
        </div>
        <div className="dl-card clickable" role="button" tabIndex={0} aria-haspopup="dialog" onClick={() => setOpen("pipeline")} onKeyDown={cardKeydown("pipeline")}>
          <div className="dl-top">Weighted Pipeline <span className="dl-hint">view ↗</span></div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(weightedPipe)}</div><div className="dl-sub">{weightedPipePct}% of open pipeline</div></div><div className="dl-spark"><Spark color="#0ea5a3" up /></div></div>
        </div>
      </div>

      {open === "forecast" ? (
        <WeightedModal
          label="Weighted forecast" big={fmtM(weighted)}
          sub={`${weightedPct}% of ${fmtM(openBase)} open pipeline · ${openCount} open deals weighted by forecast category${excluded > 0 ? ` · ${excluded} closed/excluded` : ""}`}
          catCol="Forecast category" rows={fcRows}
          totalLabel="Open pipeline" totalCount={openCount} totalRaw={openBase} totalWtd={weighted} totalWeightCell={`${weightedPct}%`}
          top={fcTop} onClose={() => setOpen(null)} onDeal={goDeal}
          onSeeAll={() => { setOpen(null); setDrawer("forecast"); }} seeAllCount={openCount}
        />
      ) : null}

      {open === "pipeline" ? (
        <WeightedModal
          label="Weighted pipeline" big={fmtM(weightedPipe)}
          sub={`${weightedPipePct}% of ${fmtM(openBase)} open pipeline · ${openCount} open deals weighted by stage${excluded > 0 ? ` · ${excluded} closed/excluded` : ""}`}
          catCol="Stage" rows={stRows}
          totalLabel="Open pipeline" totalCount={openCount} totalRaw={openBase} totalWtd={weightedPipe} totalWeightCell={`${weightedPipePct}%`}
          top={stTop} onClose={() => setOpen(null)} onDeal={goDeal}
          onSeeAll={() => { setOpen(null); setDrawer("pipeline"); }} seeAllCount={openCount}
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
