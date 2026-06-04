// Pure derivation helpers ported from the original dashboard.html script.
// These operate on raw DealRecord JSON; kept framework-agnostic so every route reuses them.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Rec = any;
export type Hard = any;

export const TODAY = new Date("2026-06-03");

export const AI_ORDER: [string, string][] = [
  ["north_star_verdict", "North Star Verdict"],
  ["recommended_moves", "Recommended Moves"],
  ["deal_movement", "Deal Movement"],
  ["competitive_position", "Competitive Position"],
  ["customer_expectations_fit", "Customer Expectations Fit"],
  ["explicit_requirements", "Explicit Requirements"],
  ["implicit_requirements", "Implicit Requirements"],
  ["gaps", "Gaps"],
  ["best_practice_check", "Best Practice Check"],
  ["stakeholder_map", "Stakeholder Map"],
  ["champion_strength", "Champion Strength"],
  ["ai_positioning_strength", "AI Positioning Strength"],
  ["ai_fit_signal", "AI Fit Signal"],
  ["vulnerabilities", "Vulnerabilities"],
  ["open_deliverables", "Open Deliverables"],
  ["confidence_signals", "Confidence Signals"],
];

export const HARD_LABELS: Record<string, string> = {
  opp_name: "Opportunity", account_name: "Account", account_industry: "Industry",
  billing_country: "Country", owner_name: "Owner", owner_title: "Owner title",
  manager_name: "Manager", stage: "Stage", forecast_category: "Forecast",
  amount: "Amount", close_date: "Close date", days_to_close: "Days to close",
  created_date: "Created", products: "Products", next_step: "Next step",
  last_activity_date: "Last activity", last_modified_date: "Last modified",
  ais_score: "AI Excitement score", ais_status: "AI Excitement status", ais_why: "AI Excitement why",
  dm_identified: "DM identified", eb_identified: "EB identified",
  champion_identified: "Champion identified", pain_identified: "Pain identified",
  metrics_identified: "Metrics identified", competitor: "Competitor",
  primary_competitor: "Primary competitor", sf_link: "Salesforce",
};

export function fmtAmount(a: any): string {
  if (a == null || a === "") return "—";
  const n = Number(a);
  return isNaN(n) ? String(a) : "$" + n.toLocaleString();
}
export function num(v: any): number { const n = Number(v); return isNaN(n) ? 0 : n; }
export function cellStr(cell: any): string {
  if (!cell) return "";
  try { return JSON.stringify(cell).toLowerCase(); } catch { return String(cell).toLowerCase(); }
}
export function hasKW(s: string, kws: string[]): boolean { return kws.some((k) => s.includes(k)); }
export function slug(s: any): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// Fiscal year runs Apr to Mar. Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar.
export function fyq(ds: any): { label: string; key: number } {
  if (!ds) return { label: "No date", key: 9e9 };
  const y = +String(ds).slice(0, 4), m = +String(ds).slice(5, 7) - 1;
  if (isNaN(y) || isNaN(m)) return { label: "No date", key: 9e9 };
  const fyStart = m >= 3 ? y : y - 1;
  const qIdx = Math.floor(((m - 3 + 12) % 12) / 3);
  const yy2 = String((fyStart + 1) % 100).padStart(2, "0");
  return { label: `Q${qIdx + 1} FY${fyStart}-${yy2}`, key: fyStart * 4 + qIdx };
}
export function sizeBand(a: any): string {
  if (a == null || a === "") return "none";
  const n = Number(a);
  if (isNaN(n)) return "none";
  if (n < 250000) return "lt250";
  if (n <= 1000000) return "250to1m";
  return "gt1m";
}
export function daysSince(d: any): number { if (!d) return 9999; return Math.round((TODAY.getTime() - new Date(d).getTime()) / 86400000); }

export function aiTier(h: Hard): string | null {
  const st = (h.ais_status || "").toLowerCase();
  if (/hungry/.test(st)) return "Hungry";
  if (/curious/.test(st)) return "Curious";
  if (/resistant/.test(st)) return "Resistant";
  const n = Number(h.ais_score);
  if (h.ais_score != null && h.ais_score !== "" && !isNaN(n)) {
    if (n >= 7) return "Hungry";
    if (n >= 4) return "Curious";
    return "Resistant";
  }
  return null;
}
export function aiLabel(h: Hard): string { const t = aiTier(h); return t ? "AI " + t : "Not scored"; }

