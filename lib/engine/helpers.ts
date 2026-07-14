// Pure derivation helpers ported from the original dashboard.html script.
// These operate on raw DealRecord JSON; kept framework-agnostic so every route reuses them.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Rec = any;
export type Hard = any;

// The single canonical MASE knowledge corpus (a Supabase documents.project_id
// namespace). Admin → Agent Control uploads here, and every "Run with AI" agent run
// searches it (AgentRun sends this as project_id, so search_knowledge scopes to it).
// One id, used by both the writer and the reader, so upload → retrieval actually
// connects. (Not a VIBE project — those were the old "Bite Size" leftovers.)
export const MASE_KNOWLEDGE_PROJECT_ID = "7e9b2f48-3c1a-4d6e-8b05-9a2c4f1d7e30";

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

// Salesforce Lightning base for the Zycus org — the ONLY correct host for our records.
//
// DO NOT trust `hard.sf_link`. The sweep stamps that field, and for ~1 in 6 records it is
// HALLUCINATED: it points at the customer's own org (abm./squarespace./bausch.lightning
// .force.com), at placeholders (`your-instance.`, `na1.`, `na.`), or at a malformed path
// (`/lightning/r/<id>/view` with no object, `/r/Opportunity/...` with no `/lightning`).
// Those links silently took people to a DIFFERENT company's Salesforce. The opp_id we
// already hold is authoritative, so the URL is derived from it and is always correct.
// A stored link is used only as a last resort, and only when it is genuinely a Zycus URL.
const SF_LIGHTNING_BASE = "https://zycus.lightning.force.com/lightning/r/Opportunity";
const SF_ID_15_RE = /^[a-zA-Z0-9]{15}$/;
const SF_ID_18_RE = /^[a-zA-Z0-9]{18}$/;
// Hosts that actually belong to the Zycus org. Anything else is somebody else's tenant.
const SF_ZYCUS_HOSTS = new Set(["zycus.lightning.force.com", "zycus.my.salesforce.com"]);

// Salesforce's own 15 -> 18 character id checksum. Each 5-char chunk yields one suffix
// char encoding WHICH of its 5 positions are uppercase (bit i = position i is A-Z),
// indexed into A-Z0-5. Deterministic — no network, no lookup. We store 15-char opp_ids
// but Salesforce links canonically carry the 18-char form, so derive it exactly.
const SF_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
export function sfId18(id: string): string {
  if (SF_ID_18_RE.test(id)) return id;      // already 18
  if (!SF_ID_15_RE.test(id)) return id;     // not an id — leave alone
  let suffix = "";
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const ch = id[chunk * 5 + i];
      if (ch >= "A" && ch <= "Z") bits |= 1 << i;
    }
    suffix += SF_B32[bits];
  }
  return id + suffix;
}

export function sfLinkFor(hard: any, oppId?: unknown): string | null {
  // 1. Build from the opportunity id — deterministic, and right for every record.
  const id = String(oppId ?? hard?.opp_id ?? "").trim();
  if (id.startsWith("006") && (SF_ID_15_RE.test(id) || SF_ID_18_RE.test(id))) {
    return `${SF_LIGHTNING_BASE}/${sfId18(id)}/view`;
  }
  // 2. No usable id (e.g. a non-opportunity row): accept a stored link ONLY if it really
  //    is a Zycus URL. Never surface another tenant's domain or a placeholder.
  const direct = String(hard?.sf_link ?? "").trim();
  if (direct) {
    try { if (SF_ZYCUS_HOSTS.has(new URL(direct).host)) return direct; } catch { /* not a URL */ }
  }
  return null;
}

export function fmtAmount(a: any): string {
  if (a == null || a === "") return "—";
  const n = Number(a);
  return isNaN(n) ? String(a) : "$" + n.toLocaleString();
}
// Account annual revenue as stored in Salesforce (AnnualRevenue, in MILLIONS of the
// account currency — e.g. Greencore = 2066 → ~$2.1B). Compact display for the drawer
// header; returns "" for missing/zero so the caller can omit the chip entirely.
export function fmtRevenueM(v: any): string {
  if (v == null || v === "") return "";
  const m = Number(v);
  if (isNaN(m) || m <= 0) return "";
  if (m >= 1000) return "$" + (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace(/\.0$/, "") + "B";
  return "$" + Math.round(m).toLocaleString() + "M";
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
// Days since a date, or null when the date is missing/invalid. Returns null
// (NOT a sentinel like 9999) so callers must explicitly decide how to present
// "no date" — preventing magic numbers from leaking into the UI.
// Whole days between `d` and NOW. Anchored to the real current date via Date.now() —
// previously anchored to a hardcoded TODAY (2026-06-03) that had gone ~6 weeks stale, which
// made every "N days ago" wrong (e.g. an activity on Jul 13 read as "40d ago" because it was
// |Jun 3 − Jul 13|). Fresh per call so it never drifts within a long session.
export function daysSince(d: any): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 86400000);
}

// A deal is "stalled" (Matcha's domain — kept OUT of Espresso so the two tabs never
// intersect) when it sits in Qualified with no logged activity for 30+ days. Activity
// falls back to qualified then last-modified date so we measure a real untouched age,
// matching Matcha's "Stalled at Qualified" definition exactly.
export function isStalled(h: Hard): boolean {
  if ((h.stage || "") !== "Qualified") return false;
  const since = daysSince(h.last_activity_date) ?? daysSince(h.qualified_date) ?? daysSince(h.last_modified_date);
  return since != null && since > 30;
}

// `fit` = record.ai.ai_fit_signal — the analyst's AI-readiness read, used as a
// fallback when the SF ais_* fields are blank (true for most of the stale cache).
export function aiTier(h: Hard, fit?: any): string | null {
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
  const ft = (fit && fit.tier ? String(fit.tier) : "").toLowerCase();
  if (/hungry/.test(ft)) return "Hungry";
  if (/curious/.test(ft)) return "Curious";
  if (/resistant/.test(ft)) return "Resistant";
  return null;
}
export function aiLabel(h: Hard, fit?: any): string { const t = aiTier(h, fit); return t ? "AI " + t : "Not scored"; }

// CEO-intervention area codes → human labels (mirrors the backend workflow_v1 shape).
export const CEO_AREA_LABELS: Record<string, string> = {
  pricing: "Pricing",
  product: "Product/roadmap",
  presales_resources: "Pre-sales/resources",
  exec_connect: "Exec connect",
};
export function ceoAreaLabel(a: string): string { return CEO_AREA_LABELS[a] || a; }

