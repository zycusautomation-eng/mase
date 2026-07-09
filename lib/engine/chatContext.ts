// Derivations for the chat workspace's right-hand "Deal context" panel.
// Binds to a REAL DashboardContext record where the data exists (header,
// property rows, stakeholders, MEDDIC) and falls back to clearly-structured
// placeholders so the panel always renders a full layout.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fmtAmount, fmtDue, dealMeddpicc, sfLinkFor, type Rec } from "./helpers";

export interface StakeholderView {
  name: string;
  role: string;
  tone: "champion" | "buyer" | "decision" | "other";
}
export interface DealContextView {
  isPlaceholder: boolean;
  avatarLetter: string;
  accountName: string;
  industry: string;
  oppName: string;
  sfLink?: string;
  stage: string;
  amount: string;
  closeDate: string;
  owner: string;
  forecast: string;
  meddicScore: number; // /10
  bantScore: number; // /10
  winProbability: number; // %
  riskLevel: "Low" | "Medium" | "High";
  stakeholders: StakeholderView[];
  recommendations: string[];
  recommendationCount: number;
}

const PLACEHOLDER: DealContextView = {
  isPlaceholder: true,
  avatarLetter: "A",
  accountName: "Acme Corp",
  industry: "Enterprise",
  oppName: "Acme Corp — Platform Expansion",
  stage: "Negotiation",
  amount: "$250,000",
  closeDate: "Mar 31, 2026",
  owner: "Alex Morgan",
  forecast: "Commit",
  meddicScore: 8.4,
  bantScore: 7.5,
  winProbability: 87,
  riskLevel: "Medium",
  stakeholders: [
    { name: "Sarah Johnson", role: "Champion", tone: "champion" },
    { name: "Michael Chen", role: "Economic Buyer", tone: "buyer" },
    { name: "David Lee", role: "Decision Maker", tone: "decision" },
  ],
  recommendations: [
    "Lock a mutual close plan with Michael Chen before EOQ",
    "Send the security review packet to unblock InfoSec",
    "Schedule an executive alignment call with the CFO",
  ],
  recommendationCount: 5,
};

function roleTone(role: string): StakeholderView["tone"] {
  const r = role.toLowerCase();
  if (/champion/.test(r)) return "champion";
  if (/economic|buyer|cfo|cpo|budget/.test(r)) return "buyer";
  if (/decision|signer|approver/.test(r)) return "decision";
  return "other";
}

// Map a MEDDPICC read (have/weak/gap) into a rough /10 score so the Progress
// bars have a meaningful value derived from the real record.
function meddicTo10(record: Rec): number {
  const items = dealMeddpicc(record);
  if (!items.length) return 0;
  const pts = items.reduce((a, m) => a + (m.state === "have" ? 1 : m.state === "weak" ? 0.5 : 0), 0);
  return Math.round((pts / items.length) * 100) / 10; // 0..10, one decimal
}

export function buildDealContext(record: Rec | null | undefined): DealContextView {
  if (!record || !record.hard) return PLACEHOLDER;
  const h = record.hard || {};
  const ai = record.ai || {};
  const account = h.account_name || "—";
  const stake = ((ai.stakeholder_map || {}).items || []) as any[];
  const stakeholders: StakeholderView[] = stake.slice(0, 4).map((s) => ({
    name: s.name || "Unknown",
    role: s.role || s.title || "Stakeholder",
    tone: roleTone(s.role || s.title || ""),
  }));
  const meddic = meddicTo10(record);
  const moves = (((ai.recommended_moves || {}).items || []) as any[])
    .slice()
    .sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const recs = moves.map((m) => String(m.action || "").trim()).filter(Boolean);
  // Win-probability read from the verdict where present, else a neutral default.
  const verdict = String((ai.north_star_verdict || {}).verdict || "").toLowerCase();
  const win = /on track|strong|commit/.test(verdict) ? 82 : /risk|watch/.test(verdict) ? 58 : /off/.test(verdict) ? 34 : 65;
  const risk: DealContextView["riskLevel"] = win >= 75 ? "Low" : win >= 50 ? "Medium" : "High";

  return {
    isPlaceholder: false,
    avatarLetter: (account[0] || "?").toUpperCase(),
    accountName: account,
    industry: h.account_industry || "—",
    oppName: h.opp_name || account,
    // Derived, never the raw hard.sf_link — that field is sweep-hallucinated for ~1 in 6
    // deals (other tenants' orgs / placeholders) and would hand the agent a wrong link.
    sfLink: sfLinkFor(h, h.opp_id) || undefined,
    stage: h.stage || "—",
    amount: fmtAmount(h.amount),
    closeDate: h.close_date ? fmtDue(h.close_date) : "—",
    owner: h.owner_name || "—",
    forecast: h.forecast_category || "—",
    meddicScore: meddic,
    bantScore: Math.max(0, Math.round((meddic * 0.9) * 10) / 10),
    winProbability: win,
    riskLevel: risk,
    stakeholders: stakeholders.length ? stakeholders : PLACEHOLDER.stakeholders,
    recommendations: recs.length ? recs.slice(0, 3) : PLACEHOLDER.recommendations,
    recommendationCount: recs.length || PLACEHOLDER.recommendationCount,
  };
}
