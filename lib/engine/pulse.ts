// Frontend mirror of the backend engagement-pulse governance (deal_engine_pulse.py).
//
// The backend stamps `record.pulse` from verified Salesforce signals and RECOMPUTES
// it live on read — so `pulse.as_of` is always today. BUT the reconciliation that
// retires pulse-contradicting flags (retire_contradicted_hygiene) only runs at
// SWEEP time. Every record swept before the pulse system — i.e. the whole book
// right now — still carries the agent's frozen "ghost / dark-for-months / N-months-
// silent / future-date" flags, even when its live pulse says the deal is active.
//
// This module applies the SAME governance at RENDER time, so a live pulse suppresses
// the contradicting flags on every record immediately, without waiting for a
// re-sweep. Keep the markers + thresholds in sync with deal_engine_pulse.py.

export interface PulseLike {
  state?: string;
  as_of?: string;
  summary?: string;
  last_activity_date?: string;
  days_since_activity?: number | null;
  rep_outreach?: { detected?: boolean; date?: string; note?: string } | null;
}

// Keep in sync with deal_engine_pulse.LIVE_DAYS.
const LIVE_DAYS = 30;

export function isPulseLive(p?: PulseLike | null): boolean {
  return !!p && String(p.state || "").toLowerCase() === "live";
}

// Mirror of deal_engine_pulse._GHOST_MARKERS.
const GHOST_MARKERS = [
  "ghost",
  "gone dark", "dark for", "deal is dark", "appears dark", "going dark",
  "future date", "future-date", "future activity date",
  "lastactivitydate is a future", "last activity date is a future",
  "actual last activity",
  "wrong stage", "stage is wrong", "stale stage", "incorrect stage",
  "data quality", "data-quality",
  "no recent activity", "no activity in", "dormant", "stalled out",
];

// Mirror of deal_engine_pulse.flag_contradicts_live_pulse. High precision: only
// fires against an explicitly LIVE pulse, and only on stale-worldview phrasings,
// so a legitimate live flag (single-thread, missing EB, …) is never touched.
export function flagContradictsLivePulse(text: unknown, p?: PulseLike | null): boolean {
  if (!isPulseLive(p)) return false;
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  if (GHOST_MARKERS.some((s) => t.includes(s))) return true;
  // "N months since / silence / no contact / unaddressed / dark / …" — a months-long
  // gap directly contradicts a live pulse. Handle "15 months", "15+ months" and
  // "15-17 months" forms.
  if (/\d+\+?(?:\s*-\s*\d+)?\s*months?/.test(t)
      && /(since|silence|no contact|no buyer|without|ago|dark|stall|engage|reach|unaddressed|ignored|never (delivered|reached)|disengaged|no re-?engage)/.test(t)) {
    return true;
  }
  // "N days since last buyer touch / overdue" where N clearly exceeds the live window.
  const m = t.match(/(\d+)\s*days?/);
  if (m && /(since last|no contact|no buyer|silence|without|dark|no activity|overdue)/.test(t)) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > LIVE_DAYS) return true;
  }
  return false;
}

// Chip descriptor for the drawer/verdict header. Colors match runs/page.tsx.
export function pulseChip(
  p?: PulseLike | null,
): { label: string; color: string; title: string } | null {
  if (!p || !p.state) return null;
  const s = String(p.state).toLowerCase();
  const color = s === "live" ? "#0F9D6B" : s === "cooling" ? "#C9881A" : s === "dark" ? "#D6453B" : "#7E8DA1";
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return { label, color, title: p.summary || "" };
}