// One filter label per deal (mirrors aiLabel): "CEO help needed" when the workflow
// flagged it, "No CEO help" when evaluated-but-clear, "" when never evaluated (blank —
// excluded from both filter buckets).
export function ceoFilterLabel(ci?: any): string {
  if (!ci || typeof ci !== "object") return "";
  return ci.needed ? "CEO help needed" : "No CEO help";
}

// Four deal-health tones. ORDER MATTERS: "Close Date Risk" contains "risk", so
// it must be caught BEFORE the legacy "risk" check.
//   v-on   = On Track        -> green
//   v-cdr  = Close Date Risk -> light green (healthy deal, date will slip)
//   v-slow = Slowing         -> amber (losing momentum / stalled)
//   v-off  = Off Track       -> red (cold)
//   v-dead = Lost / Qualified Out / Omitted -> grey (closed, not a live opportunity)
export function verdictTone(v: any): "v-on" | "v-cdr" | "v-slow" | "v-off" | "v-dead" | "" {
  const k = String(v || "").toLowerCase();
  if (!k) return "";
  if (k.includes("lost") || k.includes("omitted") || k.includes("qualified out")) return "v-dead";
  if (k.includes("off")) return "v-off";
  if (k.includes("close")) return "v-cdr";   // "close date risk"
  if (k.includes("slow")) return "v-slow";   // "slowing"
  if (/on[\s-]?track/.test(k)) return "v-on";
  if (k.includes("risk")) return "v-slow";   // legacy "At Risk" -> Slowing (amber)
  return ""; // unknown/odd wording -> neutral, NEVER silently green
}

// The ONE place the deal-health statuses are named. Every surface reads from here
// so the label never drifts. A dead deal reads its terminal status verbatim.
export function healthLabel(v: any): string {
  const t = verdictTone(v);
  if (t === "v-dead") {
    const k = String(v || "").toLowerCase();
    return k.includes("omitted") ? "Omitted" : k.includes("qualified") ? "Qualified out" : "Lost";
  }
  return t === "v-on" ? "On track"
    : t === "v-cdr" ? "Close-date risk"
    : t === "v-slow" ? "Slowing"
    : t === "v-off" ? "Off track" : "—";
}

// --- Deal-score bands (shared by the score columns, their colours, and the filters) ---
// Returns the human band LABEL for a headline score. Momentum centres on 50; Risk is
// "higher = worse"; Win/Commitment/FC use the standard High/Mid/Low.
export function scoreBand(key: string, v: any): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "";
  if (key === "deal_momentum") return n > 55 ? "Forward" : n >= 45 ? "Flat" : "Slipping";
  if (key === "deal_risk") return n >= 60 ? "High" : n >= 40 ? "Medium" : "Low";
  return n >= 60 ? "High" : n >= 40 ? "Mid" : "Low"; // win_position, customer_commitment, forecast_confidence
}
// Colour bucket for a score: g(good)/a(amber)/r(red)/n(neutral). Risk inverts; Momentum centres.
export function scoreColorBand(key: string, v: any): "g" | "a" | "r" | "n" {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return "n";
  if (key === "deal_risk") return n >= 60 ? "r" : n >= 40 ? "a" : "g";
  if (key === "deal_momentum") return n > 55 ? "g" : n >= 45 ? "n" : "r";
  return n >= 60 ? "g" : n >= 40 ? "a" : "r";
}
// Band options offered in the filter bar, per score key.
export const SCORE_BANDS: Record<string, string[]> = {
  win_position: ["High", "Mid", "Low"],
  deal_momentum: ["Forward", "Flat", "Slipping"],
  customer_commitment: ["High", "Mid", "Low"],
  deal_risk: ["High", "Medium", "Low"],
  forecast_confidence: ["High", "Mid", "Low"],
};

// Trim a long string to its first `n` words + "…", for compact display. The full
// text is preserved in the data (this only shortens what's rendered).
export function clipWords(s: any, n: number): string {
  const w = String(s || "").trim().split(/\s+/).filter(Boolean);
  return w.length > n ? w.slice(0, n).join(" ") + "…" : w.join(" ");
}

