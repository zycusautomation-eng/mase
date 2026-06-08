// Data Quality engine. Scores the freshness/completeness/consistency of the
// book that was swept from Salesforce + Avoma. Runs on RAW records (no stage-fix
// / AIS fallback) so it surfaces the underlying data issues, not the app's
// cosmetic corrections. Pure + deterministic; the page stamps "checked at".
/* eslint-disable @typescript-eslint/no-explicit-any */
import { keepRecord, STAGE_ORDER, type Rec } from "./helpers";

export interface DQExample { acct: string; opp: string; detail?: string }
export interface DQCheck { key: string; label: string; bad: number; total: number; examples: DQExample[] }
export interface DQDimension { key: string; label: string; score: number; checks: DQCheck[] }
export interface DQResult { total: number; overall: number; dimensions: DQDimension[]; today: string }

const SF_STAGES = new Set(STAGE_ORDER);

function today(): string {
  try { return new Date().toISOString().slice(0, 10); } catch { return "2026-06-06"; }
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}
const ex = (r: Rec, detail?: string): DQExample => ({ acct: (r.hard || {}).account_name || "—", opp: (r.hard || {}).opp_name || r.opp_id, detail });
const empty = (v: any) => v == null || v === "" || (typeof v === "string" && /^(—|n\/a|none|tbd|null)$/i.test(v.trim()));
const items = (v: any): any[] => (Array.isArray(v) ? v : (v && v.items) || []);

// Build a check over a denominator subset (default: all records).
function check(key: string, label: string, recs: Rec[], isBad: (r: Rec) => string | false, denom?: (r: Rec) => boolean): DQCheck {
  const scope = denom ? recs.filter(denom) : recs;
  const examples: DQExample[] = [];
  let bad = 0;
  for (const r of scope) {
    const d = isBad(r);
    if (d !== false) { bad++; if (examples.length < 5) examples.push(ex(r, d || undefined)); }
  }
  return { key, label, bad, total: scope.length, examples };
}
function dim(key: string, label: string, checks: DQCheck[]): DQDimension {
  const scored = checks.filter((c) => c.total > 0);
  const score = scored.length ? Math.round(scored.reduce((s, c) => s + (c.total - c.bad) / c.total, 0) / scored.length * 100) : 100;
  return { key, label, score, checks };
}

