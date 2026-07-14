"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { useDashboard, type DealFilters } from "@/lib/engine/DashboardContext";
import { vpsList, teamOwners, ownersForVpsStatic, uniqSorted, fyq, STAGE_ORDER, SCORE_BANDS, normCountry, type Rec } from "@/lib/engine/helpers";
import MultiSelect, { type Opt } from "@/components/MultiSelect";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Star, Crown, SlidersHorizontal, X, ChevronDown } from "lucide-react";

const SIZE_OPTS: Opt[] = [
  { value: "lt250", label: "< $250K" },
  { value: "250to1m", label: "$250K – $1M" },
  { value: "gt1m", label: "> $1M" },
];
const AI_OPTS: Opt[] = ["AI Hungry", "AI Curious", "AI Resistant"].map((v) => ({ value: v, label: v }));
const stageRank = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 999 : i; };

export default function ScopeFilterBar() {
  const { records, vps, rsds, setVps, setRsds, scoped, filters, setFilter, clearFilters, filtered, locked, blocked, scopeName, scopeVps, canSeeScores, isAdminView, favsOnly, setFavsOnly, favs } = useDashboard();

  // Filters popover (progressive disclosure) — hooks must run before any early return.
  const [fopen, setFopen] = useState(false);
  const fref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fopen) return;
    const onDoc = (e: MouseEvent) => { if (fref.current && !fref.current.contains(e.target as Node)) setFopen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [fopen]);

  // Blocked users (not a known rep/VP/admin) get no deals and no filters.
  if (blocked) {
    return (
      <div className="filterbar" id="dealfilters">
        <span className="scopelock">No deals are assigned to your account. Contact your admin for access.</span>
      </div>
    );
  }

  const vpOpts: Opt[] = vpsList(records).map((v) => ({ value: v, label: v }));
  // Owners = those WITH deals in the book UNION the configured roster for the selected
  // VPs, so a brand-new RSD with no deals yet (e.g. Graeme Yates) is still selectable.
  const ownerOpts: Opt[] = (uniqSorted([...teamOwners(records, vps), ...ownersForVpsStatic(vps)]) as string[])
    .map((o) => ({ value: o, label: o }));

  const hard = scoped.map((r: Rec) => r.hard || {});
  const fc: Opt[] = uniqSorted(hard.map((h) => h.forecast_category)).map((v) => ({ value: v as string, label: v as string }));
  // Canonicalised so "US" and "United States" collapse into ONE option (see normCountry).
  const co: Opt[] = uniqSorted(hard.map((h) => normCountry(h.billing_country))).map((v) => ({ value: v as string, label: v as string }));
  const cq: Opt[] = [...new Map(hard.map((h) => { const q = fyq(h.close_date); return [q.key, q.label]; })).entries()]
    .sort((a, b) => (a[0] as number) - (b[0] as number)).map((e) => ({ value: e[1] as string, label: e[1] as string }));
  // Stage facet — distinct stages present, ordered by the pipeline sequence (not alphabetical).
  const st: Opt[] = Array.from(new Set(hard.map((h) => h.stage).filter(Boolean) as string[]))
    .sort((a, b) => stageRank(a) - stageRank(b)).map((v) => ({ value: v, label: v }));
  // Deal-score band facets — fixed buckets so a VP/CRO can pull deals by Win, Momentum, etc.
  const toOpt = (a: string[]): Opt[] => a.map((v) => ({ value: v, label: v }));
  const winOpts = toOpt(SCORE_BANDS.win_position);
  const momOpts = toOpt(SCORE_BANDS.deal_momentum);

  const ceoOn = ((filters.ceo || []) as string[]).includes("CEO help needed");
  const dirty = Object.values(filters).some((v) => v.length > 0) || favsOnly;

  // All refinement facets live behind one "Filters" popover; applied ones show as chips.
  const FACETS: { key: keyof DealFilters; label: string; opts: Opt[] }[] = [
    { key: "stage", label: "Stage", opts: st },
    { key: "country", label: "Country", opts: co },
    { key: "size", label: "Deal size", opts: SIZE_OPTS },
    { key: "ai", label: "AI excitement", opts: AI_OPTS },
    ...(canSeeScores ? ([
      { key: "win", label: "Win position", opts: winOpts },
      { key: "momentum", label: "Deal momentum", opts: momOpts },
    ] as { key: keyof DealFilters; label: string; opts: Opt[] }[]) : []),
  ];
  const labelOf = (opts: Opt[], v: string) => opts.find((o) => o.value === v)?.label || v;
  const activeFacets = FACETS.filter((fa) => ((filters[fa.key] || []) as string[]).length > 0);
  const f = (k: keyof DealFilters) => (v: string[]) => setFilter(k, v);

  return (
    <div className="filterbar" id="dealfilters">
      {/* scope — locked to the logged-in user, or free pickers for admins.
          A VP (locked with their team in `vps`) keeps a people picker limited to
          their own reps so they can drill into an individual; a single rep gets
          no picker (they only ever see their own deals). */}
      {locked ? (
        scopeVps.length > 0 ? (
          <>
            <span className="scopelock" title="Your view is scoped to your team/region">
              Viewing: <b>{scopeName}</b>{scopeVps.length === 1 ? "’s team" : ""}
            </span>
            {/* Regional admin (locked to MULTIPLE VP books, e.g. Europe = Woodcock + Gray):
                a VP picker LIMITED to their region so they can slice by VP. Empty selection
                = the whole region (never the whole company). A single-VP lock has nothing
                to pick, so no VP picker is shown there. */}
            {scopeVps.length > 1 ? (
              <MultiSelect
                allLabel="All VPs"
                options={scopeVps.map((v) => ({ value: v, label: v }))}
                selected={vps.length === scopeVps.length ? [] : vps}
                onChange={(sel) => setVps(sel.length ? sel : scopeVps)}
              />
            ) : null}
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

      {/* favourites — personal starred deals (localStorage). Toggles the book to favs only. */}
      <Button
        type="button" variant="outline" size="sm"
        aria-pressed={favsOnly}
        onClick={() => setFavsOnly(!favsOnly)}
        title={favsOnly ? "Showing only your favourites — click to show all" : "Show only your favourite deals"}
        className={cn(
          "h-8 gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold",
          favsOnly
            ? "border-[#f0b400] bg-[#fff7e0] text-[#8a6100] hover:bg-[#fbe9bf] hover:text-[#8a6100]"
            : "border-[var(--line)] text-[var(--ink2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
        )}
      >
        <Star className={cn("size-3.5", favsOnly ? "fill-[#f0b400] text-[#f0b400]" : "text-[#f0b400]")} />
        Favourites{favs.size ? ` (${favs.size})` : ""}
      </Button>

      {/* CEO help — quick toggle beside Favourites: filters the book to deals that need
          CEO intervention. ADMIN-ONLY: hidden entirely for non-admins (and for an admin
          simulating a non-admin view). */}
      {isAdminView && (
      <Button
        type="button" variant="outline" size="sm"
        aria-pressed={ceoOn}
        onClick={() => setFilter("ceo", ceoOn ? [] : ["CEO help needed"])}
        title={ceoOn ? "Showing only deals needing CEO help — click to show all" : "Show only deals needing CEO help"}
        className={cn(
          "h-8 gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold",
          ceoOn
            ? "border-[#e0443e] bg-[#fdecea] text-[#a12622] hover:bg-[#f9dad6] hover:text-[#a12622]"
            : "border-[var(--line)] text-[var(--ink2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
        )}
      >
        <Crown className={cn("size-3.5", ceoOn ? "text-[#e0443e]" : "text-[var(--muted)]")} />
        CEO help
      </Button>
      )}

      <span className="fdivider" />

      {/* pinned — Forecast + Close Quarter stay on the bar (core to any forecast call) */}
      <MultiSelect allLabel="All forecast" options={fc} selected={filters.forecast} onChange={f("forecast")} />
      <MultiSelect allLabel="All close quarters" options={cq} selected={filters.close} onChange={f("close")} />

      {/* Filters — single entry point (progressive disclosure) */}
      <div className="fpop" ref={fref}>
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => setFopen((o) => !o)}
          aria-expanded={fopen} title="Filters"
          className={cn(
            "h-8 gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold",
            activeFacets.length
              ? "border-[var(--accent)] text-[var(--accent)] hover:text-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
          )}
        >
          <SlidersHorizontal className="size-3.5" /> Filters
          {activeFacets.length ? (
            <Badge className="ml-0.5 h-4 min-w-4 justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] tabular-nums text-white">{activeFacets.length}</Badge>
          ) : null}
          <ChevronDown className={cn("size-3 text-[var(--muted)] transition-transform", fopen && "rotate-180")} />
        </Button>
        {fopen ? (
          <div className="fpop-panel">
            <div className="fpop-grid">
              {FACETS.map((fa) => (
                <div className="fpop-facet" key={fa.key as string}>
                  <div className="fpop-flabel">{fa.label}</div>
                  <MultiSelect allLabel="Any" options={fa.opts} selected={(filters[fa.key] || []) as string[]} onChange={f(fa.key)} />
                </div>
              ))}
            </div>
            {activeFacets.length ? <button type="button" className="fpop-clearall" onClick={clearFilters}>Clear all filters</button> : null}
          </div>
        ) : null}
      </div>

      {/* active-filter chips — only applied facets take space */}
      {activeFacets.map((fa) => (
        <Badge
          key={fa.key as string}
          variant="secondary"
          className="max-w-[280px] gap-1.5 rounded-full border-transparent bg-[var(--accent-soft)] py-1 pl-2.5 pr-1 text-[12px] font-normal text-[var(--ink2)]"
        >
          <span className="font-semibold text-[var(--accent)]">{fa.label}</span>
          <span className="truncate">{((filters[fa.key] || []) as string[]).map((v) => labelOf(fa.opts, v)).join(", ")}</span>
          <button
            type="button"
            onClick={() => f(fa.key)([])}
            aria-label={`Clear ${fa.label}`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-black/10 hover:text-[var(--ink)]"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {dirty ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearFilters}
          className="h-8 rounded-lg px-2.5 text-[12px] font-semibold text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]">
          Clear all
        </Button>
      ) : null}
      <span className="fcount" id="f-count">{filtered.length} of {scoped.length} deal{scoped.length === 1 ? "" : "s"}</span>
    </div>
  );
}
