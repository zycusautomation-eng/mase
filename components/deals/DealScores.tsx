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
