// Data Quality engine. Scores the freshness/completeness/consistency of the
// book that was swept from Salesforce + Avoma. Runs on RAW records (no stage-fix
// / AIS fallback) so it surfaces the underlying data issues, not the app's
// cosmetic corrections. Pure + deterministic; the page stamps "checked at".
/* eslint-disable @typescript-eslint/no-explicit-any */
import { keepRecord, STAGE_ORDER, dealComps, type Rec } from "./helpers";

// "True insight" detection — a fact counts as KNOWN if it appears in the direct
// SF field OR in related fields / opp name / the AI-synthesized sections (which
// already fold in SF tasks + Avoma). So we don't false-flag a gap when the
// information is captured elsewhere; we only flag when it's genuinely absent.
const KNOWN_COMP = /coupa|ariba|\bsap\b|\bgep\b|ivalua|jaggaer|oracle|basware|sirion|medius|workday|docusign|scanmarket|pactum|proactis|synertrade|veenion|zip\b|amazon business|tradeshift/i;
const PRODUCT_TOKENS = /\b(ANA|Agentic AI|AppXtend|Certinal|eInvoicing|eProcurement|iContract|iLogix|iManage|iRequest|iRisk|iSaaS|iSave|iSource|iSupplier|iCompliance|Lythouse|Merlin|Merlin Intake|ML iAnalyze|TMS|S2P|S2C|P2P|CLM|SRM)\b/i;

export interface DQExample { acct: string; opp: string; detail?: string }
export interface DQCheck { key: string; label: string; bad: number; total: number; examples: DQExample[] }
export interface DQDimension { key: string; label: string; score: number; checks: DQCheck[] }
export interface DQLagger { acct: string; opp: string; owner: string; change: string; kind: string; sweptAt: string; daysBehind: number }
export interface DQSync { reSweeps: number; distinctOpps: number; bySource: Record<string, number>; changedNotReswept: number; laggers: DQLagger[] }
export interface DQResult { total: number; overall: number; dimensions: DQDimension[]; today: string; sync: DQSync; lastSync: string; lastSyncCount: number }

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

// --- To-do quality detection ---
// Busywork: a "to-do" that just fills/repairs Salesforce instead of moving the deal.
const TODO_BUSYWORK = /__c\b|populate|log (recent )?activity|fix salesforce|salesforce hygiene|complete the (crm|salesforce)|reconstruct deal state|resolve .*data (access|integrity)|update salesforce|contact roles? in salesforce|diagnose .*data/i;
// Enterprise-motion grounding: references a buying-committee role OR a real milestone.
const TODO_COMMITTEE = /economic buyer|\beb\b|\bcfo\b|\bcpo\b|\bcoo\b|\bceo\b|decision maker|champion|sponsor|buying committee|procurement (lead|head|director|owner)/i;
const TODO_MILESTONE = /discover|demo|\brfi\b|\brfp\b|shortlist|shoe.?fit|shufit|\bbrd\b|business requirement|workshop|\bpoc\b|pilot|pric(e|ing)|commercial|negotiat|\broi\b|reference|infosec|security review|integrat|\bsow\b|\bmsa\b|redlin|legal|tender|proposal|use.?case|onsite|enablement/i;
// Stage-mechanics filler — telling a seasoned rep to "advance to the next stage" is not insight.
const TODO_FILLER = /move (it )?to (formal eval|shortlist|qualified|negotiation|vendor select|proposal)|advance (the deal )?to|progress (the deal )?to (the )?(next stage|formal eval|shortlist)|reach (formal eval|shortlist|[a-z ]+stage) by/i;
const moveText = (r: Rec): string => items((r.ai || {}).recommended_moves).map((m: any) => String(m.action || "")).join("  ");

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

