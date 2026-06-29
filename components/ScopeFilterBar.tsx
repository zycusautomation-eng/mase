"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useDashboard, type DealFilters } from "@/lib/engine/DashboardContext";
import { vpsList, teamOwners, uniqSorted, fyq, healthLabel, STAGE_ORDER, SCORE_BANDS, type Rec } from "@/lib/engine/helpers";
import MultiSelect, { type Opt } from "@/components/MultiSelect";

const SIZE_OPTS: Opt[] = [
  { value: "lt250", label: "< $250K" },
  { value: "250to1m", label: "$250K – $1M" },
  { value: "gt1m", label: "> $1M" },
];
const AI_OPTS: Opt[] = ["AI Hungry", "AI Curious", "AI Resistant"].map((v) => ({ value: v, label: v }));
// Canonical ordering for the Verdict facet (healthLabel outputs); "—" = no verdict.
const VERDICT_RANK: Record<string, number> = { "On track": 0, "Slowing": 1, "Close-date risk": 2, "Off track": 3, "—": 9 };
const stageRank = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 999 : i; };

export default function ScopeFilterBar() {
  const { records, vps, rsds, setVps, setRsds, scoped, filters, setFilter, clearFilters, filtered, locked, blocked, scopeName, canSeeScores } = useDashboard();

  // Blocked users (not a known rep/VP/admin) get no deals and no filters.
  if (blocked) {
    return (
      <div className="filterbar" id="dealfilters">
        <span className="scopelock">No deals are assigned to your account. Contact your admin for access.</span>
      </div>
    );
  }

  const vpOpts: Opt[] = vpsList(records).map((v) => ({ value: v, label: v }));
  const ownerOpts: Opt[] = teamOwners(records, vps).map((o) => ({ value: o, label: o }));

  const hard = scoped.map((r: Rec) => r.hard || {});
  const fc: Opt[] = uniqSorted(hard.map((h) => h.forecast_category)).map((v) => ({ value: v as string, label: v as string }));
  const co: Opt[] = uniqSorted(hard.map((h) => h.billing_country)).map((v) => ({ value: v as string, label: v as string }));
  const cq: Opt[] = [...new Map(hard.map((h) => { const q = fyq(h.close_date); return [q.key, q.label]; })).entries()]
    .sort((a, b) => (a[0] as number) - (b[0] as number)).map((e) => ({ value: e[1] as string, label: e[1] as string }));
  // Stage facet — distinct stages present, ordered by the pipeline sequence (not alphabetical).
  const st: Opt[] = Array.from(new Set(hard.map((h) => h.stage).filter(Boolean) as string[]))
    .sort((a, b) => stageRank(a) - stageRank(b)).map((v) => ({ value: v, label: v }));
  // Verdict facet — distinct momentum verdicts present (via healthLabel), in canonical order.
  const vd: Opt[] = Array.from(new Set(scoped.map((r: Rec) => healthLabel(((r.ai || {}).north_star_verdict || {}).verdict))))
    .sort((a, b) => (VERDICT_RANK[a] ?? 5) - (VERDICT_RANK[b] ?? 5))
    .map((v) => ({ value: v, label: v === "—" ? "No verdict" : v }));
  // Deal-score band facets — fixed buckets so a VP/CRO can pull deals by Win, Momentum, etc.
  const toOpt = (a: string[]): Opt[] => a.map((v) => ({ value: v, label: v }));
  const winOpts = toOpt(SCORE_BANDS.win_position);
  const momOpts = toOpt(SCORE_BANDS.deal_momentum);
  const cmtOpts = toOpt(SCORE_BANDS.customer_commitment);
  const riskOpts = toOpt(SCORE_BANDS.deal_risk);
  const fcScoreOpts = toOpt(SCORE_BANDS.forecast_confidence);

  const dirty = Object.values(filters).some((v) => v.length > 0);
  const f = (k: keyof DealFilters) => (v: string[]) => setFilter(k, v);

  return (
    <div className="filterbar" id="dealfilters">
      {/* scope — locked to the logged-in user, or free pickers for admins.
          A VP (locked with their team in `vps`) keeps a people picker limited to
          their own reps so they can drill into an individual; a single rep gets
          no picker (they only ever see their own deals). */}
      {locked ? (
        vps.length > 0 ? (
          <>
            <span className="scopelock" title="Your view is scoped to your team">
              Viewing: <b>{scopeName}</b>&apos;s team
            </span>
            <MultiSelect allLabel="All reps" options={ownerOpts} selected={rsds} onChange={setRsds} />
          </>
        ) : (
          <span className="scopelock" title="Your view is scoped to your account">
            Viewing: <b>{scopeName}</b>
          </span>
        )
      ) : (
        <>
          <MultiSelect allLabel="All VPs" options={vpOpts} selected={vps} onChange={setVps} />
          <MultiSelect allLabel={vps.length ? "All in selected teams" : "All RSDs"} options={ownerOpts} selected={rsds} onChange={setRsds} />
        </>
      )}

      <span className="fdivider" />

      {/* refinement filters */}
      <MultiSelect allLabel="All forecast" options={fc} selected={filters.forecast} onChange={f("forecast")} />
      <MultiSelect allLabel="All Stage" options={st} selected={filters.stage} onChange={f("stage")} />
      <MultiSelect allLabel="All countries" options={co} selected={filters.country} onChange={f("country")} />
      <MultiSelect allLabel="All deal sizes" options={SIZE_OPTS} selected={filters.size} onChange={f("size")} />
      <MultiSelect allLabel="All AI excitement" options={AI_OPTS} selected={filters.ai} onChange={f("ai")} />
      <MultiSelect allLabel="All Verdict" options={vd} selected={filters.verdict} onChange={f("verdict")} />
      <MultiSelect allLabel="All close quarters" options={cq} selected={filters.close} onChange={f("close")} />

      {/* deal-score band filters — admins + VPs only */}
      {canSeeScores ? (
        <>
          <span className="fdivider" />
          <MultiSelect allLabel="All Win" options={winOpts} selected={filters.win} onChange={f("win")} />
          <MultiSelect allLabel="All Momentum" options={momOpts} selected={filters.momentum} onChange={f("momentum")} />
          <MultiSelect allLabel="All Commitment" options={cmtOpts} selected={filters.commitment} onChange={f("commitment")} />
          <MultiSelect allLabel="All Risk" options={riskOpts} selected={filters.risk} onChange={f("risk")} />
          <MultiSelect allLabel="All FC" options={fcScoreOpts} selected={filters.fc} onChange={f("fc")} />
        </>
      ) : null}

      {dirty ? <button className="fclear" onClick={clearFilters}>Clear</button> : null}
      <span className="fcount" id="f-count">{filtered.length} of {scoped.length} deal{scoped.length === 1 ? "" : "s"}</span>
    </div>
  );
}