// Like clipWords, but the result must READ AS A FINISHED THOUGHT — never a
// mid-sentence cut and never a trailing "…". Caps at `n` words; if the source is
// longer, it trims back to the last sentence (. ! ?) or clause (, ; — –) boundary
// inside the cap, and as a last resort drops a dangling connector word. Used for
// the Play card highlights, which must wrap up cleanly within the word budget.
export function clipWordsClean(s: any, n: number): string {
  const text = String(s || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const words = text.split(" ");
  if (words.length <= n) return text.replace(/[\s,;:–—-]+$/, "");
  const clip = words.slice(0, n).join(" ");
  const half = clip.length * 0.5;
  const sentence = Math.max(clip.lastIndexOf(". "), clip.lastIndexOf("! "), clip.lastIndexOf("? "));
  if (sentence >= half) return clip.slice(0, sentence + 1).trim();
  const clause = Math.max(
    clip.lastIndexOf(", "), clip.lastIndexOf("; "),
    clip.lastIndexOf(" — "), clip.lastIndexOf(" – "),
  );
  if (clause >= half) return clip.slice(0, clause).trim();
  return clip
    .replace(/[\s,;:–—-]+$/, "")
    .replace(/\s+(and|or|to|the|a|an|of|for|with|that|which|but|on|in|at|by|as|via)$/i, "")
    .trim();
}

// --- VP / RSD hierarchy ---
// `manager_name` in the raw book is unreliable: Shekhar Varma is the President
// sitting above the territory VPs (161 deals), and some deals carry a blank
// manager or "Brijesh Kumar". We re-attribute every deal to its territory VP,
// keyed by its owner, per the org chart below. Notes:
//   - VP East Open is its own book (Alexa manages it, but it is NOT her West team).
//   - Mohamad Alhakim is an RVP (UAE) under Carl, and Dan Quinn reports to Mohamad;
//     both still roll up to Carl Kimball's book.
//   - Arthur Raguette runs a solo territory and owns his deals himself.
//   - Kevin Cipollaro (off-chart) → Alexa West; Monika Mutscher (off-chart) → John.
//   - DROP_OWNERS sit in BD / customer cross-sell / delivery and are excluded.
export const OWNER_VP: Record<string, string> = {
  // Anthony Gray — VP (EU/UK)
  "Anthony Gray": "Anthony Gray", "Claire Hudson": "Anthony Gray", "Casper Hoeholt": "Anthony Gray",
  // John Woodcock — VP (EMEA / Continental)
  "John Woodcock": "John Woodcock", "Caroline Lacocque": "John Woodcock", "Dirk Fischbach": "John Woodcock",
  "Pierre Meraud": "John Woodcock", "Monika Mutscher": "John Woodcock",
  // Carl Kimball — VP (APAC / MEA); Mohamad Alhakim (RVP, UAE) + Dan Quinn roll up here
  "Carl Kimball": "Carl Kimball", "Mohamad Alhakim": "Carl Kimball", "Dan Quinn": "Carl Kimball",
  "Adam Hasan": "Carl Kimball", "George John": "Carl Kimball", "Guillaume Pasquet": "Carl Kimball",
  "Luke Dougherty": "Carl Kimball", "Tanmay Srivastava": "Carl Kimball",
  // Graeme Yates — new RSD (ANZ), rolls up to Carl Kimball. Verified against live SFDC
  // (User graeme.yates@zycus.com, active): exact name is "Graeme Yates" and he currently
  // owns 0 opportunities, so his book is legitimately empty until deals are assigned.
  "Graeme Yates": "Carl Kimball",
  // Alexa Bradley — VP (West)
  "Alexa Bradley": "Alexa Bradley", "Karson Keogh": "Alexa Bradley", "Mario Castro": "Alexa Bradley",
  "Rick Taranek": "Alexa Bradley", "Kevin Cipollaro": "Alexa Bradley",
  // VP East Open — separate book, managed by Alexa
  "Edward Dlugosz": "VP East Open", "Marc Quessenberry": "VP East Open",
  "Richard Hunsinger": "VP East Open", "Mike Flowers": "VP East Open",
  // Arthur Raguette — VP, US Strategic Accounts (solo)
  "Arthur Raguette": "Arthur Raguette",
  // Michael McCarthy — VP, US Mid-Markets
  "Michael McCarthy": "Michael McCarthy", "Bailey Erazo": "Michael McCarthy", "Grace Kim": "Michael McCarthy",
  "Justin Ajmo": "Michael McCarthy", "Steve Ovadje": "Michael McCarthy",
};

// --- Economic-buyer overrides (read-time, no re-sweep) ---
// The sweep marks the economic buyer as a "gap" on deals where the EB never landed
// in a Salesforce contact role or on a swept call — but for these deals the EB *is*
// recorded in the MEDDPICC custom object (MEDDPICC__c.Who_is_the_economic_buyer__c),
// so the "EB unmapped" red alert is a visibility false-positive. We hold the confirmed
// EB names here, keyed by 15-char opp_id, to (a) DISPLAY the buyer and (b) clear the
// EB-missing SPOF/blocker. The deal's engagement verdict (north_star_verdict) is left
// untouched — if the deal is at risk it stays at risk, on engagement grounds, not EB
// visibility. Source: SF MEDDPICC scan of the 440 book, 2026-06-27 (17 confirmed).
const EB_OVERRIDES: Record<string, string> = {
  "006P700000VSLhB": "Gavin Greer",
  "006P700000RFGL6": "Arnd Christochowitz",
  "006P700000J71MD": "Barbara Potisk-Eibensteiner (CFO)",
  "006P700000PlMpu": "Simon Vogelmann",
  "006P700000Xl06R": "Florence Tinsley Roi",
  "006P7000009O2Ri": "CPO + Jacques De Villiers",
  "006P700000KlsBE": "Philippe Pourquéry (Group CFO)",
  "006P7000001j0JR": "Benoit Thibaudon + M. Grootenbeer (CPO)",
  "006P700000PtQGP": "Mazin (Head of Procurement)",
  "006P700000LtIUv": "Bilal; Abraham Mathew",
  "006P700000MB1SN": "Jason Tranter (VP)",
  "006P700000FF6Np": "Ahmed Rafat (CPO)",
  "006P700000Z98IL": "Sameh Bartok (SVP Contracts & Procurement)",
  "006P700000Y1Ont": "Tarek Ibrahim Youssef (Proc Dir)",
  "006P700000T0trq": "Kerelos (Head of Procurement)",
  "006P700000CWvfN": "Dan Lahey (EVP & CFO)",
  "006P7000009T3v1": "George Andrus (ED, Head of Procurement)",
};
// The confirmed economic buyer for an opp, or null. Matches on the 15-char id so it
// works whether the record carries a 15- or 18-char opp_id.
export function getEbOverride(oppId: unknown): string | null {
  return EB_OVERRIDES[String(oppId || "").slice(0, 15)] || null;
}

// --- Manager-name correction for "Executive connect" to-dos ---
// The backend sweep does not reliably resolve the deal owner's manager: it either
// leaves the literal template token `manager_name` (e.g. Pacific Seafood) or
// fabricates a name that is not a Salesforce user at all (e.g. Southern Nuclear's
// "Mark Emery", A2Dominion's "Andrew Graham"). We hold the real owner→manager
// mapping deterministically (OWNER_VP), so we scrub the display here: replace the
// placeholder token and any "<Name> (manager)" / "Executive connect: <Name>" slot
// with the true manager. The proper source-fix is in the backend prompt (resolve
// Owner.Manager.Name from Salesforce, never invent one) — this keeps the UI and
// any deck screenshots correct until a re-sweep lands.
const NAME_RE = String.raw`[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z'’.\-]+){1,2}`;
export function fixManagerName(text: string, ownerName: unknown, managerName?: unknown): string {
  if (!text || !/manager|executive connect/i.test(text)) return text;
  // Prefer the Salesforce org-chart name passed from the backend (authoritative —
  // never a model guess); fall back to the static owner->VP map only if absent.
  const mgr = String(managerName || "").trim() || OWNER_VP[String(ownerName || "")];
  // No mapping, or the owner IS the VP (nobody above them on-team to escalate to):
  // leave the text alone rather than self-referencing the owner as their own manager.
  if (!mgr || mgr === String(ownerName || "")) {
    // Still strip a dangling literal token so the UI never shows "manager_name".
    return text.replace(/\(?\bmanager[_ ]name\b\)?/gi, "the deal owner's manager");
  }
  let t = text;
  t = t.replace(/\bthe deal[ -]?owner['’]?s manager\b/gi, mgr);              // generic phrase -> real name
  t = t.replace(/manager[_ ]name/gi, mgr);                                   // literal token
  t = t.replace(new RegExp(`${NAME_RE}\\s*\\((?:the )?manager\\)`, "g"), `${mgr} (manager)`); // "<Name> (manager)"
  t = t.replace(new RegExp(`(Executive connect:?\\s*\\(?)${NAME_RE}`, "g"), `$1${mgr}`);       // after "Executive connect:"
  return t;
}

// BD / customer cross-sell / delivery owners — their opportunities are dropped from every tab.
export const DROP_OWNERS = new Set<string>([
  "Elias Kardous", "Anshu Jagiasi", "Nimesh Pandya", "Hrishikesh Pachhapur",
]);

// Territory VP for a record, or null when the deal should be dropped entirely.
export function vpOf(r: Rec): string | null {
  const o = (r.hard || {}).owner_name;
  if (!o || DROP_OWNERS.has(o)) return null;
  return OWNER_VP[o] || null;
}
// Stages whose opps are dead/closed — won, lost, disqualified, or dropped. They are
// hidden from every deal list in the UI (the engine still tracks them; we just don't
// surface them). Matched as a case-insensitive substring so numbered SF stage names
// (e.g. "8. Closed Lost") are caught too.
// Stages whose opps are terminal — won, lost, disqualified, or dropped. Substring
// match so numbered SF stage names ("8. Closed Lost") and a bare "Lost" are caught;
// "lost" subsumes "closed lost".
const DEAD_STAGES = ["qualified out", "closed won", "omitted", "lost"];
export function isDeadStage(stage: any): boolean {
  const k = String(stage || "").trim().toLowerCase();
  return DEAD_STAGES.some((d) => k.includes(d));
}
// Stages HIDDEN from the MASE UI entirely — pre-qualified deals we don't surface anywhere
// (an "Initial Interest" pipeline is noise for the deal-intelligence views). Distinct from
// DEAD_STAGES: these are EARLY, not terminal. Substring match catches the numbered SF form
// ("1. Initial Interest") too.
const HIDDEN_STAGES = ["initial interest"];
export function isHiddenStage(stage: any): boolean {
  const k = String(stage || "").trim().toLowerCase();
  return HIDDEN_STAGES.some((d) => k.includes(d));
}
// Canonical "dead deal" test — terminal by STAGE or by forecast category (Omitted).
// THE single source of truth: keepRecord hides these from every list and DealsStats
// excludes them from every rollup, so the two can never drift. Mirrors the backend's
// deal_engine_scoring.is_dead_deal.
export function isDeadDeal(r: any): boolean {
  const h = (r && r.hard) || {};
  // Terminal by STAGE, or by FORECAST CATEGORY (Omitted, or Closed Lost / Lost / Qualified
  // Out — the rep often flips the forecast to Closed Lost while the stage lags behind).
  const fc = String(h.forecast_category || "").trim().toLowerCase();
  const deadFc = fc === "omitted" || fc.includes("closed lost") || fc.includes("closed-lost")
    || fc === "lost" || fc.includes("qualified out");
  // Or by SCORING SIGNAL: the engine flips headline.dead when it detects a LOSS (a "we lost
  // it" email/call/Next-Step) even while Salesforce still shows the deal as live. A lost deal
  // is never tracked or scored — so honor that flag here too.
  const headDead = (((r && r.ai && r.ai.deal_scores) || {}).headline || {}).dead === true;
  return isDeadStage(h.stage) || deadFc || headDead;
}
// An UNPOPULATED STUB — in the book but its Salesforce hard facts haven't landed yet
// (no stage). Every real SF opportunity has a StageName, so an empty stage ALWAYS means
// the deal was made visible (membership/discovery) before its facts were populated. These
// render as $0/blank rows and, when a whole rep's book is freshly tracked, make MASE look
// empty ("not connected"). Hide them until a hard-refresh fills them in — they reappear
// automatically once stage/amount land. (Root cause of the recurring "$0 pipeline".)
export function isUnpopulatedStub(r: any): boolean {
  return String(((r && r.hard) || {}).stage || "").trim() === "";
}
export function keepRecord(r: Rec): boolean {
  return vpOf(r) != null && !isUnpopulatedStub(r) && !isDeadDeal(r) && !isHiddenStage((r.hard || {}).stage);
}

export function teamsMap(records: Rec[]): Record<string, string[]> {
  const m: Record<string, Set<string>> = {};
  records.forEach((r) => {
    const vp = vpOf(r);
    const o = (r.hard || {}).owner_name;
    if (!vp || !o) return;
    (m[vp] = m[vp] || new Set()).add(o);
  });
  const out: Record<string, string[]> = {};
  Object.keys(m).forEach((k) => (out[k] = [...m[k]].sort()));
  return out;
}
export function vpsList(records: Rec[]): string[] { return Object.keys(teamsMap(records)).sort(); }
// `vps` empty = every VP. Owners are the union across the selected VPs.
export function teamOwners(records: Rec[], vps: string[]): string[] {
  const t = teamsMap(records);
  if (!vps.length) return [...new Set(Object.values(t).flat())].sort();
  return [...new Set(vps.flatMap((v) => t[v] || []))].sort();
}
// Static VP→owners from the OWNER_VP map (NO book needed) — used to resolve the
// owner scope for the server-side paginated Deals query. Empty vps = the whole team
// (every mapped owner), which also excludes BD/cross-sell/delivery owners not in the
// map (matching keepRecord), so the server returns only real team deals.
export function ownersForVpsStatic(vps: string[]): string[] {
  const all = Object.keys(OWNER_VP);
  if (!vps.length) return all;
  const set = new Set(vps);
  return all.filter((o) => set.has(OWNER_VP[o]));
}

// Multi-select scope: an empty array means "no constraint" (all).
export function inScope(r: Rec, vps: string[], rsds: string[]): boolean {
  const vp = vpOf(r);
  if (!vp) return false;
  const o = (r.hard || {}).owner_name;
  if (vps.length && !vps.includes(vp)) return false;
  if (rsds.length && !rsds.includes(o)) return false;
  return true;
}

// --- map the logged-in SSO user to a default scope ---
// EXPLICIT ALLOW-LIST (email -> Salesforce owner/VP display name). This is the
// single source of truth for who may use MASE: only emails listed here (or in
// ADMIN_EMAILS) get in; everyone else is blocked (see resolveAccess). Emails are
// the real SFDC User.Email values — note most follow firstname.lastname@zycus.com
// but a few do not (e.g. Mario Castro = marioj.castro). This list gates MASE ONLY
// and has no effect on VIBE, which is a separate app sharing the same Supabase.
export const EMAIL_TO_OWNER: Record<string, string> = {
  // Anthony Gray — VP (EU/UK)
  "anthony.gray@zycus.com": "Anthony Gray",
  "claire.hudson@zycus.com": "Claire Hudson",
  "casper.hoeholt@zycus.com": "Casper Hoeholt",
  // John Woodcock — VP (EMEA/Continental)
  "john.woodcock@zycus.com": "John Woodcock",
  "caroline.lacocque@zycus.com": "Caroline Lacocque",
  "dirk.fischbach@zycus.com": "Dirk Fischbach",
  "pierre.meraud@zycus.com": "Pierre Meraud",
  // Carl Kimball — VP (APAC/MEA)
  "carl.kimball@zycus.com": "Carl Kimball",
  // New RSD (ANZ). Exact SFDC display name verified as "Graeme Yates".
  "graeme.yates@zycus.com": "Graeme Yates",
  "mohamad.alhakim@zycus.com": "Mohamad Alhakim",
  "dan.quinn@zycus.com": "Dan Quinn",
  "adam.hasan@zycus.com": "Adam Hasan",
  "george.john@zycus.com": "George John",
  "guillaume.pasquet@zycus.com": "Guillaume Pasquet",
  "luke.dougherty@zycus.com": "Luke Dougherty",
  "tanmay.srivastava@zycus.com": "Tanmay Srivastava",
  // Alexa Bradley — VP (West)
  "alexa.bradley@zycus.com": "Alexa Bradley",
  "karson.keogh@zycus.com": "Karson Keogh",
  "marioj.castro@zycus.com": "Mario Castro", // note: marioj, NOT mario.castro
  "rick.taranek@zycus.com": "Rick Taranek",
  // VP East (open/vacant) — owners only
  "edward.dlugosz@zycus.com": "Edward Dlugosz",
  "marc.quessenberry@zycus.com": "Marc Quessenberry",
  "richard.hunsinger@zycus.com": "Richard Hunsinger",
  "mike.flowers@zycus.com": "Mike Flowers",
  // Arthur Raguette — VP, US Strategic Accounts (solo)
  "arthur.raguette@zycus.com": "Arthur Raguette",
  // Michael McCarthy — VP, US Mid-Markets
  "michael.mccarthy@zycus.com": "Michael McCarthy",
  "bailey.erazo@zycus.com": "Bailey Erazo",
  "grace.kim@zycus.com": "Grace Kim",
  "justin.ajmo@zycus.com": "Justin Ajmo",
  "steve.ovadje@zycus.com": "Steve Ovadje",
};

// Turn an email into a candidate owner display-name. "alexa.bradley@zycus.com"
// -> "Alexa Bradley". Falls back to the override table for exceptions.
export function ownerFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.toLowerCase();
  if (EMAIL_TO_OWNER[e]) return EMAIL_TO_OWNER[e];
  const local = e.split("@")[0];
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return name || null;
}

// Default VP/RSD scope for a logged-in owner. A VP gets their whole team; an RSD
// gets just their own deals; anyone not in the org map (leadership, admins,
// unknown) gets null = no scope (sees everything).
export function scopeForOwner(name: string | null): { vps: string[]; rsds: string[] } | null {
  if (!name) return null;
  const vp = OWNER_VP[name];
  if (!vp) return null;
  if (vp === name) return { vps: [name], rsds: [] }; // VP -> whole team
  return { vps: [], rsds: [name] }; // RSD -> own deals only
}

// Leadership / admins who may see the whole book (filters stay unlocked).
export const ADMIN_EMAILS = new Set<string>([
  "gurv.sharma@zycus.com",
  "aleen.dhar@zycus.com",
  "sam.thomas@zycus.com",
  "amit.shah@zycus.com",
  "aatish@zycus.com",
  "shekhar.varma@zycus.com",
  "singh.aditya@zycus.com",
  "ankit.malhotra@zycus.com",
  "sutithi.das@zycus.com",
  "rishabh.tickoo@zycus.com",
]);

// SUPER-ADMINS — the platform owners. Gates the Omnivision / Scoring Version Studio
// (versioned engine instructions with lock-before-run). A strict SUBSET of ADMIN_EMAILS:
// being an admin does NOT grant Omnivision; only these two do.
export const SUPER_ADMIN_EMAILS = new Set<string>([
  "aleen.dhar@zycus.com",
  "sam.thomas@zycus.com",
]);

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return SUPER_ADMIN_EMAILS.has((email || "").toLowerCase());
}

// Region admins: see ALL deals in a region (every VP team in it), LOCKED — but NOT the
// whole book and NOT the admin agent-control surfaces. They resolve to a multi-VP
// `scoped` role (not `admin`), so region-wide visibility falls out of the normal scope
// filter. US = the four US VP books (West, East, US Strategic, US Mid-Markets). Europe =
// the two EMEA VP books (Anthony Gray — EU/UK, John Woodcock — Continental); Carl Kimball
// (APAC/MEA) is NOT Europe and is excluded.
export const US_VPS = ["Alexa Bradley", "VP East Open", "Arthur Raguette", "Michael McCarthy"];
export const EUROPE_VPS = ["John Woodcock", "Anthony Gray"];
// APAC/MEA = Carl Kimball's book (his whole team rolls up to him in OWNER_VP).
export const APAC_VPS = ["Carl Kimball"];
// East Admin = Alexa Bradley's three books: her own West team, the VP East Open book she
// manages (see OWNER_VP), and Michael McCarthy (US Mid-Markets). A SUBSET of US_VPS — it
// excludes Arthur Raguette (US Strategic), so she sees these three books, not all of US.
export const EAST_VPS = ["Alexa Bradley", "VP East Open", "Michael McCarthy"];
export const REGION_ADMINS: Record<string, { name: string; vps: string[] }> = {
  "kasturi.talukdar@zycus.com": { name: "US Admin", vps: US_VPS },
  "rashi.varma@zycus.com": { name: "Europe Admin", vps: EUROPE_VPS },
  "chiranjivi.padole@zycus.com": { name: "APAC Admin", vps: APAC_VPS },
  // Alexa Bradley is herself a VP; this region-admin entry overrides her single-team scope
  // so she ALSO sees the VP East Open book she manages + Michael McCarthy's Mid-Markets.
  "alexa.bradley@zycus.com": { name: "East Admin", vps: EAST_VPS },
};

// Resolve the logged-in email into an access decision:
//   admin   -> sees everything, filters unlocked
//   scoped  -> locked to their VP team / own deals
//   blocked -> not a known rep/VP/admin: sees nothing
export type Access =
  | { kind: "admin" }
  | { kind: "scoped"; vps: string[]; rsds: string[]; name: string }
  | { kind: "blocked" };

export function resolveAccess(email: string | null | undefined): Access {
  const e = (email || "").toLowerCase();
  if (ADMIN_EMAILS.has(e)) return { kind: "admin" };
  // Region admin (e.g. US Admin) — sees every VP team in their region, locked. A
  // multi-VP `scoped` role: region-wide visibility, no whole-book / no admin panel.
  const region = REGION_ADMINS[e];
  if (region) return { kind: "scoped", vps: region.vps, rsds: [], name: region.name };
  // Strict allow-list (fail-CLOSED): only emails explicitly in EMAIL_TO_OWNER
  // get in. We deliberately do NOT guess a name from the email local-part — an
  // unlisted @zycus.com account (including VIBE's team, who share this Supabase
  // project) must see nothing. Unknown => blocked.
  const name = EMAIL_TO_OWNER[e];
  if (!name) return { kind: "blocked" };
  const scope = scopeForOwner(name);
  if (!scope) return { kind: "blocked" };
  return { kind: "scoped", vps: scope.vps, rsds: scope.rsds, name };
}

export function uniqSorted(arr: any[]): any[] { return [...new Set(arr.filter((v) => v != null && v !== ""))].sort(); }

// --- Country canonicalisation (the Country facet) ---
// Salesforce Account.BillingCountry is FREE TEXT: the same country arrives as both "US"
// and "United States" (likewise UK / UAE). Left raw, the facet shows TWO options for one
// country and each hides the other's deals. Canonicalise here and run BOTH the option
// list (ScopeFilterBar) and the match test (DashboardContext) through it, so they can
// never disagree. Unknown values pass through untouched (e.g. the region values "Europe"
// / "APAC" that a few accounts carry) — we never invent or drop a country.
const COUNTRY_ALIASES: Record<string, string> = {
  "us": "United States", "usa": "United States", "u.s.": "United States", "u.s.a.": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "gb": "United Kingdom",
  "great britain": "United Kingdom", "england": "United Kingdom",
  "uae": "United Arab Emirates", "u.a.e.": "United Arab Emirates",
  "ksa": "Saudi Arabia",
  "prc": "China",
  "holland": "Netherlands", "the netherlands": "Netherlands",
};
export function normCountry(v: unknown): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  return COUNTRY_ALIASES[raw.toLowerCase().replace(/\s+/g, " ")] || raw;
}

