// Tiny in-memory cache + prefetcher for FULL deal records (the /opportunities/{id} payload
// the drawer needs to show MEDDPICC / moves / competitors). Today the drawer re-fetches
// that ~120 KB record from the network on EVERY open (~0.5 s of blank detail), which is a
// big part of why opening a deal feels slow.
//
// This is a deliberately small stop-gap until a real server-state layer (TanStack Query)
// lands — same idea, ~30 lines:
//   • getCachedDeal(id)  → return a still-fresh full record synchronously (instant re-open)
//   • prefetchDeal(id)   → warm the cache in the background (called on row hover), deduped
// so by the time a user clicks a row the full record is usually already here, and re-opening
// a deal is instant. Data still refreshes in the background so it never goes stale.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Entry = { rec: any; at: number };

const CACHE = new Map<string, Entry>();
const INFLIGHT = new Map<string, Promise<any>>();
const TTL = 5 * 60 * 1000; // 5 min — matches the dashboard's focus-refetch cadence

// Opp ids arrive as both 15- and 18-char forms; key on the 15-char prefix so a row and its
// drawer always hit the same cache entry.
const keyOf = (oid: string) => String(oid || "").slice(0, 15);

export function getCachedDeal(oid: string): any | null {
  const e = CACHE.get(keyOf(oid));
  return e && Date.now() - e.at < TTL ? e.rec : null;
}

// Fetch the full record into the cache (deduped). Returns the in-flight/next promise, or
// undefined when a fresh copy is already cached (nothing to do). Never throws.
export function prefetchDeal(oid: string): Promise<any> | undefined {
  const id = String(oid || "").trim();
  if (!id) return;
  const k = keyOf(id);
  if (getCachedDeal(id)) return; // already fresh
  const existing = INFLIGHT.get(k);
  if (existing) return existing;
  const p = fetch(`/api/deal-engine/opportunities/${encodeURIComponent(id)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const rec = j?.record || j;
      if (rec && (rec.opp_id || rec.hard)) CACHE.set(k, { rec, at: Date.now() });
      return rec;
    })
    .catch(() => null)
    .finally(() => { INFLIGHT.delete(k); });
  INFLIGHT.set(k, p);
  return p;
}
