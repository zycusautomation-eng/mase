"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================================================
// ⚠️  DEPRECATED — DO NOT ADD OR CHANGE DEAL-VIEW UI HERE. THIS IS NOT THE DEAL DRAWER.
// --------------------------------------------------------------------------------------------
// The deal view users actually see when they open a deal is the slide-in drawer:
//        →  components/deals/DealDrawerView.tsx   ← THE CURRENT / LIVE COMPONENT. EDIT THAT.
// That drawer renders its OWN score strip, "What matters", tabs, and every per-deal card
// (including the CEO-help card). DealFold does NOT power the drawer and never has — despite the
// old comment that claimed it was "shared". A change was once added to THIS file and never
// appeared in the UI for exactly that reason. Don't repeat that mistake.
//
// DealFold is retained ONLY because the legacy full-page view
// components/deals/DealDetailView.tsx (route /deals/[id]) still imports it, so deleting it would
// break that build. If you are adding/altering anything a user sees on a deal, do it in
// DealDrawerView.tsx — NOT here. Treat this file as frozen.
// ============================================================================================
import { fmtAmount, daysSince, clipWords, getEbOverride, type Rec } from "@/lib/engine/helpers";

const CSS = `
.dfold{--df-good:var(--green-ink,#0f7a52);--df-warn:var(--amber-ink,#8a5a06);--df-bad:var(--red-ink,#c0341d)}
.dfold *{box-sizing:border-box}
.dfold-meta{font-size:12px;color:var(--muted,#697586);margin:0 0 12px;display:flex;flex-wrap:wrap;gap:7px;align-items:baseline}
.dfold-meta b{color:var(--ink,#101828);font-weight:700}
.dfold-scores{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.dfold-scell{background:var(--surface,#fff);border:1px solid var(--line,#e9edf4);border-radius:14px;padding:13px 16px}
.dfold-sk{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted,#8b93a5)}
.dfold-sv{font-size:30px;font-weight:800;letter-spacing:-1px;margin-top:7px;line-height:1;color:var(--ink,#101828)}
.dfold-sv.b-g{color:var(--df-good)} .dfold-sv.b-a{color:var(--df-warn)} .dfold-sv.b-r{color:var(--df-bad)} .dfold-sv.b-n{color:var(--muted,#8b93a5)}
.dfold-sv .strend{font-size:12px;font-weight:700;color:var(--muted,#8b93a5);letter-spacing:0}
.dfold-sv.aistier{font-size:18px;letter-spacing:-.2px;padding-top:8px}
.dfold-sv.ais-hungry{color:#0f7a52} .dfold-sv.ais-curious{color:#46916b} .dfold-sv.ais-resist{color:var(--df-bad)} .dfold-sv.ais-none{color:var(--muted,#8b93a5)}
.dfold-sm{font-size:11.5px;color:var(--muted,#8b93a5);font-weight:600;margin-top:7px}
.dfold-wm{background:var(--surface,#fff);border:1px solid var(--line,#e9edf4);border-radius:14px;padding:16px 18px;margin-bottom:14px}
.dfold-wm-h{font-size:13px;font-weight:800;color:var(--ink,#101828);margin-bottom:11px}
.dfold-wm-row{display:flex;gap:11px;padding:8px 0;border-top:1px solid var(--line2,#f0f2f8)}
.dfold-wm-row:first-of-type{border-top:none;padding-top:0}
.dfold-wm-lens{flex:0 0 118px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding-top:2px;line-height:1.4}
.dfold-wm-lens.t-pos{color:var(--df-good)} .dfold-wm-lens.t-warn{color:var(--df-warn)} .dfold-wm-lens.t-neu{color:var(--muted,#8b93a5)} .dfold-wm-lens.t-crit{color:var(--df-bad)}
.dfold-wm-text{flex:1;font-size:12.5px;color:var(--ink2,#3d4860);line-height:1.55}
.dfold-donow{background:var(--accent-soft,#eeeefc);border:1px solid #dcdcfb;border-radius:14px;padding:15px 18px}
.dfold-donow-h{display:flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--accent,#5b5bf0);margin-bottom:8px}
.dfold-donow-ic{margin-right:5px;font-size:13px}
.dfold-donow-ai{margin-left:auto;border:none;background:transparent;color:var(--accent,#5b5bf0);font-weight:800;font-size:11px;letter-spacing:.3px;cursor:pointer}
.dfold-donow-text{font-size:13.5px;color:var(--ink,#101828);line-height:1.5;font-weight:600}
.dfold-donow-foot{font-size:11.5px;color:var(--ink2,#3d4860);margin-top:10px;border-top:1px solid #e0e0f7;padding-top:9px}
.dfold-donow-foot b{color:var(--ink,#101828);font-weight:700}
`;

