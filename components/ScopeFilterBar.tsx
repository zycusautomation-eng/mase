"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useDashboard, type DealFilters } from "@/lib/engine/DashboardContext";
import { vpsList, teamOwners, uniqSorted, fyq, type Rec } from "@/lib/engine/helpers";

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

export default function ScopeFilterBar() {
  const { records, vp, rsd, setVp, setRsd, scoped, filters, setFilter, clearFilters, filtered } = useDashboard();

  const vps = vpsList(records);
  const owners = teamOwners(records, vp);

  const hard = scoped.map((r: Rec) => r.hard || {});
  const fc = uniqSorted(hard.map((h) => h.forecast_category));
  const co = uniqSorted(hard.map((h) => h.billing_country));
  const cq = [...new Map(hard.map((h) => { const q = fyq(h.close_date); return [q.key, q.label]; })).entries()]
    .sort((a, b) => (a[0] as number) - (b[0] as number)).map((e) => e[1] as string);

  const dirty = Object.values(filters).some((v) => v !== "all");
  const f = (k: keyof DealFilters) => (v: string) => setFilter(k, v);

  return (
    <div className="filterbar" id="dealfilters">
      {/* scope */}
      <Select value={vp} onChange={setVp}>
        <option value="all">All VPs</option>
        {vps.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>
      <Select value={rsd} onChange={setRsd}>
        <option value="all">{vp === "all" ? "All RSDs" : `All (${vp}'s team)`}</option>
        {owners.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>

      <span className="fdivider" />

      {/* filters */}
      <Select value={filters.forecast} onChange={f("forecast")}>
        <option value="all">All forecast</option>
        {fc.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>
      <Select value={filters.country} onChange={f("country")}>
        <option value="all">All countries</option>
        {co.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>
      <Select value={filters.size} onChange={f("size")}>
        <option value="all">All deal sizes</option>
        <option value="lt250">&lt; $250K</option>
        <option value="250to1m">$250K – $1M</option>
        <option value="gt1m">&gt; $1M</option>
      </Select>
      <Select value={filters.ai} onChange={f("ai")}>
        <option value="all">All AI excitement</option>
        {["AI Hungry", "AI Curious", "AI Resistant"].map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>
      <Select value={filters.close} onChange={f("close")}>
        <option value="all">All close quarters</option>
        {cq.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>

      {dirty ? <button className="fclear" onClick={clearFilters}>Clear</button> : null}
      <span className="fcount" id="f-count">{filtered.length} of {scoped.length} deal{scoped.length === 1 ? "" : "s"}</span>
    </div>
  );
}