export function verdictTone(v: any): "v-on" | "v-risk" | "v-off" | "" {
  if (!v) return "";
  const k = String(v).toLowerCase();
  return k.includes("off") ? "v-off" : k.includes("risk") ? "v-risk" : "v-on";
}

// --- VP / RSD hierarchy ---
export function teamsMap(records: Rec[]): Record<string, string[]> {
  const m: Record<string, Set<string>> = {};
  records.forEach((r) => {
    const h = r.hard || {};
    const vp = h.manager_name || "(no VP)";
    const o = h.owner_name;
    if (!o) return;
    (m[vp] = m[vp] || new Set()).add(o);
  });
  const out: Record<string, string[]> = {};
  Object.keys(m).forEach((k) => (out[k] = [...m[k]].sort()));
  return out;
}
export function vpsList(records: Rec[]): string[] { return Object.keys(teamsMap(records)).sort(); }
export function teamOwners(records: Rec[], vp: string): string[] {
  const t = teamsMap(records);
  if (vp === "all") return [...new Set(Object.values(t).flat())].sort();
  return t[vp] || [];
}
export function inScope(r: Rec, vp: string, rsd: string): boolean {
  const h = r.hard || {};
  return (vp === "all" || h.manager_name === vp) && (rsd === "all" || h.owner_name === rsd);
}

export function uniqSorted(arr: any[]): any[] { return [...new Set(arr.filter((v) => v != null && v !== ""))].sort(); }

// --- dates ---
export function refToday(records: Rec[]): string {
  return records.map((r) => r && r.swept_at).filter(Boolean).sort().pop() || "2026-06-03";
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
export function diffDays(a: any, b: any): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}
export function fmtDue(iso: any): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
export function heavyStep(t: any): boolean {
  return /\b(poc|pilot|proof[- ]of[- ]concept|security review|infosec|pen[- ]?test|penetration|procurement|legal|red[- ]?line|redlin|msa|dpa|\bnda\b|rfp response|tender response|workshop|integration|sandbox|data migration|reference (call|visit|customer)|business case|sign[- ]?off)\b/i.test(t || "");
}
export function backPlannedDue(records: Rec[], closeISO: any, idx: number, total: number): string | null {
  const today = refToday(records);
  if (!closeISO) return null;
  const span = diffDays(today, closeISO);
  if (span == null) return null;
  if (span <= 0) return addDays(today, (idx + 1) * 4);
  return addDays(today, Math.min(span, Math.max(3, Math.round((span * (idx + 1)) / (total + 1)))));
}
export function ownerKind(o: any): "VP" | "team" { return /exec|sponsor|\bvp\b/i.test(o || "") ? "VP" : "team"; }

// --- closed-won playbook plays ---
export function normComp(s: any): string {
  return String(s || "").toLowerCase().replace(/worldwide|\blabs?\b|\binc\b|\bltd\b|\bsa\b/g, "").replace(/[^a-z]/g, "");
}
export function canonComp(c: any): string {
  const n = normComp(c);
  const m: Record<string, string> = { ivalua: "Ivalua", coupa: "Coupa", gep: "GEP", sapariba: "SAP Ariba", jaggaer: "JAGGAER", oracle: "Oracle", basware: "Basware", proactis: "Proactis", workday: "Workday", medius: "Medius", sirion: "Sirion", docusign: "DocuSign" };
  return m[n] || c;
}
export function dealComps(h: Hard): string[] {
  const raw = [h.competitor, h.primary_competitor].filter(Boolean).join(";");
  return [...new Set(raw.split(/[;,/]+/).map(normComp).filter((x: string) => x && !/^(unknown|wontshare|unknownwontshare|none|na|tbd)$/.test(x)))];
}
export function dealMotion(h: Hard): "gov" | "direct" {
  return /federal|government|\bgov\b|public sector|defen|police|ministry|council|treasury/.test((h.account_industry || "").toLowerCase()) ? "gov" : "direct";
}
export function matchPlays(playbook: any, h: Hard, limit: number): any[] {
  const stage = h.stage;
  if (!stage || !(playbook.plays || []).length) return [];
  const comps = dealComps(h), vert = h.account_industry, motion = dealMotion(h);
  return (playbook.plays || []).map((p: any) => {
    if (!(p.stage || []).includes(stage)) return null;
    const beats = (p.competitor || []).filter((c: string) => comps.includes(normComp(c)));
    let score = 1 + beats.length * 10;
    if ((p.vertical || []).includes(vert)) score += 3; else if ((p.vertical || []).includes("any")) score += 1;
    if ((p.motion || []).includes(motion)) score += 2; else if ((p.motion || []).includes("any")) score += 1;
    return { p, score, beats: [...new Set(beats.map(canonComp))] };
  }).filter(Boolean).sort((a: any, b: any) => b.score - a.score).slice(0, limit);
}

