"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { trackAppOpenOnce } from "@/lib/tracking/client";
import { aiLabel, applyStageFix, ceoFilterLabel, fyq, healthLabel, inScope, isSuperAdminEmail, keepRecord, normCountry, resolveAccess, scoreBand, sizeBand, type Rec } from "./helpers";
import { createClient } from "@/lib/supabase/client";

// Each filter is a multi-select: an empty array means "all".
export interface DealFilters {
  forecast: string[];
  stage: string[];
  country: string[];
  size: string[];
  ai: string[];
  ceo: string[];
  verdict: string[];
  close: string[];
  win: string[];
  momentum: string[];
  commitment: string[];
  risk: string[];
  fc: string[];
}
const EMPTY_FILTERS: DealFilters = {
  forecast: [], stage: [], country: [], size: [], ai: [], ceo: [], verdict: [], close: [],
  win: [], momentum: [], commitment: [], risk: [], fc: [],
};

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
  // for a REGIONAL ADMIN (locked to multiple VPs, e.g. Europe = Woodcock + Gray): their
  // full assigned VP list = the max scope. Lets the filter bar offer a VP picker limited
  // to the region (empty selection resets to the whole region, never the whole company).
  // [] for a single-VP lock, an RSD, an admin, or a blocked user.
  scopeVps: string[];
  // admin-only impersonation: true if the REAL logged-in user is an admin
  realIsAdmin: boolean;
  // email currently being simulated (null = the admin's own whole-book view)
  simEmail: string | null;
  // gates admin-only surfaces (Admin/Runs/Learning/Sync Quality): the real user is
  // an admin AND is NOT simulating a non-admin view, so a simulated rep/VP view
  // hides them exactly as that user would see.
  isAdminView: boolean;
  // gates the Omnivision / Scoring Version Studio: the real user is a SUPER-ADMIN
  // (strict subset of admins — Aleen + Sam) and is not simulating another view.
  isSuperAdminView: boolean;
  // gates the deal-scores UI (Win/Momentum/Commitment/Risk/FC columns, drawer panel,
  // and the score band filters): visible ONLY to admins and VPs. RSDs / reps / unknown
  // users never see it. Reflects the EFFECTIVE view, so an admin simulating an RSD also
  // loses it.
  canSeeScores: boolean;
  // admins: re-scope the whole UI as if `email` were logged in. null resets.
  simulateAs: (email: string | null) => void;
  // whether the CURRENT user may use the RevOps Chat, per the admin access policy
  // (admins always; everyone, or a specific allowlist). Drives the chat nav link + the
  // /chat page guard. Read from /api/admin/chat-access (open GET returns the caller's
  // own `allowed`); the policy is set by admins in the admin panel.
  chatAllowed: boolean;
  // Personal favourites — starred deals, persisted per real user in localStorage.
  // `favsOnly` filters the book to just the starred deals (composes with the others).
  favs: Set<string>;
  isFav: (oppId: string) => boolean;
  toggleFav: (oppId: string) => void;
  favsOnly: boolean;
  setFavsOnly: (b: boolean) => void;
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
  const [scopeVps, setScopeVps] = useState<string[]>([]);   // regional-admin region (max scope)
  const [realIsAdmin, setRealIsAdmin] = useState(false);
  const [simEmail, setSimEmail] = useState<string | null>(null);
  const [canSeeScores, setCanSeeScores] = useState(false);
  // Favourites: starred opp_ids. Source of truth is the DB (per real logged-in user,
  // via /api/favourites → app_config), so stars follow the user across browsers and
  // devices. localStorage is kept only as a fast-load cache + the one-time migration
  // source for stars saved before the move. Personal bookmarks → keyed to the REAL
  // user, never the simulated one.
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [favsOnly, setFavsOnly] = useState(false);
  const [realEmail, setRealEmail] = useState<string | null>(null);
  const [chatAllowed, setChatAllowed] = useState(false);

  // Whether THIS user may use chat, per the admin access policy. Open GET — any
  // signed-in user reads their own `allowed` so the nav link + /chat guard can show
  // chat without being admin.
  useEffect(() => {
    fetch("/api/admin/chat-access", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setChatAllowed(!!j.allowed))
      .catch(() => { /* default off */ });
  }, []);

  // Usage tracking: record one app-open per loaded tab (the real active-session
  // signal — persisted sessions never generate a fresh auth login event).
  useEffect(() => { trackAppOpenOnce(); }, []);
  const favKey = `mase_favs:${realEmail || "default"}`;

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
      // back to the admin's own whole-book view
      setVpsRaw([]); setScopeVps([]); setRsds([]); setScopeName(null); setLocked(false); setBlocked(false);
      setCanSeeScores(true);
      return;
    }
    const a = resolveAccess(email);
    if (a.kind === "scoped") {
      setVpsRaw(a.vps); setScopeVps(a.vps); setRsds(a.rsds); setScopeName(a.name); setLocked(true); setBlocked(false);
      // a VP is scoped to their own team (vps set); an RSD is scoped to their deals
      // (rsds set). Only the VP may see scores.
      setCanSeeScores(a.vps.length > 0);
    } else if (a.kind === "blocked") {
      setVpsRaw([]); setScopeVps([]); setRsds([]); setScopeName(email); setLocked(true); setBlocked(true);
      setCanSeeScores(false);
    } else {
      // simulating another admin = whole book
      setVpsRaw([]); setScopeVps([]); setRsds([]); setScopeName(null); setLocked(false); setBlocked(false);
      setCanSeeScores(true);
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
        setRealEmail(data.user?.email || null);
        const access = resolveAccess(data.user?.email);
        if (off) return;
        if (access.kind === "scoped") {
          setVpsRaw(access.vps);
          setScopeVps(access.vps);
          setRsds(access.rsds);
          setScopeName(access.name);
          setLocked(true);
          // VP (team scope) sees scores; an RSD (own-deals scope) does not.
          setCanSeeScores(access.vps.length > 0);
        } else if (access.kind === "blocked") {
          setBlocked(true);
          setLocked(true);
          setCanSeeScores(false);
        } else {
          // admin: leave the book open, and restore any saved simulation.
          setRealIsAdmin(true);
          setCanSeeScores(true);
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
  const clearFilters = useCallback(() => { setFilters(EMPTY_FILTERS); setFavsOnly(false); }, []);

  // Load favourites: paint the cached set instantly, then reconcile with the DB (the
  // source of truth). One-time migration: if the DB has none for this user but this
  // browser does, push the local stars up so nobody loses bookmarks in the move.
  useEffect(() => {
    let cached: string[] = [];
    try { cached = JSON.parse(localStorage.getItem(favKey) || "[]"); } catch { cached = []; }
    if (cached.length) setFavs(new Set(cached));
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/favourites", { credentials: "include" });
        if (!res.ok || off) return;
        const body = await res.json();
        if (off) return;
        const server: string[] = Array.isArray(body?.favs) ? body.favs.map(String) : [];
        if (server.length === 0 && cached.length > 0) {
          setFavs(new Set(cached));
          fetch("/api/favourites", {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ opp_ids: cached }),
          }).catch(() => { /* retried on next toggle */ });
        } else {
          setFavs(new Set(server));
          try { localStorage.setItem(favKey, JSON.stringify(server)); } catch { /* cache only */ }
        }
      } catch { /* offline / not signed in — keep the cached set */ }
    })();
    return () => { off = true; };
  }, [favKey]);

  const toggleFav = useCallback((oppId: string) => {
    if (!oppId) return;
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(oppId)) next.delete(oppId); else next.add(oppId);
      const arr = [...next];
      // Cache locally for instant reloads, then persist the full set to the DB
      // (optimistic — the UI already reflects the change).
      try { localStorage.setItem(favKey, JSON.stringify(arr)); } catch { /* cache only */ }
      fetch("/api/favourites", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opp_ids: arr }),
      }).catch(() => { /* stays in localStorage; re-synced on next toggle/load */ });
      return next;
    });
  }, [favKey]);
  const isFav = useCallback((oppId: string) => favs.has(oppId), [favs]);

  const scoped = useMemo(
    () => (blocked ? [] : records.filter((r) => inScope(r, vps, rsds))),
    [records, vps, rsds, blocked]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return scoped.filter((r) => {
      if (favsOnly && !favs.has(r.opp_id)) return false;
      const h = r.hard || {};
      if (filters.forecast.length && !filters.forecast.includes(h.forecast_category)) return false;
      if (filters.stage.length && !filters.stage.includes(h.stage)) return false;
      if (filters.country.length && !filters.country.includes(normCountry(h.billing_country))) return false;
      if (filters.size.length && !filters.size.includes(sizeBand(h.amount))) return false;
      if (filters.ai.length && !filters.ai.includes(aiLabel(h, (r.ai || {}).ai_fit_signal))) return false;
      if (filters.ceo.length && !filters.ceo.includes(ceoFilterLabel((r.ai || {}).ceo_intervention))) return false;
      if (filters.verdict.length && !filters.verdict.includes(healthLabel(((r.ai || {}).north_star_verdict || {}).verdict))) return false;
      // Deal-score band filters (read from ai.deal_scores.headline)
      const ds = ((r.ai || {}).deal_scores || {}).headline || {};
      if (filters.win.length && !filters.win.includes(scoreBand("win_position", ds.win_position))) return false;
      if (filters.momentum.length && !filters.momentum.includes(scoreBand("deal_momentum", ds.deal_momentum))) return false;
      if (filters.commitment.length && !filters.commitment.includes(scoreBand("customer_commitment", ds.customer_commitment))) return false;
      if (filters.risk.length && !filters.risk.includes(scoreBand("deal_risk", ds.deal_risk))) return false;
      if (filters.fc.length && !filters.fc.includes(scoreBand("forecast_confidence", ds.forecast_confidence))) return false;
      if (filters.close.length && !filters.close.includes(fyq(h.close_date).label)) return false;
      if (q && ![h.account_name, h.opp_name, h.owner_name, h.manager_name, h.stage].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scoped, filters, query, favsOnly, favs]);

  const value: DashboardState = {
    records, playbook, loading, error,
    vps, rsds, filters, query,
    setVps, setRsds, setFilter, clearFilters, setQuery,
    scoped, filtered,
    locked, blocked, scopeName, scopeVps,
    realIsAdmin, simEmail, isAdminView: realIsAdmin && !simEmail,
    isSuperAdminView: isSuperAdminEmail(realEmail) && !simEmail,
    canSeeScores, simulateAs,
    chatAllowed,
    favs, isFav, toggleFav, favsOnly, setFavsOnly,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
