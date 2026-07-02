// Types mirror the documented backend shapes. Every ai.* sub-object is optional —
// the book may be partially populated, so render defensively.

export interface Descriptor {
  name: string;
  record_count: number;
  auth: string;
  endpoints: string[];
}

export interface Health {
  ok: boolean;
  hasKey: boolean;
  model: string;
}

export interface Team {
  vp: string;
  rsds: string[];
  reportsTo: Record<string, string>;
}

export interface HardFacts {
  account_name?: string;
  opp_name?: string;
  owner_name?: string;
  stage?: string;
  forecast_category?: string;
  amount?: number;
  close_date?: string;
  qualified_date?: string;
  last_activity_date?: string;
  ais_status?: string;
  ais_score?: number;
  [key: string]: unknown;
}

export interface NorthStarVerdict {
  verdict?: string;
  critical?: boolean;
  headline?: string;
  [key: string]: unknown;
}

export interface RecommendedMove {
  rank?: number;
  action?: string;
  owner?: string;
  trigger?: string;
  trigger_date?: string;
  expected_effect?: string;
}

// CEO-intervention gate (backend workflow_v1) — present on forecasted deals; absent
// deals are "not evaluated" and render blank. Mirrors deal.ai.ceo_intervention.
export type CeoInterventionArea = "pricing" | "product" | "presales_resources" | "exec_connect";
export interface CeoIntervention {
  needed: boolean;
  priority?: "high" | "medium";        // only when needed=true
  areas?: CeoInterventionArea[];
  reason?: string;                     // one-line why
  ceo_action?: string;                 // the concrete CEO action
  win?: number;
  mom?: number;
  source?: string;                     // e.g. "workflow_v1"
  generated_at?: string;               // e.g. "2026-07-02"
}

export interface AiAnalysis {
  north_star_verdict?: NorthStarVerdict;
  ceo_intervention?: CeoIntervention;
  recommended_moves?: { items?: RecommendedMove[] };
  open_deliverables?: { items?: Array<{ who?: string; commitment?: string; due?: string; status?: string }> };
  explicit_requirements?: { items?: Array<{ requirement?: string; said_by?: string; date?: string; addressed?: boolean }> };
  implicit_requirements?: { items?: Array<{ inferred_need?: string; grounding_quote?: string; date?: string }> };
  best_practice_check?: { flags?: unknown[] };
  vulnerabilities?: { items?: Array<{ category?: string; [key: string]: unknown }> };
  deal_movement?: unknown;
  competitive_position?: unknown;
  customer_expectations_fit?: unknown;
  gaps?: unknown;
  stakeholder_map?: unknown;
  champion_strength?: unknown;
  ai_positioning_strength?: unknown;
  ai_fit_signal?: unknown;
  confidence_signals?: unknown;
  evidence_coverage?: unknown;
  [key: string]: unknown;
}

export interface DealRecord {
  opp_id: string;
  swept_at?: string;
  analysis_confidence?: string;
  forecast_critical?: boolean;
  hard?: HardFacts;
  ai?: AiAnalysis;
}

export interface OpportunitiesResponse {
  count: number;
  records: DealRecord[];
}

// Backend returns loosely-shaped todo items; keep them open.
export interface TodoItem {
  opp_id: string;
  account_name?: string;
  opp_name?: string;
  owner_name?: string;
  [key: string]: unknown;
}

export interface TodoResponse {
  owner: string;
  critical: TodoItem[];
  important: TodoItem[];
  explicitRequirements: TodoItem[];
  implicit: TodoItem[];
  bestPractice: TodoItem[];
}

export interface CoverageRow {
  owner: string;
  open_amount: number;
  target: number;
  status: "adequate" | "inadequate";
}

export interface StalledDeal {
  opp_id: string;
  account_name?: string;
  opp_name?: string;
  owner_name?: string;
  amount?: number;
  last_activity_date?: string;
  days_since_activity?: number;
}

export interface MatchaResponse {
  owner: string;
  target: number;
  coverage: CoverageRow[];
  byStage: Record<string, { count: number; amount: number }>;
  naaByMonth: Record<string, number>;
  stalledAtQualified: StalledDeal[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  answer: string;
  usage?: Record<string, unknown>;
}
