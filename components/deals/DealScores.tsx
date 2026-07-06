"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deal Scores UI — renders the deterministic ai.deal_scores object the backend attaches
// (Win / Momentum / Commitment / Risk + the FC roll-up and a Read confidence label).
// Two surfaces: a compact strip for the deals table and a full panel for the drawer.
// Graceful absence: if a deal has no deal_scores (not yet scored), both render null.
import { useState } from "react";
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


// ── CRO-readable narrative ───────────────────────────────────────────────────
// When the backend has attached a `cro_panel` (deal_engine_cro.build_cro_panel),
// render the plain-English brief — one read per score, ✅/⚠️ bullets, an honest
// "what could lose it" block, and the moves — instead of the maths breakdown.
// One bullet. When the backend attached a `full` (the untrimmed narrative behind a
// clipped `text`), show a "more" toggle to expand it in place.
function CroBullet({ b }: { b: any }) {
  const [open, setOpen] = useState(false);
  const hasMore = typeof b.full === "string" && b.full.trim() && b.full.trim() !== (b.text || "").trim();
  return (
    <li className={`cro-b ${b.tone === "warn" ? "warn" : "good"}`}>
      <span className="cro-ic">{b.tone === "warn" ? "⚠️" : "✅"}</span>
      <span className="cro-bt">
        {open && hasMore ? b.full : b.text}
        {hasMore ? (
          <button type="button" onClick={() => setOpen((v) => !v)}
            style={{ marginLeft: 6, padding: 0, border: "none", background: "none",
              color: "var(--indigo, #5b5bf0)", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
            {open ? "less" : "more"}
          </button>
        ) : null}
      </span>
    </li>
  );
}

function CroBullets({ items }: { items: any[] }) {
  if (!items || !items.length) return null;
  return (
    <ul className="cro-bullets">
      {items.map((b: any, i: number) => <CroBullet key={i} b={b} />)}
    </ul>
  );
}

function CroReasons({ panel }: { panel: any }) {
  const blocks = panel.blocks || [];
  return (
    <div className="cro-panel">
      {panel.header ? <div className="cro-head">{panel.header}</div> : null}
      {panel.intro ? <div className="cro-intro">{panel.intro}</div> : null}
      {blocks.map((bl: any, i: number) => {
        if (bl.kind === "score") {
          return (
            <div className="cro-block" key={i}>
              <div className="cro-block-top">
                <span className={`cro-score ds-${bandOf(bl.key || "win_position", bl.score)}`}>{r0(bl.score)}</span>
                <span className="cro-title">{bl.title}{bl.sub ? <span className="cro-sub"> · {bl.sub}</span> : null}</span>
              </div>
              {bl.read ? <div className="cro-read">{bl.read}</div> : null}
              {bl.bullets_head ? <div className="cro-bhead">{bl.bullets_head}</div> : null}
              <CroBullets items={bl.bullets} />
              {bl.how ? (
                <div className="cro-how">
                  <span className="cro-how-l">{bl.how_label || (typeof bl.how === "object" && bl.how.label) || "How it adds up"}</span> {typeof bl.how === "string" ? bl.how : bl.how.text}
                </div>
              ) : null}
              {bl.footer ? <div className="cro-foot">{bl.footer}</div> : null}
            </div>
          );
        }
        if (bl.kind === "risk") {
          return (
            <div className="cro-block cro-risk" key={i}>
              <div className="cro-block-top">
                <span className="cro-risk-ic">⚠️</span>
                <span className="cro-title">{bl.title}{bl.sub ? <span className="cro-sub"> · {bl.sub}</span> : null}</span>
              </div>
              {bl.read ? <div className="cro-read">{bl.read}</div> : null}
              <CroBullets items={(bl.bullets || []).map((b: any) => (typeof b === "string" ? { tone: "warn", text: b } : { ...b, tone: "warn" }))} />
              {bl.footer ? <div className="cro-foot">{bl.footer}</div> : null}
            </div>
          );
        }
        if (bl.kind === "moves") {
          return (
            <div className="cro-block cro-moves" key={i}>
              <div className="cro-block-top"><span className="cro-move-ic">►</span><span className="cro-title">{bl.title || "What moves it forward"}</span></div>
              <ol className="cro-movelist">
                {(bl.items || []).map((m: any, j: number) => <li key={j}>{typeof m === "string" ? m : m.text}</li>)}
              </ol>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export function DealReasonsPanel({ ds }: { ds: any }) {
  const h = ds && ds.headline;
  if (!h) return <div className="ds-panel"><div className="ds-fc-sub">No scores computed for this deal yet.</div></div>;
  const comm = ds.commentary || {};
  // Lost/closed (SF-dead OR a loss detected in the latest call) → terminal state + reason.
  const lost = !!(h.dead || h.decision === "lost" || /^lost/i.test(String(h.read || "")));
  // Prefer the CRO-readable narrative when present (and the deal isn't closed).
  if (ds.cro_panel && (ds.cro_panel.blocks || []).length && !lost) {
    return <div className="ds-panel"><CroReasons panel={ds.cro_panel} /></div>;
  }
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
  // No CRO panel yet (a mid-sweep transient, or a deterministic-only deal). Show a CLEAN
  // read — the score + one plain-English line each — and NEVER the raw math / weights /
  // "how it adds up" / "what moved the rubric" dump (user-directed: that breakdown is not
  // human-readable). Customer Commitment is not shown (dropped from the panel).
  const readFor = (key: string, v: any): string => {
    const n = Number(v);
    if (v == null || isNaN(n)) return "";
    if (key === "win_position") return n >= 70 ? "We're ahead." : n >= 55 ? "We're in it, with a slight edge." : n >= 45 ? "Too close to call." : n >= 30 ? "We're behind." : "We're well behind — this one is cold.";
    if (key === "deal_momentum") return n >= 75 ? "Accelerating — one of the hotter deals in the book." : n >= 60 ? "Moving — steady forward motion." : n >= 50 ? "Lukewarm — some motion, but not strong." : n >= 40 ? "Flat — little is happening." : "Going quiet — engagement has dropped off.";
    if (key === "deal_risk") return n <= 20 ? "No real break-risk observed yet." : n >= 60 ? "Serious downside — this is what could lose it." : "Some downside to keep an eye on.";
    if (key === "forecast_confidence") return n >= 70 ? "On track to close in the forecast window." : n >= 45 ? "Could go either way on timing." : "Unlikely to close in the forecast window as it stands.";
    return "";
  };
  return (
    <div className="ds-panel">
      <div className="ds-fc-sub" style={{ marginBottom: 10 }}>
        A plain-English read on each score. The full deal-specific reasons refresh on the next sweep.
      </div>
      <div className="ds-rows">
        {ALL_ROWS.filter(([, key]) => key !== "customer_commitment").map(([label, key, hint]) => {
          const v = (h as any)[key];
          if (v == null) return null;
          const cls = key === "forecast_confidence" ? band(v) : bandOf(key, v);
          const read = readFor(key, v);
          return (
            <div className="ds-row" key={key}>
              <div className="ds-row-top">
                <span className={`ds-num ds-${cls}`}>{r0(v)}</span>
                <span className="ds-row-lbl">{label}<span className="ds-hint"> · {hint}</span></span>
              </div>
              {read ? <div className="ds-comm sm">{read}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
