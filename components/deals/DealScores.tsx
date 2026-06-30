"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deal Scores UI — renders the deterministic ai.deal_scores object the backend attaches
// (Win / Momentum / Commitment / Risk + the FC roll-up and a Read confidence label).
// Two surfaces: a compact strip for the deals table and a full panel for the drawer.
// Graceful absence: if a deal has no deal_scores (not yet scored), both render null.
import { scoreColorBand } from "@/lib/engine/helpers";

// Colour band for the FC roll-up (same standard High/Mid/Low ramp).
const band = (v: number) => scoreColorBand("forecast_confidence", v);
// Read label: Full=green, Solid=blue, Partial=amber, Early=grey.
function readBand(label: any): string {
  const k = String(label || "").toLowerCase();
  return k.includes("full") ? "g" : k.includes("solid") ? "b" : k.includes("partial") ? "a" : "n";
}
const r0 = (v: any) => (v == null || isNaN(Number(v)) ? "—" : Math.round(Number(v)));
const bandOf = scoreColorBand;

// One coloured score number for a deals-table column.
export function ScoreCell({ ds, k }: { ds: any; k: string }) {
  const v = ds && ds.headline ? ds.headline[k] : null;
  if (v == null || isNaN(Number(v))) return <span className="ds-cellnum none">—</span>;
  return <span className={`ds-cellnum ds-${scoreColorBand(k, v)}`}>{Math.round(Number(v))}</span>;
}

// A dead deal (Lost / Qualified Out / Omitted) carries no live scores — show its terminal
// state, never misleading numbers.
const deadLabel = (h: any): string | null =>
  h && h.dead ? String(h.dead_label || h.read || "Closed") : null;

// Compact strip for one deals-table row.
export function DealScoreStrip({ ds }: { ds: any }) {
  const h = ds && ds.headline;
  if (!h) return null;
  const dl = deadLabel(h);
  if (dl) return <span className="ds-strip"><span className="ds-chip" style={{ background: "var(--line-soft, #e5e5e5)", color: "var(--ink-soft, #666)" }} title="Closed — not a live opportunity">{dl}</span></span>;
  const chips: [string, string, string][] = [
    ["W", "win_position", "Win position"],
    ["M", "deal_momentum", "Deal momentum (50 = flat)"],
    ["C", "customer_commitment", "Customer commitment"],
    ["R", "deal_risk", "Deal risk (higher = worse)"],
  ];
  return (
    <span className="ds-strip">
      {chips.map(([letter, key, title]) => (
        <span key={key} className={`ds-chip ds-${bandOf(key, h[key])}`} title={`${title}: ${r0(h[key])}`}>
          {letter}{r0(h[key])}
        </span>
      ))}
      <span className={`ds-chip ds-fc ds-${band(h.forecast_confidence)}`} title="Forecast confidence (roll-up)">
        FC {r0(h.forecast_confidence)}
      </span>
      <span className={`ds-read ds-${readBand(h.read)}`} title={`Read: ${h.read}`}>
        {String(h.read || "").replace(/\s*Read$/i, "")}
      </span>
    </span>
  );
}

// Drawer panel: ONLY Zycus Win Position + Deal Momentum, each with the reasons (the
// scored factors) behind it shown inline. Cmt / Risk / FC are intentionally not surfaced.
const FOCUS_ROWS: [string, string, string][] = [
  ["Zycus win position", "win_position", "can we win it"],
  ["Deal momentum", "deal_momentum", "engagement · next steps · milestones"],
];

