"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { aiLabel, applyStageFix, fyq, healthLabel, inScope, keepRecord, resolveAccess, sizeBand, type Rec } from "./helpers";
import { createClient } from "@/lib/supabase/client";

// Each filter is a multi-select: an empty array means "all".
export interface DealFilters {
  forecast: string[];
  stage: string[];
  country: string[];
  size: string[];
  ai: string[];
  verdict: string[];
  close: string[];
}
const EMPTY_FILTERS: DealFilters = { forecast: [], stage: [], country: [], size: [], ai: [], verdict: [], close: [] };

interface DashboardState {
  records: Rec[];
  playbook: any;
  loading: boolean;
  error: string | null;
  vps: string[];
  rsds: string[];
  filters: DealFilters;
  query: string;
  setVps: (v: string[]) => void;
  setRsds: (v: string[]) => void;
  setFilter: (k: keyof DealFilters, v: string[]) => void;
  clearFilters: () => void;
  setQuery: (q: string) => void;
  // records narrowed by VP/RSD scope only (no dropdown filters)
  scoped: Rec[];
  // records narrowed by scope + dropdown filters (+ search, applied in Deals)
  filtered: Rec[];
  // scope is fixed to the logged-in user (non-admin) — hide the VP/RSD pickers
  locked: boolean;
  // logged-in user isn't a known rep/VP/admin — show no deals
  blocked: boolean;
  // display name the scope is locked to (e.g. "Alexa Bradley"), null if admin/blocked
  scopeName: string | null;
  // admin-only impersonation: true if the REAL logged-in user is an admin
  realIsAdmin: boolean;
  // email currently being simulated (null = the admin's own whole-book view)
  simEmail: string | null;
  // gates admin-only surfaces (Admin/Runs/Learning/Sync Quality): the real user is
  // an admin AND is NOT simulating a non-admin view, so a simulated rep/VP view
  // hides them exactly as that user would see.
  isAdminView: boolean;
  // admins: re-scope the whole UI as if `email` were logged in. null resets.
  simulateAs: (email: string | null) => void;
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

  const [vps, setVpsRaw] = useState<string[]>([]);
  const [rsds, setRsds] = useState<string[]>([]);
  const [filters, setFilters] = useState<DealFilters>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [locked, setLocked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [scopeName, setScopeName] = useState<string | null>(null);
  const [realIsAdmin, setRealIsAdmin] = useState(false);
  const [simEmail, setSimEmail] = useState<string | null>(null);

  // Admin-only: re-scope the entire dashboard as if `email` were the logged-in
  // user (impersonation preview). null = back to the admin's own whole-book view.
  // Drives the exact same locked/blocked/vps/rsds the real gate would, so the
  // admin sees precisely what that user sees. Client-side only — the admin still
  // fetched the whole book; this just filters it.
  const simulateAs = useCallback((email: string | null) => {
    setSimEmail(email);
    try {
      if (email) sessionStorage.setItem("mase_sim_as", email);
      else sessionStorage.removeItem("mase_sim_as");
    } catch { /* sessionStorage unavailable */ }
    setFilters(EMPTY_FILTERS);
    if (!email) {
      setVpsRaw([]); setRsds([]); setScopeName(null); setLocked(false); setBlocked(false);
      return;
    }
    const a = resolveAccess(email);
    if (a.kind === "scoped") {
      setVpsRaw(a.vps); setRsds(a.rsds); setScopeName(a.name); setLocked(true); setBlocked(false);
    } else if (a.kind === "blocked") {
      setVpsRaw([]); setRsds([]); setScopeName(email); setLocked(true); setBlocked(true);
    } else {
      // simulating another admin = whole book
      setVpsRaw([]); setRsds([]); setScopeName(null); setLocked(false); setBlocked(false);
    }
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Load the book SLIM (hard + verdict + ai-fit + pulse) — ~10-25x smaller than
        // the full records, so first paint is fast. Every deal is still loaded, so the
        // top search and the VP/RSD/filter facets cover the WHOLE book. The heavy ai
        // detail (MEDDPICC, moves, competitors, …) is fetched per-deal when its drawer
        // opens (DealDrawer → GET /opportunities/{opp_id}).
        const r = await fetch("/api/deal-engine/opportunities?slim=1", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
        // Defensive de-dupe: the book can contain the same opp_id more than once.
        // keepRecord drops BD / cross-sell / delivery owners (see helpers.OWNER_VP).
        const seen = new Set<string>();
        const recs = (j.records || []).filter((rec: Rec) => {
          const id = rec?.opp_id;
          if (id == null || seen.has(id)) return false;
          seen.add(id);
          return true;
        }).filter(keepRecord).map(applyStageFix);
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

  // Lock the scope to the logged-in user. Admins stay unlocked (whole book); a
  // VP is locked to their team, an RSD to their own deals, and anyone unknown is
  // blocked (sees nothing). Runs once on mount.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        const access = resolveAccess(data.user?.email);
        if (off) return;
        if (access.kind === "scoped") {
          setVpsRaw(access.vps);
          setRsds(access.rsds);
          setScopeName(access.name);
          setLocked(true);
        } else if (access.kind === "blocked") {
          setBlocked(true);
          setLocked(true);
        } else {
          // admin: leave the book open, and restore any saved simulation.
          setRealIsAdmin(true);
          try {
            const saved = sessionStorage.getItem("mase_sim_as");
            if (saved) simulateAs(saved);
          } catch { /* ignore */ }
        }
      } catch {
        // No session / Supabase unavailable — leave the book unscoped.
      }
    })();
    return () => { off = true; };
  }, []);

  // Changing the VP selection resets the RSD picker (its owner list changes).
  const setVps = useCallback((v: string[]) => { setVpsRaw(v); setRsds([]); }, []);
  const setFilter = useCallback((k: keyof DealFilters, v: string[]) => setFilters((f) => ({ ...f, [k]: v })), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const scoped = useMemo(
    () => (blocked ? [] : records.filter((r) => inScope(r, vps, rsds))),
    [records, vps, rsds, blocked]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return scoped.filter((r) => {
      const h = r.hard || {};
      if (filters.forecast.length && !filters.forecast.includes(h.forecast_category)) return false;
      if (filters.stage.length && !filters.stage.includes(h.stage)) return false;
      if (filters.country.length && !filters.country.includes(h.billing_country)) return false;
      if (filters.size.length && !filters.size.includes(sizeBand(h.amount))) return false;
      if (filters.ai.length && !filters.ai.includes(aiLabel(h, (r.ai || {}).ai_fit_signal))) return false;
      if (filters.verdict.length && !filters.verdict.includes(healthLabel(((r.ai || {}).north_star_verdict || {}).verdict))) return false;
      if (filters.close.length && !filters.close.includes(fyq(h.close_date).label)) return false;
      if (q && ![h.account_name, h.opp_name, h.owner_name, h.manager_name, h.stage].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scoped, filters, query]);

  const value: DashboardState = {
    records, playbook, loading, error,
    vps, rsds, filters, query,
    setVps, setRsds, setFilter, clearFilters, setQuery,
    scoped, filtered,
    locked, blocked, scopeName,
    realIsAdmin, simEmail, isAdminView: realIsAdmin && !simEmail, simulateAs,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
