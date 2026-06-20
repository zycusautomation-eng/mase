"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deals page header: stat cards + AI insights bar (mockup #38). Numbers are REAL,
// computed from the currently-filtered book + the backend to-dos. Sparklines are
// illustrative (we don't track historical pipeline yet) — shape only.
import Link from "next/link";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { fmtAmount, verdictTone } from "@/lib/engine/helpers";
import { useBackendTodos } from "@/lib/engine/useBackendTodos";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { sfKey } from "@/components/deals/DealTodos";

function fmtM(n: number): string {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n || 0);
}

function Spark({ color, up }: { color: string; up: boolean }) {
  const pts = up ? [5, 8, 6, 10, 8, 12, 9, 14, 13] : [13, 10, 12, 8, 10, 6, 9, 5, 6];
  const w = 92, h = 30, max = 16;
  const d = pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }} aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Insight({ icon, n, label, sub }: { icon: string; n: string | number; label: string; sub: string }) {
  return (
    <div className="dl-insight">
      <span className="dl-ins-ic" aria-hidden>{icon}</span>
      <div>
        <div className="dl-ins-top"><b>{n}</b> {label}</div>
        <div className="dl-ins-sub">{sub}</div>
      </div>
    </div>
  );
}

export default function DealsStats() {
  const { filtered } = useDashboard();
  const backend = useBackendTodos();
  const { done } = useTodoDone();

  const recs = filtered;
  const amt = (r: any) => Number(r.hard?.amount) || 0;
  const isAtRisk = (r: any) => { const v = verdictTone(r.ai?.north_star_verdict?.verdict); return v === "v-risk" || v === "v-off"; };
  const pipeline = recs.reduce((n, r) => n + amt(r), 0);
  const commitRecs = recs.filter((r: any) => r.hard?.forecast_category === "Commit");
  const commit = commitRecs.reduce((n, r) => n + amt(r), 0);
  const atRiskRecs = recs.filter(isAtRisk);
  const atRisk = atRiskRecs.reduce((n, r) => n + amt(r), 0);
  const score = (r: any) => { const c = r.analysis_confidence; return c === "High" ? 85 : c === "Medium" ? 62 : c === "Low" ? 40 : 60; };
  const aiScore = recs.length ? Math.round(recs.reduce((n, r) => n + score(r), 0) / recs.length) : 0;
  const aiLabel = aiScore >= 75 ? "Very Good" : aiScore >= 55 ? "Good" : "Fair";
  const aiColor = aiScore >= 75 ? "#1f9d57" : aiScore >= 55 ? "#d99a00" : "#d6453b";
  const weight = (fc: string) => fc === "Commit" ? 0.9 : fc === "Best Case" ? 0.6 : fc === "Upside" ? 0.4 : fc === "Pipeline" ? 0.25 : 0.15;
  const weighted = recs.reduce((n, r) => n + amt(r) * weight(r.hard?.forecast_category), 0);
  const weightedPct = pipeline ? Math.round((weighted / pipeline) * 100) : 0;

  // To-do based insights, scoped to the filtered deals.
  const scope = new Set(recs.map((r: any) => sfKey(r.opp_id)));
  const flat = backend.flat.filter((it) => scope.has(sfKey(it.opp_id)));
  const todayMs = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00");
  const overdue = flat.filter((it) => { const d = (it.act_by || it.due) as string | undefined; const t = d ? Date.parse(d + "T00:00:00") : NaN; return !isNaN(t) && t < todayMs; }).length;
  const actionsTotal = flat.length;
  const completed = flat.filter((it) => backend.isPushed(it) || done.has(it.todoKey)).length;
  const completedPct = actionsTotal ? Math.round((completed / actionsTotal) * 100) : 0;
  const fcRisks = recs.filter((r: any) => r.ai?.north_star_verdict?.forecast_defensible === false);
  const fcRiskAmt = fcRisks.reduce((n, r) => n + amt(r), 0);
  const moved = recs.filter((r: any) => { const t = r.ai?.north_star_verdict?.trajectory; return t === "stronger" || t === "weaker"; }).length;

  return (
    <div className="dl-head">
      <div className="dl-stats">
        <div className="dl-card">
          <div className="dl-top">Total Pipeline</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(pipeline)}</div><div className="dl-sub">{recs.length} of {recs.length} deals</div></div><div className="dl-spark"><Spark color="#1f9d57" up /></div></div>
        </div>
        <div className="dl-card">
          <div className="dl-top">Commit</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(commit)}</div><div className="dl-sub">{commitRecs.length} deals</div></div><div className="dl-spark"><Spark color="#5b8cff" up /></div></div>
        </div>
        <div className="dl-card">
          <div className="dl-top">At Risk</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(atRisk)}</div><div className="dl-sub">{atRiskRecs.length} deals</div></div><div className="dl-spark"><Spark color="#d6453b" up={false} /></div></div>
        </div>
        <div className="dl-card">
          <div className="dl-top">AI Score</div>
          <div className="dl-row"><div><div className="dl-big">{aiScore}</div><div className="dl-sub" style={{ color: aiColor }}>● {aiLabel}</div></div>
            <div className="dl-donut" style={{ ["--p" as any]: aiScore, ["--c" as any]: aiColor }}><span /></div>
          </div>
        </div>
        <div className="dl-card">
          <div className="dl-top">Weighted Forecast</div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(weighted)}</div><div className="dl-sub">{weightedPct}% of pipeline</div></div><div className="dl-spark"><Spark color="#7c4dff" up /></div></div>
        </div>
      </div>

      <div className="dl-insights">
        <div className="dl-ins-title"><span aria-hidden>✦</span> AI Insights</div>
        <Insight icon="◆" n={atRiskRecs.length} label="Deals need attention" sub={`${overdue} overdue actions`} />
        <Insight icon="◆" n={fcRisks.length} label="Forecast risks" sub={`${fmtAmount(fcRiskAmt)} potential impact`} />
        <Insight icon="◆" n={moved} label="Verdict shifts" sub="AI detected this sweep" />
        <Insight icon="◆" n={actionsTotal} label="Actions generated" sub={`${completedPct}% completed`} />
        <Link href="/espresso" className="dl-ins-btn">View all insights</Link>
      </div>
    </div>
  );
}
