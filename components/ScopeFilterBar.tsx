"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useDashboard, type DealFilters } from "@/lib/engine/DashboardContext";
import { vpsList, teamOwners, uniqSorted, fyq, type Rec } from "@/lib/engine/helpers";
import MultiSelect, { type Opt } from "@/components/MultiSelect";

const SIZE_OPTS: Opt[] = [
  { value: "lt250", label: "< $250K" },
  { value: "250to1m", label: "$250K – $1M" },
  { value: "gt1m", label: "> $1M" },
];
const AI_OPTS: Opt[] = ["AI Hungry", "AI Curious", "AI Resistant"].map((v) => ({ value: v, label: v }));

export default function ScopeFilterBar() {
  const { records, vps, rsds, setVps, setRsds, scoped, filters, setFilter, clearFilters, filtered, locked, blocked, scopeName } = useDashboard();

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
      <MultiSelect allLabel="All countries" options={co} selected={filters.country} onChange={f("country")} />
      <MultiSelect allLabel="All deal sizes" options={SIZE_OPTS} selected={filters.size} onChange={f("size")} />
      <MultiSelect allLabel="All AI excitement" options={AI_OPTS} selected={filters.ai} onChange={f("ai")} />
      <MultiSelect allLabel="All close quarters" options={cq} selected={filters.close} onChange={f("close")} />

      {dirty ? <button className="fclear" onClick={clearFilters}>Clear</button> : null}
      <span className="fcount" id="f-count">{filtered.length} of {scoped.length} deal{scoped.length === 1 ? "" : "s"}</span>
    </div>
  );
}