export function computeDataQuality(rawRecords: Rec[], triggerLogs: any[] = []): DQResult {
  const t = today();
  // App scope: dedupe + drop BD/cross-sell/delivery owners. Keep RAW fields.
  const seen = new Set<string>();
  const recs = (rawRecords || []).filter((r) => {
    const id = r?.opp_id; if (id == null || seen.has(id)) return false; seen.add(id);
    return keepRecord(r); // same app scope as the dashboard (drops BD/cross-sell/delivery + unmapped owners)
  });
  const h = (r: Rec) => r.hard || {};
  const ai = (r: Rec) => r.ai || {};

  const completeness = dim("completeness", "Completeness (true insight, any source)", [
    check("ais", "AI Excitement not assessable (no score or AI signal anywhere)", recs, (r) => {
      const hh = h(r), a = ai(r);
      const known = !empty(hh.ais_score) || !empty(hh.ais_status) || !!(a.ai_fit_signal || {}).tier || !!(a.ai_positioning_strength || {}).summary;
      return known ? false : "no AIS score or AI signal";
    }),
    check("amount", "Amount missing or zero", recs, (r) => { const n = Number(h(r).amount); return (!h(r).amount || n === 0) ? "amount " + (h(r).amount ?? "—") : false; }),
    check("close", "Close date missing", recs, (r) => empty(h(r).close_date) ? "no close_date" : false),
    check("owner", "Owner missing", recs, (r) => empty(h(r).owner_name) ? "no owner" : false),
    check("products", "Product scope not identified anywhere", recs, (r) => {
      const hh = h(r), a = ai(r);
      if (!empty(hh.products)) return false;
      const txt = [hh.opp_name, (a.competitive_position || {}).summary, ...items(a.recommended_moves).map((m: any) => m.action)].filter(Boolean).join(" ");
      return PRODUCT_TOKENS.test(txt) ? false : "no product scope in field / opp name / analysis";
    }),
    check("competitor", "Competition not identified anywhere (field / Avoma / analysis)", recs, (r) => {
      const a = ai(r), cp = a.competitive_position || {};
      const known = dealComps(h(r)).length > 0 || items(cp).length > 0 || KNOWN_COMP.test(cp.summary || "");
      return known ? false : "no competition intel";
    }),
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

  // Sweep triggers — when a Salesforce change fires a trigger, is the account
  // freshly re-swept (SF + Avoma)? Lag = the record changed after its last sweep.
  const trigErr = (triggerLogs || []).filter((l: any) => l && (l.error || (l.status && l.status !== "completed")));
  const triggers = dim("triggers", "Sweep triggers", [
    check("lag", "Account changed after its last sweep (not freshly re-swept)", recs, (r) => {
      const sw = r.swept_at; const newest = [h(r).last_modified_date, h(r).last_activity_date].filter(Boolean).sort().pop();
      return (sw && newest && newest > sw) ? `changed ${newest} > swept ${sw}` : false;
    }, (r) => !!r.swept_at && (!!h(r).last_modified_date || !!h(r).last_activity_date)),
    check("nosweep", "Record never swept (no timestamp)", recs, (r) => !r.swept_at ? "no swept_at" : false),
    ...(triggerLogs && triggerLogs.length ? [{
      key: "trigerr", label: "Logged trigger re-sweeps that failed", bad: trigErr.length, total: triggerLogs.length,
      examples: trigErr.slice(0, 5).map((l: any) => ({ acct: l.account_name || "—", opp: l.opp_name || l.opp_id, detail: l.error || l.status })),
    } as DQCheck] : []),
  ]);

  // To-Do quality — are the to-dos worth a RevOps head's time? (1) do they move the deal /
  // de-risk it rather than fill Salesforce, (2) are they grounded in the 12-month enterprise
  // buying motion (committee + milestones), (3) are moving deals still carrying stale to-dos.
  const hasMoves = (r: Rec) => items(ai(r).recommended_moves).length > 0;
  const recent = (d: any, n: number) => { if (!d) return false; const x = daysBetween(d, t); return x >= 0 && x <= n; };
  const hasMomentum = (r: Rec) => recent(h(r).last_activity_date, 21) || recent(h(r).last_modified_date, 14);
  const todoQuality = dim("todoq", "To-Do quality (do they move the deal?)", [
    check("todo_busywork", "To-dos that fill Salesforce instead of moving the deal", recs, (r) => {
      const m = items(ai(r).recommended_moves).find((x: any) => TODO_BUSYWORK.test(String(x.action || "")));
      return m ? String(m.action).slice(0, 90) : false;
    }, hasMoves),
    check("todo_motion", "To-dos not grounded in the enterprise buying motion (committee / milestone)", recs, (r) => {
      const txt = moveText(r);
      if (TODO_FILLER.test(txt)) return "stage-mechanics filler ('advance to next stage')";
      return (TODO_COMMITTEE.test(txt) || TODO_MILESTONE.test(txt)) ? false : "generic — no committee role or milestone named";
    }, (r) => hasMoves(r) && !["Initial Interest", "Prospecting"].includes(h(r).stage)),
    check("todo_stale_active", "Moving deals still showing stale data / to-dos", recs, (r) => {
      const sw = r.swept_at; const lastChange = [h(r).last_modified_date, h(r).last_activity_date].filter(Boolean).sort().pop();
      if (sw && lastChange && lastChange > sw) return `moved ${lastChange} after sweep ${sw}`;
      const pastMove = items(ai(r).recommended_moves).find((x: any) => x.act_by && x.act_by < t);
      return pastMove ? `to-do past-due (act_by ${pastMove.act_by})` : false;
    }, hasMomentum),
  ]);

  const dimensions = [completeness, freshness, consistency, meddpicc, avoma, analysis, triggers, todoQuality];
  const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);

  // Sync activity — how many re-sweeps ran (and from where) vs accounts that
  // changed but were NOT re-swept. Answers "swept again vs triggers received".
  const bySource: Record<string, number> = {};
  const distinct = new Set<string>();
  for (const l of triggerLogs || []) {
    bySource[l.source || "unknown"] = (bySource[l.source || "unknown"] || 0) + 1;
    const id = l.opp_id_15 || l.opp_id; if (id) distinct.add(id);
  }
  const laggers = recs.map((r) => {
    const sw = r.swept_at; if (!sw) return null;
    const cands: [string, string][] = [];
    if (h(r).last_modified_date) cands.push(["modified", h(r).last_modified_date]);
    if (h(r).last_activity_date) cands.push(["activity", h(r).last_activity_date]);
    if (!cands.length) return null;
    cands.sort((a, b) => a[1].localeCompare(b[1]));
    const [kind, change] = cands[cands.length - 1];
    if (!(change > sw)) return null;
    return { acct: h(r).account_name || "—", opp: h(r).opp_name || r.opp_id, owner: h(r).owner_name || "—", change, kind, sweptAt: sw, daysBehind: daysBetween(sw, change) };
  }).filter(Boolean).sort((a: any, b: any) => b.daysBehind - a.daysBehind) as DQLagger[];
  const sync: DQSync = { reSweeps: (triggerLogs || []).length, distinctOpps: distinct.size, bySource, changedNotReswept: laggers.length, laggers };

  // Last sync = the most recent swept_at across the book, ignoring future-dated outliers.
  const sweptDates = recs.map((r) => r.swept_at).filter((s): s is string => !!s && s <= t).sort();
  const lastSync = sweptDates.length ? sweptDates[sweptDates.length - 1] : "";
  const lastSyncCount = lastSync ? sweptDates.filter((s) => s === lastSync).length : 0;

  return { total: recs.length, overall, dimensions, today: t, sync, lastSync, lastSyncCount };
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