export function computeDataQuality(rawRecords: Rec[]): DQResult {
  const t = today();
  // App scope: dedupe + drop BD/cross-sell/delivery owners. Keep RAW fields.
  const seen = new Set<string>();
  const recs = (rawRecords || []).filter((r) => {
    const id = r?.opp_id; if (id == null || seen.has(id)) return false; seen.add(id);
    return keepRecord(r); // same app scope as the dashboard (drops BD/cross-sell/delivery + unmapped owners)
  });
  const h = (r: Rec) => r.hard || {};
  const ai = (r: Rec) => r.ai || {};

  const completeness = dim("completeness", "Completeness", [
    check("ais", "AI Excitement score missing", recs, (r) => empty(h(r).ais_score) ? "no ais_score" : false),
    check("amount", "Amount missing or zero", recs, (r) => { const n = Number(h(r).amount); return (!h(r).amount || n === 0) ? "amount " + (h(r).amount ?? "—") : false; }),
    check("close", "Close date missing", recs, (r) => empty(h(r).close_date) ? "no close_date" : false),
    check("owner", "Owner missing", recs, (r) => empty(h(r).owner_name) ? "no owner" : false),
    check("products", "Products not attached", recs, (r) => empty(h(r).products) ? "no products" : false),
    check("competitor", "Competitor not logged", recs, (r) => (empty(h(r).competitor) && empty(h(r).primary_competitor)) ? "no competitor" : false),
    check("stakeholders", "No stakeholders mapped", recs, (r) => items(ai(r).stakeholder_map).length === 0 ? "0 contacts" : false),
    check("qdate", "Qualified date missing", recs, (r) => empty(h(r).qualified_date) ? "no qualified_date" : false,
      (r) => !["Initial Interest", "Prospecting"].includes(h(r).stage)),
  ]);

  const freshness = dim("freshness", "Freshness", [
    check("stale30", "Not swept in last 30 days", recs, (r) => { const s = r.swept_at; if (!s) return "never swept"; const d = daysBetween(s, t); return d > 30 ? `${d}d ago` : false; }),
    check("future", "Future-dated swept_at (timestamp error)", recs, (r) => { const s = r.swept_at; return s && daysBetween(s, t) < 0 ? `swept ${s}` : false; }),
    check("activity", "No activity logged in 60 days", recs, (r) => { const a = h(r).last_activity_date; if (!a) return "no activity"; const d = daysBetween(a, t); return d > 60 ? `${d}d ago` : false; }),
  ]);

  const consistency = dim("consistency", "Consistency", [
    check("stage", "Stage not in Salesforce picklist", recs, (r) => { const s = h(r).stage; return s && !SF_STAGES.has(s) ? s : false; }),
    check("createdclose", "Created after close date", recs, (r) => { const c = h(r).created_date, cl = h(r).close_date; return c && cl && c > cl ? `created ${c} > close ${cl}` : false; }),
    check("fcstage", "Commit/Best Case on an early stage", recs, (r) => (["Commit", "Best Case"].includes(h(r).forecast_category) && ["Qualified", "Formal Evaluation", "Initial Interest"].includes(h(r).stage)) ? `${h(r).forecast_category} @ ${h(r).stage}` : false),
    check("aisrange", "AI Excitement score out of 0–10 range", recs, (r) => { const n = Number(h(r).ais_score); return (h(r).ais_score != null && h(r).ais_score !== "" && (n < 0 || n > 10)) ? `score ${h(r).ais_score}` : false; }),
  ]);

  const meddpicc = dim("meddpicc", "MEDDPICC integrity", [
    check("painflag", "Pain captured but SF pain flag is off", recs, (r) => (h(r).pain_identified !== true && items(ai(r).gaps).length > 0) ? "gaps exist, flag off" : false),
    check("champflag", "Champion named but SF champion flag is off", recs, (r) => { const c = (ai(r).champion_strength || {}).champion; const real = c && !/^(none|not identified|no champion|n\/a)/i.test(String(c)); return (real && h(r).champion_identified !== true) ? String(c) : false; }),
    check("allblank", "All five MEDDPICC flags blank", recs, (r) => (![h(r).dm_identified, h(r).eb_identified, h(r).champion_identified, h(r).pain_identified, h(r).metrics_identified].some((x) => x === true)) ? "0/5 flags" : false),
  ]);

  const avoma = dim("avoma", "Avoma coverage", [
    check("avomaflag", "Avoma gap flagged by the engine", recs, (r) => {
      const flags: string[] = ((ai(r).best_practice_check || {}).flags) || [];
      const hit = flags.find((s) => /avoma|transcript|call/i.test(s) && /no |not |missing|without/i.test(s));
      return hit ? hit.slice(0, 80) : false;
    }),
    check("stalecontact", "Newest stakeholder contact > 60 days old", recs, (r) => { const sm = items(ai(r).stakeholder_map); if (!sm.length) return false; const dates = sm.map((s: any) => s.last_contact_date).filter(Boolean).sort(); const latest = dates.pop(); if (!latest) return "no contact dates"; const d = daysBetween(latest, t); return d > 60 ? `${d}d ago` : false; }, (r) => items(ai(r).stakeholder_map).length > 0),
  ]);

  const analysis = dim("analysis", "AI analysis completeness", [
    check("verdict", "No verdict generated", recs, (r) => !(ai(r).north_star_verdict || {}).verdict ? "no verdict" : false),
    check("moves", "No recommended moves", recs, (r) => items(ai(r).recommended_moves).length === 0 ? "0 moves" : false),
    check("conf", "Analysis confidence Low or missing", recs, (r) => { const c = r.analysis_confidence; return (!c || /low/i.test(c)) ? (c || "none") : false; }),
  ]);

  const dimensions = [completeness, freshness, consistency, meddpicc, avoma, analysis];
  const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  return { total: recs.length, overall, dimensions, today: t };
}

export function dqToCsv(res: DQResult): string {
  const rows = [["Dimension", "Check", "Affected", "Total", "Clean %", "Examples"]];
  for (const d of res.dimensions) for (const c of d.checks) {
    const cleanPct = c.total ? Math.round((c.total - c.bad) / c.total * 100) : 100;
    const exs = c.examples.map((e) => `${e.acct} — ${e.opp}${e.detail ? ` (${e.detail})` : ""}`).join(" | ");
    rows.push([d.label, c.label, String(c.bad), String(c.total), String(cleanPct), exs]);
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}