const fmtDate = (s?: string) => { if (!s) return ""; const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

// Map a raw product-scope string ("iContract;iSupplier;Merlin Intake;ANA") to deduped
// high-level module chips (CLM · SRM · Intake · ANA), so headers stay uncrowded.
export function productGroups(scope?: string): string[] {
  const MAP: [RegExp, string][] = [
    [/agentic|\bana\b|autonomous negot/i, "ANA"],
    [/merlin intake|\bintake\b|irequest/i, "Intake"],
    [/icontract|\bclm\b|contract/i, "CLM"],
    [/isupplier|irisk|\bsrm\b|supplier/i, "SRM"],
    [/isource|sourcing|\bs2c\b/i, "Sourcing"],
    [/ianaly|spend/i, "Analytics"],
    [/einvoic/i, "eInvoicing"],
    [/eproc|procure|\bp2p\b/i, "eProc"],
    [/merlin/i, "AI"],
    [/certinal|esign/i, "eSign"],
  ];
  const out: string[] = [];
  String(scope || "").split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((t) => {
    const m = MAP.find(([re]) => re.test(t)); const g = m ? m[1] : t;
    if (g && !out.includes(g)) out.push(g);
  });
  return out;
}

export default function DealFold({ rec, canSeeScores = true, onAskAi }: { rec: Rec; canSeeScores?: boolean; onAskAi?: () => void }) {
  const h = (rec.hard || {}) as any, ai = (rec.ai || {}) as any, pulse = (rec.pulse || {}) as any;
  const nsv = ai.north_star_verdict || {};
  const lastAct = daysSince(h.last_activity_date ?? pulse.last_activity_date);
  const ds = (ai.deal_scores || {}).headline || {};
  const fmtScore = (v: any) => (v == null || isNaN(Number(v)) ? "—" : Math.round(Number(v)));
  const scoreBand = (v: any) => (v == null || isNaN(Number(v)) ? "n" : Number(v) >= 70 ? "g" : Number(v) >= 45 ? "a" : "r");
  const aisTierRaw = String((ai.ai_fit_signal || {}).tier || "").trim();
  const aisKey = /hungry/i.test(aisTierRaw) ? "hungry" : /resist|cold|low/i.test(aisTierRaw) ? "resist" : aisTierRaw ? "curious" : "none";

  const stake = (ai.stakeholder_map || {}).items || [];
  const champ = ai.champion_strength || {};
  const eb = stake.find((s: any) => /economic buyer|^eb$/i.test(String(s.role || ""))) || null;
  const lastMove = ((ai.deal_movement || {}).items || []).slice(-1)[0];
  const bc = ai.business_case || {};
  const moves = ((ai.recommended_moves || {}).items || []).slice().sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99));
  const doNow = moves[0] || null;
  const ebName = getEbOverride(rec.opp_id);
  const spof = champ.at_risk ? `Champion ${champ.champion || ""} is single-threaded / developing.` : "";

  const cro = (s: string) => {
    const tactical = /(\bcrm\b|salesforce|\bfield\b|this sweep|\bsweep\b|per avoma|\bavoma\b|next[- ]step|ais field|no ais)/i;
    const parts = String(s || "").match(/[^.!?]+[.!?]*/g) || [String(s || "")];
    const kept = parts.filter((x) => x.trim() && !tactical.test(x)).join(" ").replace(/\s+/g, " ").trim();
    return kept || String(s || "");
  };
  const sig = (lens: string, text: any, tone = "neu") => ({ lens, text: clipWords(cro(String(text || "")), 30), tone });
  const champName = String(champ.champion || "");
  const ebName2 = String((eb || {}).name || "");
  const sameName = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a) || a.split(" ")[0].toLowerCase() === b.split(" ")[0].toLowerCase());
  const motionText = (doNow || {}).trigger || nsv.math || (lastMove || {}).change || "";
  const structured = Array.isArray(ai.critical_signals)
    ? ai.critical_signals.map((c: any) => ({ lens: c.lens || c.label || "Signal", text: clipWords(cro(String(c.text || c.summary || "")), 30), tone: c.tone || "neu" })).filter((c: any) => c.text)
    : null;
  const derived = ([
    (ai.competitive_position || {}).summary ? sig("Competition", (ai.competitive_position || {}).summary, "warn") : null,
    eb ? sig("Economic buyer", `${ebName2 || "EB"}${eb.title ? ` (${eb.title})` : ""} — our relationship: ${eb.sentiment || eb.risk || "unmapped"}`, eb.risk ? "warn" : "pos") : null,
    (champName && !sameName(champName, ebName2)) ? sig("Champion", `${champName} — ${champ.strength || "developing"} relationship${champ.at_risk ? ", at risk" : ""}`, champ.at_risk ? "warn" : "pos") : null,
    (bc.evidence || bc.status) ? sig("Commercials / value", `Value case ${bc.status || ""}${bc.evidence ? ` — ${bc.evidence}` : ""}`, bc.status === "strong" ? "pos" : "warn") : null,
    motionText ? sig("Latest motion", motionText, "warn") : null,
  ].filter(Boolean) as any[]);
  const signals = (structured && structured.length ? structured : derived).slice(0, 4);

  return (
    <div className="dfold">
      <style>{CSS}</style>
      <div className="dfold-meta">
        <span><b>{fmtAmount(h.amount)}</b></span>
        {h.owner_name ? <span>· {h.owner_name}</span> : null}
        {h.close_date ? <span>· closes {fmtDate(h.close_date)}{pulse.days_to_close != null ? ` · ${pulse.days_to_close}d to close` : ""}</span> : null}
        {lastAct != null ? <span>· last activity {Math.abs(lastAct)}d ago</span> : null}
        <span>· Forecast <b style={{ color: nsv.forecast_defensible === false ? "var(--amber-ink,#8a5a06)" : undefined }}>{nsv.recommended_forecast || h.forecast_category || "—"}</b>{nsv.forecast_defensible === false ? " · not yet earned" : ""}</span>
      </div>

      <div className="dfold-scores">
        <div className="dfold-scell">
          <div className="dfold-sk">Zycus win position</div>
          <div className={`dfold-sv b-${canSeeScores ? scoreBand(ds.win_position) : "n"}`}>{canSeeScores ? fmtScore(ds.win_position) : "—"}</div>
          <div className="dfold-sm">can we win it</div>
        </div>
        <div className="dfold-scell">
          <div className="dfold-sk">Deal momentum</div>
          <div className={`dfold-sv b-${canSeeScores ? scoreBand(ds.deal_momentum) : "n"}`}>{canSeeScores ? fmtScore(ds.deal_momentum) : "—"}{canSeeScores && nsv.trajectory && nsv.trajectory !== "new" ? <span className="strend"> {nsv.trajectory}</span> : null}</div>
          <div className="dfold-sm">is it moving</div>
        </div>
        <div className="dfold-scell">
          <div className="dfold-sk">AI excitement</div>
          <div className={`dfold-sv aistier ais-${aisKey}`}>{aisTierRaw || "—"}</div>
          <div className="dfold-sm">AI appetite</div>
        </div>
      </div>

      {signals.length ? (
        <div className="dfold-wm">
          <div className="dfold-wm-h">⚠ What matters on this deal</div>
          {signals.map((s: any, i: number) => (
            <div className="dfold-wm-row" key={i}>
              <span className={`dfold-wm-lens t-${s.tone}`}>{s.lens}</span>
              <span className="dfold-wm-text">{s.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      {doNow ? (
        <div className="dfold-donow">
          <div className="dfold-donow-h"><span className="dfold-donow-ic">▷</span> Do now{doNow.act_by ? ` · by ${fmtDate(doNow.act_by)}` : ""}{onAskAi ? <button className="dfold-donow-ai" onClick={onAskAi}>Work this with AI →</button> : null}</div>
          <div className="dfold-donow-text">{clipWords(String(doNow.action || ""), 34)}</div>
          {spof ? <div className="dfold-donow-foot"><b>⚠ Single point of failure.</b> {clipWords(spof, 16)}</div>
            : ebName ? <div className="dfold-donow-foot"><b>✓ Economic buyer:</b> {ebName} · confirmed in MEDDPICC</div> : null}
        </div>
      ) : null}
    </div>
  );
}