// --- dates ---
export function refToday(records: Rec[]): string {
  // "Today" for back-planning to-do due dates. Use the latest sweep that is NOT
  // future-dated — a few records carry outlier/future swept_at (e.g. 2026-12-03)
  // which would otherwise project every back-planned due date months into the
  // future (the cause of to-dos showing "due Dec 26" on deals closing in May).
  let now = "2026-06-05";
  try { now = new Date().toISOString().slice(0, 10); } catch { /* keep fallback */ }
  const past = records.map((r) => r && r.swept_at).filter((s) => s && s <= now).sort();
  return past.length ? (past[past.length - 1] as string) : now;
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
// Enterprise Zycus deals run 12–15 months, but this dashboard is reviewed and
// re-planned EVERY day — so we never schedule a to-do more than ~2 months out.
// Due dates are spread across whichever is sooner: the close runway or the
// 60-day horizon. Tomorrow's refresh re-plans the next near-term moves.
export const TODO_HORIZON_DAYS = 60;
export function backPlannedDue(records: Rec[], closeISO: any, idx: number, total: number): string | null {
  const today = refToday(records);
  if (!closeISO) return null;
  const span = diffDays(today, closeISO);
  if (span == null) return null;
  if (span <= 0) return addDays(today, Math.min(TODO_HORIZON_DAYS, (idx + 1) * 4));
  const effSpan = Math.min(span, TODO_HORIZON_DAYS);
  return addDays(today, Math.max(3, Math.round((effSpan * (idx + 1)) / (total + 1))));
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

// Salesforce Opportunity StageName picklist, in picklist order (from describe).
// Used to order the "Deals by stage" chart exactly like Salesforce. Stage values
// not in this list (legacy default-SF stages on a few records) sort to the end.
export const STAGE_ORDER: string[] = [
  "Initial Interest", "Qualified", "Formal Evaluation", "Shortlisted", "Vendor Selected",
  "No Decision", "Qualified Out", "Contract In Progress", "Contract Signed", "PO Received",
  "Closed Lost", "Closed Won", "Omitted",
  "1. Initial Interest", "2. Solution Fitment", "3. Evaluation / POC", "4. Stakeholder Alignment",
  "5. Budget Approval", "6. Contract Negotiation", "7. Closed Won", "8. Closed Lost",
  "Budget Approval", "Stakeholder Alignment", "Contract Negotiation", "Solution Fitment", "Evaluation / POC",
];
export function stageRank(s: any): number { const i = STAGE_ORDER.indexOf(String(s)); return i === -1 ? 9999 : i; }

// The backend cache carried a few stale/legacy stages that don't exist in the SF
// picklist. Corrected to the live Salesforce StageName (verified via SF query,
// Jun 2026). Keyed by 15-char opp_id; applied at load so every tab uses SF truth.
export const STAGE_FIX: Record<string, string> = {
  "006P700000RFGL6": "Shortlisted",      // HAVI Logistics — was Negotiation/Review
  "006P7000009T3v1": "Shortlisted",      // Mizuho Americas — was Proposal/Price Quote
  "006P700000HBXgR": "Vendor Selected",  // Nordea — was Proposal/Pricing Quote
  "006P700000PlMpu": "Shortlisted",      // Bosch — was Qualification
  "006P700000KmkeX": "Shortlisted",      // Watchtower — was Prospecting
};
export function applyStageFix(r: Rec): Rec {
  const id = String(r?.opp_id || "");
  const fix = STAGE_FIX[id] || STAGE_FIX[id.slice(0, 15)];
  if (!fix || !r?.hard || r.hard.stage === fix) return r;
  return { ...r, hard: { ...r.hard, stage: fix } };
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
export type Tier = (typeof TIERS)[number];

// The single forecast tier a deal belongs to (or null = Initial Interest / Closed → no to-dos).
export function dealTier(h: Hard): Tier | null {
  return TIERS.find((t) => t.match(h)) || null;
}

// --- To-dos: ONE source of truth for both the Espresso tab and the deal drawer ---
// Both call buildDealTodos with the same (record, allRecords, playbook), so the
// to-dos shown on a deal are guaranteed identical to the deal's Espresso to-dos —
// same items, same ids (so completion state syncs), same back-planned due dates.
export interface TodoItem { id: string; text: string; owner?: string; due: { txt: string; cls: string } | null; meta?: string; }
export interface TodoGroup { key: string; label: string; tone: string; items: TodoItem[]; }
export interface DealTodos { tier: Tier; deep: boolean; groups: TodoGroup[]; plays: any[]; dc: number | null; }

export function buildDealTodos(record: Rec, allRecords: Rec[], playbook: any): DealTodos | null {
  const h = record.hard || {}, ai = record.ai || {};
  const tier = dealTier(h);
  if (!tier) return null;
  const dn = h.account_name || h.opp_name || h.opp_id, oid = h.opp_id;
  // deep = forecast deal (full plan + champion building); light = qualified (discovery/engagement).
  const deep = !tier.activatable;

  // 1. Next moves — the AI's ranked recommended actions (dated, owned).
  const moveItems = ((ai.recommended_moves || {}).items || []).slice()
    .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99)).slice(0, tier.cap);
  const total = moveItems.length;
  const moves = moveItems.map((m: any, idx: number) => {
    const t = (m.action || "").trim();
    if (!t) return null;
    const id = oid + ":" + slug(dn + "|" + t);
    const heavy = heavyStep(m.action);
    const due = heavy ? { txt: "confirm timeline", cls: "heavy" }
      : (h.close_date ? { txt: `due ${fmtDue(backPlannedDue(allRecords, h.close_date, idx, total))}`, cls: "" } : null);
    return { id, text: t, owner: m.owner, due };
  }).filter(Boolean) as TodoItem[];

  // 2. Open explicit requirements the prospect stated and we have NOT addressed yet.
  const explicit = (((ai.explicit_requirements || {}).items) || [])
    .filter((x: any) => x && x.addressed !== true)
    .slice(0, deep ? 4 : 3)
    .map((x: any, i: number) => {
      const t = String(x.requirement || x.quote || "").trim();
      return t ? { id: `${oid}:exp:${i}:${slug(t)}`, text: t, meta: x.said_by ? `asked by ${x.said_by}` : undefined, due: null } : null;
    }).filter(Boolean) as TodoItem[];

  // 3. Implicit / promised needs we should proactively cover.
  const implicit = (((ai.implicit_requirements || {}).items) || [])
    .slice(0, deep ? 3 : 2)
    .map((x: any, i: number) => {
      const t = String(x.inferred_need || "").trim();
      return t ? { id: `${oid}:imp:${i}:${slug(t)}`, text: t, due: null } : null;
    }).filter(Boolean) as TodoItem[];

  // 4. Best-practice / hygiene gaps to close on this deal.
  const bp = (((ai.best_practice_check || {}).flags) || [])
    .slice(0, deep ? 4 : 3)
    .map((s: any, i: number) => {
      const t = String(s || "").trim();
      return t ? { id: `${oid}:bp:${i}:${slug(t)}`, text: t, due: null } : null;
    }).filter(Boolean) as TodoItem[];

  const groups: TodoGroup[] = [];
  if (moves.length) groups.push({ key: "moves", label: "Next moves", tone: "moves", items: moves });
  if (explicit.length) groups.push({ key: "explicit", label: "Open requirements", tone: "impt", items: explicit });
  if (implicit.length) groups.push({ key: "implicit", label: "Implicit / promised", tone: "impl", items: implicit });
  if (bp.length) groups.push({ key: "bestpractice", label: "Best practice", tone: "bpr", items: bp });
  if (!groups.length) return null;

  const dc = diffDays(refToday(allRecords), h.close_date);
  const plays = matchPlays(playbook, h, tier.key === "qualified" ? 1 : 2);
  return { tier, deep, groups, plays, dc };
}

// --- MEDDPICC read derived from evidence, not just the SF Yes/No flags ---
export interface MeddItem { dim: string; state: "have" | "weak" | "gap"; note: string; }
export function dealMeddpicc(record: Rec): MeddItem[] {
  const h = record.hard || {}, ai = record.ai || {};
  const stake = (ai.stakeholder_map || {}).items || [];
  const roles: string[] = stake.map((s: any) => (s.role || "").toLowerCase());
  const titles: string[] = stake.map((s: any) => (s.title || "").toLowerCase());
  const openVulns = ((ai.vulnerabilities || {}).items || []).filter((v: any) => v.status !== "closed");
  const vulnCats = new Set<string>(openVulns.map((v: any) => v.category));
  const champ = ai.champion_strength || {};
  const reqs = (ai.explicit_requirements || {}).items || [];
  const compSummary = (ai.competitive_position || {}).summary || "";
  const out: MeddItem[] = [];

  // Metrics — a quantified value case, not the metrics_identified flag
  out.push(vulnCats.has("budget")
    ? { dim: "Metrics", state: "weak", note: "Value discussed, business case not built" }
    : h.metrics_identified === true
      ? { dim: "Metrics", state: "have", note: "Quantified value captured" }
      : { dim: "Metrics", state: "gap", note: "No quantified value case" });
  // Economic Buyer — is anyone with budget power actually in the map?
  out.push(roles.some((r) => /economic|sponsor/.test(r)) || titles.some((t) => /\bcfo\b|\bcpo\b|chief|\bvp\b|director of finance/.test(t))
    ? { dim: "Economic Buyer", state: "have", note: "Budget owner mapped" }
    : { dim: "Economic Buyer", state: "gap", note: "No EB in the stakeholder map" });
  // Decision Criteria
  out.push(reqs.length
    ? { dim: "Decision Criteria", state: "have", note: `${reqs.length} explicit requirements captured` }
    : { dim: "Decision Criteria", state: "gap", note: "Criteria not documented" });
  // Decision Process
  out.push(vulnCats.has("timeline")
    ? { dim: "Decision Process", state: "weak", note: "Timeline slipping / process unclear" }
    : { dim: "Decision Process", state: "gap", note: "Process & timeline not locked" });
  // Pain — trust call evidence over the pain_identified flag
  const painEvidence = ((ai.gaps || {}).items || []).length || openVulns.length || ((ai.customer_expectations_fit || {}).items || []).length;
  out.push(painEvidence
    ? { dim: "Pain", state: "have", note: "Captured on calls" + (h.pain_identified === false ? " (SF flag says No — trust the calls)" : "") }
    : { dim: "Pain", state: "gap", note: "Pain not established" });
  // Champion
  const cs = (champ.strength || "").toLowerCase();
  out.push(/strong|validated|established/.test(cs)
    ? { dim: "Champion", state: "have", note: champ.champion || "Champion validated" }
    : champ.champion
      ? { dim: "Champion", state: "weak", note: `${champ.champion} — ${champ.strength || "developing"}` }
      : { dim: "Champion", state: "gap", note: "No champion yet" });
  // Competition
  out.push(dealComps(h).length || /scanmarket|coupa|ariba|sap|gep|ivalua|jaggaer|pactum|docusign|oracle|basware|sirion|medius|workday/i.test(compSummary)
    ? { dim: "Competition", state: "have", note: "Competitive field known" }
    : { dim: "Competition", state: "gap", note: "Competition unknown" });
  return out;
}

// --- Chat scope: Generic / VP / RSD / Deal -------------------------------------
// Generic and single-RSD scope use the backend's native `owner` param (hermetic).
// VP, multi-RSD and Deal scope inject an authoritative SCOPE LOCK block of just the
// in-scope records (instruction-bound today; flips to hermetic when the backend
// gains an opp_ids/owners allowlist).
export type ChatScopeMode = "generic" | "vp" | "rsd" | "deal";
export interface ChatScope { mode: ChatScopeMode; vps: string[]; owners: string[]; oppId: string; }
export const EMPTY_SCOPE: ChatScope = { mode: "generic", vps: [], owners: [], oppId: "" };

export function scopeRecords(records: Rec[], scope: ChatScope): Rec[] {
  if (scope.mode === "vp") return scope.vps.length ? records.filter((r) => { const vp = vpOf(r); return !!vp && scope.vps.includes(vp); }) : records;
  if (scope.mode === "rsd") return scope.owners.length ? records.filter((r) => scope.owners.includes((r.hard || {}).owner_name)) : records;
  if (scope.mode === "deal") return records.filter((r) => r.opp_id === scope.oppId);
  return records;
}
export function scopeLabel(scope: ChatScope, recs: Rec[]): string {
  if (scope.mode === "vp") return scope.vps.length ? scope.vps.join(" & ") : "All VPs";
  if (scope.mode === "rsd") return scope.owners.length ? scope.owners.join(", ") : "All RSDs";
  if (scope.mode === "deal") { const h = recs[0]?.hard || {}; return recs[0] ? `${h.account_name} — ${h.opp_name}` : "a deal"; }
  return "Whole book";
}
// Native single-owner backend scope (hermetic). Undefined → not a single-owner scope.
export function scopeNativeOwner(scope: ChatScope): string | undefined {
  return scope.mode === "rsd" && scope.owners.length === 1 ? scope.owners[0] : undefined;
}
// Must we inject records? Generic and single-RSD are native; VP/Deal/multi-RSD inject.
export function scopeNeedsInjection(scope: ChatScope): boolean {
  if (scope.mode === "vp") return scope.vps.length > 0;
  if (scope.mode === "rsd") return scope.owners.length > 1;
  if (scope.mode === "deal") return !!scope.oppId;
  return false;
}

export function buildChatContext(records: Rec[], scope: ChatScope): string {
  const recs = scopeRecords(records, scope);
  const label = scopeLabel(scope, recs);
  if (scope.mode === "deal" && recs.length === 1) {
    const r = recs[0], h = r.hard || {}, ai = r.ai || {};
    const v = ai.north_star_verdict || {};
    const moves = ((ai.recommended_moves || {}).items || []).slice()
      .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99)).slice(0, 3)
      .map((m: any, i: number) => `  ${i + 1}. ${(m.action || "").trim()}`).join("\n");
    const medd = dealMeddpicc(r).filter((m) => m.state !== "have").map((m) => `${m.dim} (${m.note})`).join("; ");
    const stake = ((ai.stakeholder_map || {}).items || []).map((s: any) => `${s.name} — ${s.role || "?"}`).join("; ");
    return [
      `[SCOPE LOCK] This conversation is about ONE opportunity only: ${h.account_name} — ${h.opp_name}.`,
      `Do not reference any other deal. If asked about anything outside this opportunity, say it is outside scope.`,
      ``,
      `Stage/forecast: ${h.stage} / ${h.forecast_category} | Amount: ${fmtAmount(h.amount)} | Close: ${h.close_date} | Owner: ${h.owner_name}`,
      v.verdict ? `Verdict: ${v.verdict} — ${v.math || ""}` : ``,
      moves ? `Recommended moves:\n${moves}` : ``,
      medd ? `MEDDPICC gaps: ${medd}` : ``,
      stake ? `Stakeholders: ${stake}` : ``,
    ].filter(Boolean).join("\n");
  }
  const lines = recs.map((r) => {
    const h = r.hard || {}, ai = r.ai || {};
    const v = (ai.north_star_verdict || {}).verdict || "";
    const top = (((ai.recommended_moves || {}).items || []).slice().sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99))[0] || {}).action || "";
    return `- ${h.account_name} | ${h.opp_name} | ${h.stage}/${h.forecast_category} | ${fmtAmount(h.amount)} | close ${h.close_date || "?"} | ${h.owner_name}${v ? ` | verdict ${v}` : ""}${top ? ` | next: ${String(top).slice(0, 120)}` : ""}`;
  });
  return [
    `[SCOPE LOCK] You are answering for: ${label}. Your ENTIRE dataset for this conversation is these ${recs.length} opportunities.`,
    `Do NOT reference, count, rank, or recommend any opportunity outside this list, even if you know of others. If asked about something outside this scope, say it is outside the current scope and offer to widen it.`,
    ``,
    ...lines,
  ].join("\n");
}

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