// Forecast tiers (ordered). Initial Interest / Closed / Omitted intentionally excluded.
export const TIERS = [
  { key: "commit", label: "Commit", cap: 5, activatable: false, match: (h: Hard) => h.forecast_category === "Commit" },
  { key: "bestcase", label: "Best Case", cap: 5, activatable: false, match: (h: Hard) => h.forecast_category === "Best Case" },
  {
    key: "upside", label: "Upside — advancing pipeline", cap: 5, activatable: false,
    match: (h: Hard) => !["Commit", "Best Case", "Closed", "Omitted"].includes(h.forecast_category) && ["Shortlisted", "Vendor Selected", "Negotiation", "Validation", "Contract In Progress"].includes(h.stage),
  },
  {
    key: "qualified", label: "Qualified pipeline", cap: 2, activatable: true,
    match: (h: Hard) => ["Pipeline", "Omitted"].includes(h.forecast_category) && ["Qualified", "Formal Evaluation"].includes(h.stage),
  },
];

// --- prose cleanup so it reads like a brief, not a log ---
export function cleanText(s: any): string {
  if (s == null) return "";
  let t = String(s);
  const rep: [RegExp, any][] = [
    [/\b(the\s+)?Competitors__c\s+(field\s+)?is\s+empty/gi, "no competitor is logged"],
    [/\b(the\s+)?Competitor\s+list\s+and\s+Others?_Competitors?[\w]*__c\s+are\s+both\s+(null|empty)/gi, "no competitor is logged"],
    [/\bCompetitors__c\b/gi, "the competitor list"],
    [/\b[A-Za-z][A-Za-z0-9_]*__c\b/g, ""],
    [/\bis null\b/gi, "is not recorded"], [/\bare (both )?null\b/gi, "are not recorded"],
    [/\b(the\s+)?Next_Step(?:__c)?\b/gi, "the deal plan"],
    [/\b[Tt]he\s+Description\b/g, "the account brief"],
    [/\bDescription\b/g, "the account brief"],
    [/\b(Opportunity)?FieldHistory\b/gi, "the deal history"],
    [/\bfield history\b/gi, "deal history"],
    [/\b(Opportunity)?ContactRoles?\b/gi, "the mapped contacts"],
    [/\bAIS[_ ]?Status(__c)?\b/gi, "the AI excitement read"],
    [/\bAIS[_ ]?Score(__c)?\b/gi, "the AI excitement score"],
    [/\bAIS[_ ]?Why(__c)?\b/gi, "the AI rationale"],
    [/\bOpportunityLineItems?\b/gi, "the product lines"],
    [/\bStageName\b/gi, "the stage"], [/\bCloseDate\b/gi, "the close date"],
    [/\bthe swept records?\b/gi, "the deal"],
    [/\b(the|this) records?\b/gi, (m: string, a: string) => a.toLowerCase() + " deal"],
    [/\bthe system (saw|sees|found|notes|recorded)\b/gi, ""],
    [/\s+in Salesforce\b/gi, ""],
    [/\b(per|according to|from|in)\s+(the\s+)?(Avoma\s+(note|notes|sweep|manifest|transcript)|Salesforce)\b/gi, ""],
    [/\s*\((?:[^()]*?(?:__c|in Salesforce|Salesforce field|manifest|swept)[^()]*)\)/g, ""],
  ];
  rep.forEach(([re, to]) => { t = t.replace(re, to as any); });
  return t.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/^[\s,;:.-]+/, "").trim();
}
export function cleanVal(v: any): string {
  if (v == null || v === "") return "—";
  let s = String(v).trim();
  if (/^\(.*\)$/.test(s)) return "—";
  if (/(empty|null)\b.*(salesforce|field)|salesforce.*(empty|null)\b/i.test(s)) return "—";
  s = cleanText(s);
  return s || "—";
}
