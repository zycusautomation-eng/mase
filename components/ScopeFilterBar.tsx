"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useDashboard, type DealFilters } from "@/lib/engine/DashboardContext";
import { vpsList, teamOwners, uniqSorted, fyq, type Rec } from "@/lib/engine/helpers";

// The VP / RSD scope pills + hierarchy line (rsdBar in the original).
function ScopeBar() {
  const { records, vp, rsd, setVp, setRsd } = useDashboard();
  const vps = vpsList(records);
  const owners = teamOwners(records, vp);
  const teamLabel = vp === "all" ? "all teams" : `${vp}'s team`;

  return (
    <>
      {vp === "all" ? (
        <div className="hier">
          VP Sales: {vps.length ? vps.map((v, i) => (<span key={v}><b>{v}</b>{i < vps.length - 1 ? " · " : ""}</span>)) : "—"}. Pick a VP to scope the book to their team.
        </div>
      ) : (
        <div className="hier">
          <b>{vp}</b> — VP Sales &nbsp;·&nbsp; RSDs reporting in: {owners.map((o, i) => (<span key={o}><b>{o}</b>{i < owners.length - 1 ? ", " : ""}</span>)) || "—"}
        </div>
      )}

      <div className="rsdbar vpbar">
        <span className={`rsdpill vp ${vp === "all" ? "active" : ""}`} onClick={() => setVp("all")}>All VPs</span>
        {vps.map((v) => (
          <span key={v} className={`rsdpill vp ${vp === v ? "active" : ""}`} onClick={() => setVp(v)}>{v}</span>
        ))}
      </div>
      <div className="rsdbar">
        <span className={`rsdpill ${rsd === "all" ? "active" : ""}`} onClick={() => setRsd("all")}>All ({teamLabel})</span>
        {owners.map((o) => (
          <span key={o} className={`rsdpill ${rsd === o ? "active" : ""}`} onClick={() => setRsd(o)}>{o}</span>
        ))}
      </div>
    </>
  );
}

function Dropdown({ id, value, allLabel, options, onChange }: {
  id: keyof DealFilters; value: string; allLabel: string;
  options: { v: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <select id={`f-${id}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">{allLabel}</option>
      {options.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
    </select>
  );
}

// The dropdown filter bar (renderDealControls in the original) — now shown on every route.
function FilterBar() {
  const { scoped, filters, setFilter, clearFilters, filtered } = useDashboard();
  const hard = scoped.map((r: Rec) => r.hard || {});
  const fc = uniqSorted(hard.map((h) => h.forecast_category));
  const co = uniqSorted(hard.map((h) => h.billing_country));
  const cq = [...new Map(hard.map((h) => { const q = fyq(h.close_date); return [q.key, q.label]; })).entries()]
    .sort((a, b) => (a[0] as number) - (b[0] as number)).map((e) => e[1] as string);

  return (
    <div className="dealfilters" id="dealfilters">
      <Dropdown id="forecast" value={filters.forecast} allLabel="All forecast" onChange={(v) => setFilter("forecast", v)}
        options={fc.map((v) => ({ v, label: v }))} />
      <Dropdown id="country" value={filters.country} allLabel="All countries" onChange={(v) => setFilter("country", v)}
        options={co.map((v) => ({ v, label: v }))} />
      <Dropdown id="size" value={filters.size} allLabel="All deal sizes" onChange={(v) => setFilter("size", v)}
        options={[{ v: "lt250", label: "< $250K" }, { v: "250to1m", label: "$250K – $1M" }, { v: "gt1m", label: "> $1M" }]} />
      <Dropdown id="ai" value={filters.ai} allLabel="All AI excitement" onChange={(v) => setFilter("ai", v)}
        options={["AI Hungry", "AI Curious", "AI Resistant"].map((v) => ({ v, label: v }))} />
      <Dropdown id="close" value={filters.close} allLabel="All close quarters" onChange={(v) => setFilter("close", v)}
        options={cq.map((v) => ({ v, label: v }))} />
      <button className="fclear" onClick={clearFilters}>Clear</button>
      <span className="fcount" id="f-count">{filtered.length} of {scoped.length} deal{scoped.length === 1 ? "" : "s"}</span>
    </div>
  );
}

export default function ScopeFilterBar() {
  return (
    <div className="scopewrap">
      <div className="dealscope"><ScopeBar /></div>
      <FilterBar />
    </div>
  );
}
