"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deals page header: stat cards (mockup #38). Numbers are REAL, computed from the
// currently-filtered book. Sparklines are illustrative (we don't track historical
// pipeline yet) — shape only.
//
// The Weighted Forecast card is click-to-open: it explains HOW the blended number is
// reached (it's not a plain sum) — a per-category weighting table that totals to the
// headline figure, plus the biggest weighted contributors (each opens its deal page).
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { verdictTone } from "@/lib/engine/helpers";

function fmtM(n: number): string {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n || 0);
}

// Forecast-category → weight. Matching is case-insensitive and tolerant of the real
// Salesforce strings ("Upside Key Deal" sometimes arrives as just "Upside"). Keep the
// headline number and the modal in lockstep by deriving both from this one place.
function bucketOf(fc: any): { key: string; label: string; weight: number } {
  const k = String(fc || "").toLowerCase();
  if (k === "commit") return { key: "commit", label: "Commit", weight: 0.9 };
  if (k.includes("upside")) return { key: "upside", label: "Upside Key Deal", weight: 0.85 };
  if (k.includes("best")) return { key: "best", label: "Best Case", weight: 0.75 };
  if (k === "pipeline") return { key: "pipeline", label: "Pipeline", weight: 0.25 };
  return { key: "other", label: "Other / blank", weight: 0.15 };
}
const BUCKET_ORDER = ["commit", "upside", "best", "pipeline", "other"];

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

export default function DealsStats() {
  const { filtered } = useDashboard();
  const router = useRouter();
  const [wfOpen, setWfOpen] = useState(false);

  // Close the modal on Escape.
  useEffect(() => {
    if (!wfOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWfOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wfOpen]);

  const recs = filtered;
  const amt = (r: any) => Number(r.hard?.amount) || 0;
  const isAtRisk = (r: any) => { const v = verdictTone(r.ai?.north_star_verdict?.verdict); return v === "v-slow" || v === "v-off"; };
  const pipeline = recs.reduce((n, r) => n + amt(r), 0);
  const commitRecs = recs.filter((r: any) => r.hard?.forecast_category === "Commit");
  const commit = commitRecs.reduce((n, r) => n + amt(r), 0);
  const atRiskRecs = recs.filter(isAtRisk);
  const atRisk = atRiskRecs.reduce((n, r) => n + amt(r), 0);
  const score = (r: any) => { const c = r.analysis_confidence; return c === "High" ? 85 : c === "Medium" ? 62 : c === "Low" ? 40 : 60; };
  const aiScore = recs.length ? Math.round(recs.reduce((n, r) => n + score(r), 0) / recs.length) : 0;
  const aiLabel = aiScore >= 75 ? "Very Good" : aiScore >= 55 ? "Good" : "Fair";
  const aiColor = aiScore >= 75 ? "#1f9d57" : aiScore >= 55 ? "#d99a00" : "#d6453b";
  const weighted = recs.reduce((n, r) => n + amt(r) * bucketOf(r.hard?.forecast_category).weight, 0);
  const weightedPct = pipeline ? Math.round((weighted / pipeline) * 100) : 0;

  // Per-bucket roll-up for the modal: count, raw $, weight, weighted $.
  const grouped: Record<string, { label: string; weight: number; count: number; raw: number }> = {};
  for (const r of recs) {
    const b = bucketOf(r.hard?.forecast_category);
    const g = grouped[b.key] || (grouped[b.key] = { label: b.label, weight: b.weight, count: 0, raw: 0 });
    g.count += 1; g.raw += amt(r);
  }
  const wfRows = BUCKET_ORDER.map((k) => grouped[k]).filter(Boolean).map((g) => ({ ...g, wtd: g.raw * g.weight }));

  // Biggest weighted contributors — each row links into its deal page.
  const wfTop = recs
    .map((r: any) => {
      const b = bucketOf(r.hard?.forecast_category);
      const raw = amt(r);
      return { id: r.opp_id, account: r.hard?.account_name || r.hard?.opp_name || "—", opp: r.hard?.opp_name, label: b.label, weight: b.weight, raw, wtd: raw * b.weight };
    })
    .filter((d) => d.raw > 0)
    .sort((a, b) => b.wtd - a.wtd)
    .slice(0, 8);

  const goDeal = (id: string) => { if (!id) return; setWfOpen(false); router.push(`/deals/${id}`); };

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
        <div
          className="dl-card clickable"
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          onClick={() => setWfOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setWfOpen(true); } }}
        >
          <div className="dl-top">Weighted Forecast <span className="dl-hint">view ↗</span></div>
          <div className="dl-row"><div><div className="dl-big">{fmtM(weighted)}</div><div className="dl-sub">{weightedPct}% of pipeline</div></div><div className="dl-spark"><Spark color="#7c4dff" up /></div></div>
        </div>
      </div>

      {wfOpen ? (
        <>
          <div className="statmodal-back" onClick={() => setWfOpen(false)} />
          <div className="statmodal" role="dialog" aria-modal="true" aria-label="Weighted forecast breakdown">
            <div className="wf-h">
              <div>
                <div className="wf-title">Weighted forecast</div>
                <div className="wf-big">{fmtM(weighted)}</div>
                <div className="wf-sub">{weightedPct}% of {fmtM(pipeline)} pipeline · {recs.length} deals · each deal weighted by forecast category</div>
              </div>
              <button className="wf-x" onClick={() => setWfOpen(false)} aria-label="Close">×</button>
            </div>

            <div className="wf-sec">
              <h4>How the number is built</h4>
              <table className="wf-table">
                <thead>
                  <tr><th>Forecast category</th><th>Deals</th><th>Raw value</th><th>Weight</th><th>Weighted</th></tr>
                </thead>
                <tbody>
                  {wfRows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{r.count}</td>
                      <td>{fmtM(r.raw)}</td>
                      <td><span className="wf-wt">×{r.weight.toFixed(2)}</span></td>
                      <td>{fmtM(r.wtd)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Total</td>
                    <td>{recs.length}</td>
                    <td>{fmtM(pipeline)}</td>
                    <td><span className="wf-wt">{weightedPct}%</span></td>
                    <td>{fmtM(weighted)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="wf-sec">
              <h4>Top weighted contributors</h4>
              <table className="wf-table">
                <thead>
                  <tr><th>Deal</th><th>Category</th><th>Raw</th><th>Weight</th><th>Weighted</th></tr>
                </thead>
                <tbody>
                  {wfTop.map((d) => (
                    <tr key={d.id} className="wf-deal" onClick={() => goDeal(d.id)} title="Open deal">
                      <td>{d.account}</td>
                      <td>{d.label}</td>
                      <td>{fmtM(d.raw)}</td>
                      <td><span className="wf-wt">×{d.weight.toFixed(2)}</span></td>
                      <td>{fmtM(d.wtd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