export function DealScorePanel({ ds }: { ds: any }) {
  const h = ds && ds.headline;
  if (!h) return null;
  const dl = deadLabel(h);
  if (dl) return (
    <div className="ds-panel">
      <div className="ds-panel-head">
        <span className="ds-read big" style={{ background: "var(--line-soft, #e5e5e5)", color: "var(--ink-soft, #666)" }}>{dl}</span>
        <div className="ds-fc-sub">Closed — not a live opportunity, so scores no longer apply.</div>
      </div>
    </div>
  );
  const comm = ds.commentary || {};
  return (
    <div className="ds-panel">
      <div className="ds-rows">
        {FOCUS_ROWS.map(([label, key, hint]) => {
          const sc = ds[key] || {};
          const v = (h as any)[key];
          const why = (comm as any)[key];
          const contribs = (sc.contributions || []).filter((c: any) => c && c.points);
          return (
            <div className="ds-row" key={key}>
              <div className="ds-row-top">
                <span className={`ds-num ds-${bandOf(key, v)}`}>{r0(v)}</span>
                <span className="ds-row-lbl">{label}<span className="ds-hint"> · {hint}</span></span>
              </div>
              {why ? <div className="ds-comm sm">{why}</div> : null}
              {contribs.length ? (
                <div className="ds-contribs open">
                  <div className="ds-contribs-h">Why</div>
                  {contribs.map((c: any, i: number) => (
                    <div className="ds-contrib" key={i}>
                      <span className={`ds-pts ${Number(c.points) >= 0 ? "pos" : "neg"}`}>{Number(c.points) > 0 ? "+" : ""}{c.points}</span>
                      <span className="ds-factor">{String(c.factor || "").replace(/_/g, " ")}</span>
                      {c.evidence ? <span className="ds-evi">{c.evidence}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Full reasons panel for the dedicated drawer "Scores & Reasons" tab: ALL FIVE scores,
// each with its one-line reason (commentary) AND the scored factors behind it (every
// contribution with its points + evidence/source). Admin+VP only — the drawer gates the
// tab on canSeeScores. A lost/closed deal shows its terminal state + the reason, never a
// row of zeros.
const ALL_ROWS: [string, string, string][] = [
  ["Zycus win position", "win_position", "can we win it"],
  ["Deal momentum", "deal_momentum", "engagement · next steps · milestones"],
];

const sgn = (n: any) => { const x = Math.round(Number(n) * 10) / 10; return (x > 0 ? "+" : "") + x; };

export function DealReasonsPanel({ ds }: { ds: any }) {
  const h = ds && ds.headline;
  if (!h) return <div className="ds-panel"><div className="ds-fc-sub">No scores computed for this deal yet.</div></div>;
  const comm = ds.commentary || {};
  // Lost/closed (SF-dead OR a loss detected in the latest call) → terminal state + reason.
  const lost = !!(h.dead || h.decision === "lost" || /^lost/i.test(String(h.read || "")));
  if (lost) {
    const label = h.dead_label || (h.decision === "lost" ? "Lost" : h.read || "Closed");
    const reason = (comm as any).win_position || (comm as any).deal_momentum || (comm as any).deal_risk;
    return (
      <div className="ds-panel">
        <div className="ds-panel-head">
          <span className="ds-read big" style={{ background: "#fdeaea", color: "#b42318" }}>{label}</span>
          <div className="ds-fc-sub">{reason || "This deal is closed / no longer live, so scores no longer apply."}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="ds-panel">
      <div className="ds-rows">
        {ALL_ROWS.map(([label, key, hint]) => {
          const sc = ds[key] || {};
          const v = (h as any)[key];
          const why = (comm as any)[key];
          const cls = key === "forecast_confidence" ? band(v) : bandOf(key, v);
          const contribs = (sc.contributions || []).filter((c: any) => c && Number(c.points));

          // EXACT additive breakdown — the lines shown literally sum to the headline.
          // Win builds from anchor + rubric lift + momentum (then min-capped by the stage
          // ceiling); the per-factor rubric points DON'T sum to the lift (net-clamp + folded
          // trends), so they're shown separately as drivers, not as summed numbers. Momentum
          // (base 50), Commitment (floor 8) and Risk (base 0) sum exactly from their factors.
          let baseVal: number | null = null, baseLabel = "", total = 0, totalNote = "";
          let deltas: [string, number, string | undefined][] = [];
          let drivers: any[] = [];
          if (key === "win_position") {
            baseVal = Number(sc.anchor ?? 0); baseLabel = "Stage anchor";
            const lift = Number(sc.lift ?? 0), mom = Number(sc.momentum_adj ?? 0);
            deltas = [
              ["Rubric (CRM · Next-Step · trends)", lift, undefined],
              ["Momentum boost (vs stage-expected)", mom, undefined],
            ];
            const raw = Math.round((baseVal + lift + mom) * 10) / 10; total = raw;
            const ceil = sc.ceiling != null ? Number(sc.ceiling) : null;
            totalNote = (ceil != null && raw > ceil + 0.05) ? `capped at ${r0(ceil)} (stage ceiling)  →  ${r0(v)}` : `→  ${r0(v)}`;
            drivers = contribs.filter((c: any) => c.factor !== "momentum_adj");
          } else if (key === "deal_momentum" || key === "customer_commitment" || key === "deal_risk") {
            baseVal = key === "deal_momentum" ? 50 : key === "customer_commitment" ? 8 : 0;
            baseLabel = key === "deal_momentum" ? "Baseline (flat = 50)" : key === "customer_commitment" ? "Earned-from-zero floor" : "Base (no observed risk)";
            deltas = contribs.map((c: any) => [String(c.factor || "").replace(/_/g, " "), Number(c.points), c.evidence] as [string, number, string | undefined]);
            total = Math.round((baseVal + contribs.reduce((a: number, c: any) => a + Number(c.points || 0), 0)) * 10) / 10;
            totalNote = `→  ${r0(v)}`;
          }
          const showMath = baseVal != null && deltas.length > 0;

          return (
            <div className="ds-row" key={key}>
              <div className="ds-row-top">
                <span className={`ds-num ds-${cls}`}>{r0(v)}</span>
                <span className="ds-row-lbl">{label}<span className="ds-hint"> · {hint}</span></span>
              </div>
              {why ? <div className="ds-comm sm">{why}</div> : null}
              {showMath ? (
                <div className="ds-contribs open">
                  <div className="ds-contribs-h">How it adds up</div>
                  <div className="ds-contrib" style={{ opacity: 0.85 }}>
                    <span className="ds-pts" style={{ color: "var(--ink-mute, #7c8198)", fontWeight: 600 }}>{Math.round(baseVal!)}</span>
                    <span className="ds-factor">{baseLabel}</span>
                  </div>
                  {deltas.map(([lbl, pts, evi], i) => (
                    <div className="ds-contrib" key={i}>
                      <span className={`ds-pts ${pts >= 0 ? "pos" : "neg"}`}>{sgn(pts)}</span>
                      <span className="ds-factor">{lbl}</span>
                      {evi ? <span className="ds-evi">{evi}</span> : null}
                    </div>
                  ))}
                  <div className="ds-contrib" style={{ borderTop: "1px solid var(--line, #ececf4)", marginTop: 5, paddingTop: 6, fontWeight: 700 }}>
                    <span className="ds-pts" style={{ color: "var(--ink, #1d2030)" }}>{total}</span>
                    <span className="ds-factor">{totalNote}</span>
                  </div>
                </div>
              ) : (!why ? <div className="ds-comm sm" style={{ opacity: 0.7 }}>Roll-up of the four scores above.</div> : null)}
              {drivers.length ? (
                <div className="ds-contribs open" style={{ marginTop: 6 }}>
                  <div className="ds-contribs-h">What moved the rubric</div>
                  {drivers.map((c: any, i: number) => (
                    <div className="ds-contrib" key={i}>
                      <span className={`ds-pts ${Number(c.points) >= 0 ? "pos" : "neg"}`} style={{ opacity: 0.7 }}>{Number(c.points) >= 0 ? "▲" : "▼"}</span>
                      <span className="ds-factor">{String(c.factor || "").replace(/_/g, " ")}</span>
                      {c.evidence ? <span className="ds-evi">{c.evidence}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
