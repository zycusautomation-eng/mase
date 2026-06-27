"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deal Scores UI — renders the deterministic ai.deal_scores object the backend attaches
// (Win / Momentum / Commitment / Risk + the FC roll-up and a Read confidence label).
// Two surfaces: a compact strip for the deals table and a full panel for the drawer.
// Graceful absence: if a deal has no deal_scores (not yet scored), both render null.
import { useState } from "react";

// --- colour bands (per spec) -------------------------------------------------
// Default (Win/Commitment/FC): ≥60 green, 40–59 amber, <40 red.
function band(v: number): string { return v >= 60 ? "g" : v >= 40 ? "a" : "r"; }
// Risk inverts — high is bad.
function riskBand(v: number): string { return v >= 60 ? "r" : v >= 40 ? "a" : "g"; }
// Momentum centres on 50 (flat).
function momBand(v: number): string { return v > 55 ? "g" : v >= 45 ? "n" : "r"; }
// Read label: Full=green, Solid=blue, Partial=amber, Early=grey.
function readBand(label: any): string {
  const k = String(label || "").toLowerCase();
  return k.includes("full") ? "g" : k.includes("solid") ? "b" : k.includes("partial") ? "a" : "n";
}
const r0 = (v: any) => (v == null || isNaN(Number(v)) ? "—" : Math.round(Number(v)));
const bandOf = (key: string, v: number) =>
  key === "deal_risk" ? riskBand(v) : key === "deal_momentum" ? momBand(v) : band(v);

const ROWS: [string, string, string][] = [
  ["Win position", "win_position", "can we win it"],
  ["Deal momentum", "deal_momentum", "50 = flat · >50 forward"],
  ["Customer commitment", "customer_commitment", "customer investment"],
  ["Deal risk", "deal_risk", "higher = worse"],
];

// Compact strip for one deals-table row.
export function DealScoreStrip({ ds }: { ds: any }) {
  const h = ds && ds.headline;
  if (!h) return null;
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

// Full panel for the deal drawer.
export function DealScorePanel({ ds }: { ds: any }) {
  const [open, setOpen] = useState<string | null>(null);
  const h = ds && ds.headline;
  if (!h) return null;
  const comm = ds.commentary || {};
  return (
    <div className="ds-panel">
      <div className="ds-panel-head">
        <div className="ds-fc-big">
          <span className={`ds-num ds-${band(h.forecast_confidence)}`}>{r0(h.forecast_confidence)}</span>
          <div><div className="ds-fc-lbl">Forecast confidence</div><div className="ds-fc-sub">roll-up · sort the book by this</div></div>
        </div>
        <span className={`ds-read big ds-${readBand(h.read)}`} title="how much of the picture we have — a confidence label, not a quality score">{h.read}</span>
      </div>
      {comm.forecast_confidence ? <div className="ds-comm">{comm.forecast_confidence}</div> : null}

      <div className="ds-rows">
        {ROWS.map(([label, key, hint]) => {
          const sc = ds[key] || {};
          const v = (h as any)[key];
          const why = (comm as any)[key];
          const contribs = (sc.contributions || []).filter((c: any) => c && c.points);
          return (
            <div className="ds-row" key={key}>
              <div className="ds-row-top">
                <span className={`ds-num sm ds-${bandOf(key, v)}`}>{r0(v)}</span>
                <span className="ds-row-lbl">{label}<span className="ds-hint"> · {hint}</span></span>
                {contribs.length ? (
                  <button className="ds-why" onClick={() => setOpen(open === key ? null : key)}>{open === key ? "hide" : "why"}</button>
                ) : null}
              </div>
              {why ? <div className="ds-comm sm">{why}</div> : null}
              {open === key ? (
                <div className="ds-contribs">
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
      {comm.evidence_coverage ? <div className="ds-comm read">{comm.evidence_coverage}</div> : null}
    </div>
  );
}
