"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { aiLabel, fyq, inScope, sizeBand, type Rec } from "./helpers";

export interface DealFilters {
  forecast: string;
  country: string;
  size: string;
  ai: string;
  close: string;
}
const EMPTY_FILTERS: DealFilters = { forecast: "all", country: "all", size: "all", ai: "all", close: "all" };

interface DashboardState {
  records: Rec[];
  playbook: any;
  loading: boolean;
  error: string | null;
  vp: string;
  rsd: string;
  filters: DealFilters;
  query: string;
  setVp: (v: string) => void;
  setRsd: (v: string) => void;
  setFilter: (k: keyof DealFilters, v: string) => void;
  clearFilters: () => void;
  setQuery: (q: string) => void;
  // records narrowed by VP/RSD scope only (no dropdown filters)
  scoped: Rec[];
  // records narrowed by scope + dropdown filters (+ search, applied in Deals)
  filtered: Rec[];
}

const Ctx = createContext<DashboardState | null>(null);

export function useDashboard(): DashboardState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDashboard must be used inside <DashboardProvider>");
  return c;
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Rec[]>([]);
  const [playbook, setPlaybook] = useState<any>({ plays: [], by_competitor: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vp, setVpRaw] = useState("all");
  const [rsd, setRsd] = useState("all");
  const [filters, setFilters] = useState<DealFilters>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/deal-engine/opportunities", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
        // Defensive de-dupe: the book can contain the same opp_id more than once.
        const seen = new Set<string>();
        const recs = (j.records || []).filter((rec: Rec) => {
          const id = rec?.opp_id;
          if (id == null || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (!off) setRecords(recs);
      } catch (e: any) {
        if (!off) setError(e?.message || String(e));
      }
      try {
        const p = await (await fetch("/playbook.json", { cache: "no-store" })).json();
        if (!off) setPlaybook(p);
      } catch {
        /* plays optional */
      }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  // Selecting a VP resets the RSD and the dropdown filters (matches the original UX).
  const setVp = useCallback((v: string) => { setVpRaw(v); setRsd("all"); setFilters(EMPTY_FILTERS); }, []);
  const setFilter = useCallback((k: keyof DealFilters, v: string) => setFilters((f) => ({ ...f, [k]: v })), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const scoped = useMemo(() => records.filter((r) => inScope(r, vp, rsd)), [records, vp, rsd]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return scoped.filter((r) => {
      const h = r.hard || {};
      if (filters.forecast !== "all" && h.forecast_category !== filters.forecast) return false;
      if (filters.country !== "all" && h.billing_country !== filters.country) return false;
      if (filters.size !== "all" && sizeBand(h.amount) !== filters.size) return false;
      if (filters.ai !== "all" && aiLabel(h) !== filters.ai) return false;
      if (filters.close !== "all" && fyq(h.close_date).label !== filters.close) return false;
      if (q && ![h.account_name, h.opp_name, h.owner_name, h.manager_name, h.stage].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scoped, filters, query]);

  const value: DashboardState = {
    records, playbook, loading, error,
    vp, rsd, filters, query,
    setVp, setRsd, setFilter, clearFilters, setQuery,
    scoped, filtered,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
