"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Redesigned deal drawer ("Bandhan" layout). Rendered by DealDrawer in place of the
// shared DealDetailView, wired to the REAL deal record (rec). The /deals/[id] page
// keeps the original DealDetailView, so this is drawer-only and reversible.
// All CSS is scoped under .ddw so it can never collide with the app's global styles.
import { useMemo, useState } from "react";
import { fmtAmount, daysSince, type Rec } from "@/lib/engine/helpers";
import { useDealAi } from "@/components/deals/DealAiProvider";
import { Monogram } from "@/components/ui/Monogram";

const CSS = `
.ddw{
  --bg-drawer:#f6f6fb; --card:#fff; --ink:#1d2030; --ink-soft:#5a5f73; --ink-mute:#7c8198;
  --ink-faint:#9499ad; --line:#ececf4; --line-soft:#f4f4fa; --indigo:#5b5bf0; --indigo-soft:#eeeefc;
  --violet:#7c5cf5; --crit:#d23b54; --crit-bg:#fdebef; --over:#b26a12; --over-bg:#fbf0df;
  --dep:#1f7a8c; --dep-bg:#e3f3f6; --pos:#1f9d57; --pos-bg:#e7f6ec; --neu:#6b6f86; --neu-bg:#eef0f6;
  --ts:#6b5bf0; --ts-bg:#eceafe; --zy:#c9831f; --zy-bg:#fbf0df; --bu:#2b8fd6; --bu-bg:#e4f1fb;
  --radius:16px; --radius-lg:18px; --shadow-sm:0 1px 2px rgba(29,32,48,.04);
  --shadow-card:0 1px 2px rgba(29,32,48,.04),0 10px 30px rgba(29,32,48,.05); --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  background:var(--bg-drawer); color:var(--ink); -webkit-font-smoothing:antialiased;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.ddw *{box-sizing:border-box}
.ddw .dh{position:sticky;top:0;z-index:20;background:rgba(246,246,251,.92);backdrop-filter:blur(12px);border-bottom:1px solid #e9e9f2;padding:14px 28px 0}
.ddw .dh-top{display:flex;align-items:center;justify-content:space-between}
.ddw .crumb{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink-mute);font-weight:700;cursor:pointer}
.ddw .crumb .chev{font-size:17px;line-height:1}
.ddw .crumb .sep{color:#c4c6d6}
.ddw .crumb .cur{color:#3a3f55}
.ddw .dh-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.ddw .analysed{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--ink-faint);border:1px solid var(--line);border-radius:8px;padding:5px 9px;white-space:nowrap;background:#fff}
.ddw .btn{border:1px solid #e3e3ee;background:#fff;border-radius:9px;padding:7px 13px;font-size:12.5px;font-weight:700;color:var(--ink-soft);cursor:pointer}
.ddw .btn.ai{border:none;background:linear-gradient(120deg,var(--indigo),var(--violet));color:#fff}
.ddw .iconbtn{width:32px;height:32px;border-radius:9px;border:1px solid #e3e3ee;background:#fff;display:grid;place-items:center;color:var(--ink-mute);font-size:15px;cursor:pointer}
.ddw .dh-deal{display:flex;gap:14px;align-items:center;padding:15px 0 16px}
.ddw .dh-deal .globe{width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,#6f6ff3,#a78bfa);flex:none}
.ddw .dh-name{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.ddw .dh-name .t{font-size:21px;font-weight:800;letter-spacing:-.3px}
.ddw .pill{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:7px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;line-height:1.3}
.ddw .pill.risk{background:var(--crit-bg);color:var(--crit)}
.ddw .pill.stage{background:#eceaf6;color:var(--neu);font-weight:700}
.ddw .pill.live{background:var(--pos-bg);color:var(--pos)}
.ddw .pill.crit2{background:var(--crit-bg);color:var(--crit)}
.ddw .pill.pos2{background:var(--pos-bg);color:var(--pos)}
.ddw .pill .dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.ddw .dh-sub{font-size:12.5px;color:var(--ink-faint);margin-top:4px;font-weight:500}
.ddw .body{padding:20px 28px 60px}
.ddw .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.ddw .card-pad{padding:18px 20px}
.ddw .mb14{margin-bottom:14px}
.ddw .mt14{margin-top:14px}
.ddw .pulse{border-radius:var(--radius-lg);padding:6px 6px 16px;box-shadow:var(--shadow-card);margin-bottom:14px}
.ddw .pulse-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.ddw .pcell{padding:16px 18px;border-right:1px solid var(--line-soft)}
.ddw .pcell:last-child{border-right:none}
.ddw .pk{font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--ink-faint);font-family:var(--mono)}
.ddw .pv{font-size:24px;font-weight:800;color:var(--ink);margin-top:7px;letter-spacing:-.4px}
.ddw .pv.big{font-size:34px;letter-spacing:-1px;line-height:1;color:var(--crit)}
.ddw .pmeta{font-size:11px;color:var(--ink-faint);font-weight:600;margin-top:6px}
.ddw .pmeta.bad{color:var(--crit);font-weight:700}
.ddw .pflex{display:flex;align-items:center;gap:7px;margin-top:9px}
.ddw .pflex .dot{width:9px;height:9px;border-radius:50%;background:var(--crit)}
.ddw .pflex .lbl{font-size:18px;font-weight:800;color:var(--ink)}
.ddw .pflex .lbl.crit{color:var(--crit)}
.ddw .ai-hero{border-radius:var(--radius-lg);padding:18px 22px;margin-bottom:14px;box-shadow:var(--shadow-card);position:relative;overflow:hidden;background:var(--card);border:1px solid var(--line)}
.ddw .ai-hero .spine{position:absolute;top:0;left:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--violet),var(--indigo))}
.ddw .ai-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:11px}
.ddw .ai-mark{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--violet),var(--indigo));display:grid;place-items:center;color:#fff;font-size:13px}
.ddw .ai-title{font-size:14px;font-weight:800;color:var(--ink);letter-spacing:-.2px}
.ddw .ai-lede{font-size:15.5px;font-weight:700;color:var(--ink);line-height:1.5;letter-spacing:-.2px}
.ddw .ai-body{font-size:12.5px;color:var(--ink-soft);line-height:1.65;margin-top:10px}
.ddw .ai-body b{color:var(--ink)}
.ddw .play{background:linear-gradient(145deg,#1b1b38,#2a2258);color:#fff;border-radius:var(--radius-lg);padding:20px 22px;margin-bottom:14px;box-shadow:0 12px 34px rgba(27,27,56,.32)}
.ddw .play-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.ddw .play-eyebrow{font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;color:#9b97f0;font-weight:800;font-family:var(--mono)}
.ddw .play-title{font-size:18px;font-weight:800;margin-top:7px;letter-spacing:-.2px}
.ddw .play-cta{border:none;background:#fff;color:#1b1b38;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap}
.ddw .gates{display:flex;margin-top:18px;flex-wrap:wrap;gap:0}
.ddw .gate{flex:1;min-width:200px;padding:0 18px}
.ddw .gate:first-child{padding-left:0}
.ddw .gate+.gate{border-left:1px solid rgba(255,255,255,.12)}
.ddw .gate-head{display:flex;align-items:center;gap:9px}
.ddw .gate-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--indigo)}
.ddw .gate-num.soft{background:rgba(255,255,255,.14)}
.ddw .gate-tag{font-size:10px;font-weight:800;letter-spacing:.6px;color:#9b97f0}
.ddw .gate-t{font-size:13.5px;font-weight:700;margin-top:9px;line-height:1.4}
.ddw .gate-d{font-size:11.5px;color:#c4c2ea;margin-top:6px;line-height:1.5}
.ddw .spof{margin-top:16px;background:rgba(210,59,84,.16);border:1px solid rgba(210,59,84,.45);border-radius:12px;padding:12px 14px;display:flex;gap:11px;align-items:flex-start;font-size:12px;color:#ffe3e8;line-height:1.55}
.ddw .spof b{color:#fff}
.ddw .nav{display:flex;border-bottom:1px solid #e7e7f0;margin-bottom:18px;position:sticky;top:128px;z-index:10;background:var(--bg-drawer)}
.ddw .nav-item{padding:12px 4px;margin-right:18px;font-size:13.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;color:var(--ink-faint);border-bottom:2px solid transparent}
.ddw .nav-item.active{color:var(--indigo);border-bottom-color:var(--indigo)}
.ddw .nav-cnt{font-size:10.5px;font-weight:800;border-radius:999px;padding:1px 7px;background:#ececf4;color:var(--ink-faint)}
.ddw .nav-item.active .nav-cnt{background:var(--indigo);color:#fff}
.ddw .nav-dot{width:7px;height:7px;border-radius:50%;background:var(--crit)}
.ddw .tab{display:none}
.ddw .tab.active{display:block}
.ddw .progress-bar{padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ddw .ring{position:relative;width:54px;height:54px;flex:none}
.ddw .ring svg{transform:rotate(-90deg)}
.ddw .ring .lbl{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;font-weight:800;color:var(--ink)}
.ddw .progress-meta{flex:1;min-width:140px}
.ddw .progress-meta .t{font-size:14px;font-weight:800;color:var(--ink)}
.ddw .progress-meta .d{font-size:12px;color:var(--ink-faint);font-weight:600;margin-top:3px}
.ddw .filters{display:flex;gap:7px;flex-wrap:wrap}
.ddw .fchip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:700;color:var(--ink-mute);cursor:pointer;display:flex;align-items:center;gap:6px}
.ddw .fchip.active{border-color:var(--indigo);color:var(--indigo);background:var(--indigo-soft)}
.ddw .fchip .dot{width:6px;height:6px;border-radius:50%}
.ddw .bucket{margin-bottom:18px}
.ddw .bucket-head{display:flex;align-items:center;gap:9px;margin-bottom:8px;padding:0 2px}
.ddw .bucket-head .sq{width:8px;height:8px;border-radius:3px}
.ddw .bucket-head .t{font-size:11.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-soft)}
.ddw .bucket-head .c{font-size:10.5px;font-weight:800;color:var(--ink-faint);background:var(--line);border-radius:999px;padding:1px 8px}
.ddw .bucket-head .d{font-size:11.5px;color:#b0b3c4;margin-left:auto;font-weight:500}
.ddw .bucket-body{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow-sm)}
.ddw .item{display:flex;gap:13px;padding:14px 16px;border-top:1px solid var(--line-soft);align-items:flex-start;border-left:3px solid #e6e6ef}
.ddw .item:first-child{border-top:none}
.ddw .check{width:19px;height:19px;border:2px solid #cfd2e2;border-radius:6px;margin-top:1px;cursor:pointer;flex:none;display:grid;place-items:center;font-size:12px;font-weight:900;color:#fff;background:#fff}
.ddw .check.on{border-color:var(--indigo);background:var(--indigo)}
.ddw .check.advisory{border:none;background:none;color:#c4c6d6;font-size:13px;cursor:default}
.ddw .it-body{flex:1;min-width:0}
.ddw .it-title{font-size:13.5px;font-weight:600;line-height:1.5;color:var(--ink)}
.ddw .item.done .it-title{text-decoration:line-through;color:var(--ink-faint)}
.ddw .it-sub{font-size:12px;color:var(--ink-mute);margin-top:5px;line-height:1.55}
.ddw .it-sub .close{color:var(--indigo);font-weight:700}
.ddw .it-meta{display:flex;gap:7px;align-items:center;margin-top:9px;flex-wrap:wrap}
.ddw .flag{font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;letter-spacing:.2px}
.ddw .flag .dot{width:5px;height:5px;border-radius:50%}
.ddw .flag.crit{background:var(--crit-bg);color:var(--crit)} .ddw .flag.crit .dot{background:var(--crit)}
.ddw .flag.over{background:var(--over-bg);color:var(--over)} .ddw .flag.over .dot{background:var(--over)}
.ddw .flag.dep{background:var(--dep-bg);color:var(--dep)} .ddw .flag.dep .dot{background:var(--dep)}
.ddw .chip{font-size:11px;font-weight:600;border-radius:6px;padding:3px 8px;color:var(--ink-soft);background:#f3f3f9}
.ddw .chip.due{color:var(--over);background:#fbf3e4}
.ddw .it-right{display:flex;align-items:center;gap:9px;flex:none}
.ddw .owner{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:800}
.ddw .owner.ts{background:var(--ts-bg);color:var(--ts)}
.ddw .owner.zy{background:var(--zy-bg);color:var(--zy)}
.ddw .owner.bu{background:var(--bu-bg);color:var(--bu)}
.ddw .sf{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--ink-faint);border:1px solid var(--line);border-radius:8px;padding:5px 9px;white-space:nowrap}
.ddw .ic-title{font-size:13px;font-weight:800;display:flex;align-items:center;gap:9px;color:var(--ink);flex-wrap:wrap}
.ddw .ic-body{font-size:12.5px;color:var(--ink-soft);line-height:1.65}
.ddw .ic-body b{color:var(--ink)}
.ddw .twocol{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-bottom:14px}
.ddw .meter{display:flex;gap:4px;margin:14px 0}
.ddw .meter span{height:8px;flex:1;border-radius:3px;background:#eeeef6}
.ddw .meter span.on{background:#e34b63}
.ddw .comp{padding:12px 0;border-top:1px solid var(--line-soft);display:flex;gap:14px;align-items:flex-start}
.ddw .comp .lead{width:120px;flex:none}
.ddw .comp .nm{font-size:13px;font-weight:800;color:var(--ink)}
.ddw .threat{display:inline-block;margin-top:6px;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px}
.ddw .threat.hi{background:var(--crit-bg);color:var(--crit)}
.ddw .threat.med{background:var(--over-bg);color:var(--over)}
.ddw .threat.lo{background:var(--neu-bg);color:var(--neu)}
.ddw .comp .win{font-size:12px;color:var(--ink-soft);line-height:1.55;flex:1}
.ddw .cov-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.ddw .cov-warn{font-size:11.5px;font-weight:800;color:var(--crit);background:var(--crit-bg);border-radius:999px;padding:3px 10px}
.ddw .cov-lede{font-size:12px;color:var(--ink-mute);line-height:1.55;margin:7px 0 14px}
.ddw .cov-grid{display:flex;gap:8px;flex-wrap:wrap}
.ddw .cov{border-radius:11px;padding:9px 12px;min-width:120px}
.ddw .cov .nm{font-size:12px;font-weight:800}
.ddw .cov .role{font-size:10.5px;font-weight:600;margin-top:2px}
.ddw .cov .stat{font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;margin-top:6px}
.ddw .cov.live{background:#eaf7ef;border:1px solid #c8ecd6} .ddw .cov.live .role{color:#5a8a6c} .ddw .cov.live .stat{color:var(--pos)}
.ddw .cov.warm{background:#fff;border:1px solid #e7e7f0} .ddw .cov.warm .role{color:var(--ink-faint)} .ddw .cov.warm .stat{color:var(--over)}
.ddw .cov.dark{background:#fdeef1;border:1px solid #f6d2da} .ddw .cov.dark .role{color:#b6798a} .ddw .cov.dark .stat{color:var(--crit)}
.ddw .cov.none{background:#f6f6fa;border:1px dashed #d6d7e6} .ddw .cov.none .nm{color:var(--ink-faint)} .ddw .cov.none .role{color:#b0b3c4} .ddw .cov.none .stat{color:#b0b3c4}
.ddw .sh{display:flex;gap:14px;padding:13px 0;border-top:1px solid var(--line-soft);align-items:flex-start}
.ddw .sh:first-of-type{border-top:none}
.ddw .sh .av{width:32px;height:32px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;font-weight:800}
.ddw .sh .who{width:160px;flex:none}
.ddw .sh .who .nm{font-size:13px;font-weight:700;color:var(--ink)}
.ddw .sh .who .role{font-size:11.5px;color:var(--ink-faint);margin-top:2px}
.ddw .sh .who .pow{margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ddw .sh .who .pow .p{font-size:10.5px;font-weight:700;color:var(--neu)}
.ddw .sent{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:6px;white-space:nowrap;line-height:1.3;align-self:flex-start}
.ddw .sent.pos{background:var(--pos-bg);color:var(--pos)}
.ddw .sent.neu{background:var(--neu-bg);color:var(--neu)}
.ddw .sent.unk{background:var(--crit-bg);color:var(--crit)}
.ddw .sh .read{flex:1;font-size:12px;color:var(--ink-soft);line-height:1.55}
.ddw .note{font-size:11px;color:#b0b3c4;margin-top:12px;font-style:italic}
.ddw .medd{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.ddw .med{border-radius:10px;padding:10px 12px}
.ddw .med .l{font-size:11px;font-weight:800;color:#3a3f55}
.ddw .med .s{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;margin-top:5px}
.ddw .med.weak{background:#fdf1f3;border:1px solid #f6d9df} .ddw .med.weak .s{color:var(--crit)}
.ddw .med.ok{background:#eef8f1;border:1px solid #d2eedb} .ddw .med.ok .s{color:var(--pos)}
.ddw .risk{display:flex;gap:11px;padding:10px 0;border-top:1px solid var(--line-soft);align-items:flex-start}
.ddw .risk:first-of-type{border-top:none}
.ddw .risk .dot{width:7px;height:7px;border-radius:50%;background:var(--crit);margin-top:6px;flex:none}
.ddw .risk .txt{font-size:12.5px;color:var(--ink-soft);line-height:1.6}
.ddw .risk .txt b{color:var(--crit)}
`;

const initials = (s: any) =>
  String(s || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "—";
const cap = (s: any) => { const t = String(s || ""); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
const sentClass = (s: any) => { const t = String(s || "").toLowerCase(); return /pos/.test(t) ? "pos" : /neg|unk|risk/.test(t) ? "unk" : "neu"; };
// Sentiment is sometimes a full sentence from the model — the pill must show only a
// short label (the long prose, if any, drops into the read column instead).
const sentLabel = (s: any) => { const t = String(s || "").toLowerCase(); return /pos/.test(t) ? "Positive" : /neg|risk|concern|unk/.test(t) ? "At risk" : t ? "Neutral" : "Unknown"; };
const fmtDate = (s: any) => { if (!s) return ""; const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

export default function DealDrawerView({ rec, onClose }: { rec: Rec; onClose?: () => void }) {
  const { openNewDeal } = useDealAi();
  const [tab, setTab] = useState<"action" | "intel" | "people">("action");
  const [filter, setFilter] = useState<string>("all");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const h = rec.hard || {}, ai = rec.ai || {}, pulse = rec.pulse || {};
  const nsv = ai.north_star_verdict || {};
  const verdict = nsv.verdict || "—";
  const vRisk = /risk|off|stall/i.test(verdict);
  const repInit = initials(h.owner_name);
  const lastAct = daysSince(h.last_activity_date ?? pulse.last_activity_date);
  const analysed = (() => {
    const s = rec.swept_at; if (!s) return null;
    const d = new Date(s); if (isNaN(d.getTime())) return { label: String(s), rel: "" };
    const n = daysSince(s);
    return { label: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), rel: n == null || n < 0 ? "" : n === 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago` };
  })();

  // ---- The Play / gates ----
  const moves = ((ai.recommended_moves || {}).items || []).slice()
    .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99));
  const gates = moves.slice(0, 3);
  const medd = ai.meddpicc || {};
  const ebGap = (medd.economic_buyer || {}).status === "gap";
  const champ = ai.champion_strength || {};
  const spof = ebGap
    ? `Economic Buyer unmapped. ${(medd.economic_buyer || {}).status === "gap" ? "Never confirmed in Salesforce contact roles or on a call." : ""} Every critical item routes through getting them engaged.`
    : champ.at_risk
      ? `Champion ${champ.champion || ""} is single-threaded / developing — no confirmed executive multi-thread.`
      : "";

  // ---- Main blocker ----
  const blockerKey = ["economic_buyer", "paper_process", "metrics", "champion", "decision_process"]
    .find((k) => ((medd as any)[k] || {}).status === "gap");
  const blockerLabel = blockerKey
    ? ({ economic_buyer: "Economic Buyer", paper_process: "Paper / Legal", metrics: "Metrics", champion: "Champion", decision_process: "Decision Process" } as any)[blockerKey]
    : ((ai.vulnerabilities || {}).items || [])[0]?.category ? cap(((ai.vulnerabilities || {}).items || [])[0].category) : "—";

  // ---- Action buckets, normalised ----
  const buckets = useMemo(() => {
    // Deterministic flag rule (assigned here, not guessed by the model):
    //   crit (blocks close) = top-2 ranked move OR a dated item due on/before close OR a
    //                         budget/EB/sign-off best-practice gate
    //   over (overdue/aging) = due date in the past, OR asked/raised > AGING days ago
    //   dep (needs another team) = owner OR text references a team outside the deal team
    const now = Date.now();
    const closeMs = h.close_date ? new Date(h.close_date).getTime() : null;
    const AGING = 30;
    const DEP_RE = /\b(solution|technical|infra|cloud|market|reference|legal|msa|contract|security|infosec|presales|product|implement|integration|oracle|erp|data ?cent|sap)\b/i;
    const CRIT_BP_RE = /budget|economic buyer|\beb\b|sponsor|sign-?off|approval|single-?thread|never (been )?on a call/i;
    const ms = (d: any) => { if (!d) return null; const t = new Date(d).getTime(); return isNaN(t) ? null : t; };
    const past = (d: any) => { const t = ms(d); return t != null && t < now; };
    const aging = (d: any) => { const t = ms(d); return t != null && (now - t) / 86400000 > AGING; };
    const onBeforeClose = (d: any) => { const t = ms(d); return t != null && closeMs != null && t <= closeMs; };
    const mkFlags = (o: { due?: any; date?: any; owner?: any; rank?: any; text?: any; bp?: boolean }): [string, string][] => {
      const fl: [string, string][] = [];
      const crit = (o.rank != null && o.rank <= 2) || onBeforeClose(o.due) || (!!o.bp && CRIT_BP_RE.test(String(o.text || "")));
      const over = past(o.due) || aging(o.date);
      const dep = DEP_RE.test(String(o.owner || "")) || DEP_RE.test(String(o.text || ""));
      if (crit) fl.push(["crit", "Critical"]);
      if (over) fl.push(["over", past(o.due) ? "Overdue" : "Aging"]);
      if (dep) fl.push(["dep", "Dependency"]);
      return fl;
    };

    const deliv = (ai.open_deliverables || {}).items || [];
    const isBuyer = (d: any) => String(d.who || "").toLowerCase().includes("buyer") || d.waiting_on_buyer;
    const explicit = (ai.explicit_requirements || {}).items || [];
    const flags = (ai.best_practice_check || {}).flags || [];
    const zyOwed = deliv.filter((d: any) => !isBuyer(d));
    const buyerOwed = deliv.filter(isBuyer);

    const b1 = [
      ...explicit.map((r: any, i: number) => ({
        id: `e${i}`, title: r.requirement, sub: r.said_by ? `Asked by ${r.said_by}` : "",
        flags: mkFlags({ due: r.due, date: r.date, text: r.requirement }), chips: r.date ? [[fmtDate(r.date), 0]] : [], owner: "ts",
      })),
      ...zyOwed.map((d: any, i: number) => ({
        id: `z${i}`, title: d.commitment, sub: "",
        flags: mkFlags({ due: d.due, date: d.date, text: d.commitment }), chips: d.due ? [[`Due ${fmtDate(d.due)}`, 1]] : [], owner: "zy",
      })),
    ];
    const b2 = moves.map((m: any, i: number) => ({
      id: `m${i}`, title: m.action, sub: m.expected_effect || "",
      flags: mkFlags({ due: m.act_by, date: m.trigger_date, owner: m.owner, rank: m.rank, text: m.action }),
      chips: m.act_by ? [[`By ${fmtDate(m.act_by)}`, 1]] : [], owner: "zy",
    }));
    const b3 = buyerOwed.map((d: any, i: number) => ({
      id: `b${i}`, title: d.commitment, sub: "",
      flags: mkFlags({ due: d.due, date: d.date, text: d.commitment }), chips: d.due ? [[`Due ${fmtDate(d.due)}`, 1]] : [], owner: "bu",
    }));
    const b4 = (Array.isArray(flags) ? flags : []).map((f: any, i: number) => {
      const txt = typeof f === "string" ? f : (f.flag || JSON.stringify(f));
      return { id: `f${i}`, title: txt, sub: "", flags: mkFlags({ text: txt, bp: true }), chips: [], owner: "ts", advisory: true };
    });

    return [
      { color: "#c9831f", title: "Prospect Requirements", desc: "What they asked us to deliver", advisory: false, items: b1 },
      { color: "#5b5bf0", title: "Zycus to Deliver", desc: "Recommended plays to move the deal", advisory: false, items: b2 },
      { color: "#2b8fd6", title: "Waiting on the Buyer", desc: "What they owe us", advisory: false, items: b3 },
      { color: "#6a7180", title: "Best Practices", desc: "Plays from experience · advisory", advisory: true, items: b4 },
    ].filter((b) => b.items.length);
  }, [rec]);

  const actionItems = buckets.filter((b) => !b.advisory).flatMap((b) => b.items);
  const total = actionItems.length;
  const done = actionItems.filter((it: any) => checked[it.id]).length;
  const C = 138.23;

  // ---- coverage + stakeholders ----
  const stake = (ai.stakeholder_map || {}).items || [];
  const covOf = (s: any) => {
    const n = daysSince(s.last_contact_date);
    if (n == null) return { kind: "none", stat: "No contact" };
    if (n <= 14) return { kind: "live", stat: "Live thread" };
    if (n <= 45) return { kind: "warm", stat: `${n}d ago` };
    return { kind: "dark", stat: `Dark ${n}d` };
  };
  const liveCount = stake.filter((s: any) => covOf(s).kind === "live").length;

  const competitors = (ai.competitive_position || {}).competitors || [];
  const compWin = (c: any) => c.how_we_win || c.why || c.recommendation || c.win || c.note || "";
  const compThreat = (c: any) => {
    const t = String(c.threat_level || c.threat || c.level || "").toLowerCase();
    return /hi|high/.test(t) ? ["hi", "High threat"] : /lo|low/.test(t) ? ["lo", "Low"] : ["med", t ? cap(t) : "Threat"];
  };

  const meddDims: [string, string][] = [
    ["Metrics", "metrics"], ["Econ. Buyer", "economic_buyer"], ["Decision Criteria", "decision_criteria"],
    ["Decision Process", "decision_process"], ["Pain", "identify_pain"], ["Champion", "champion"], ["Competition", "competition"], ["Paper", "paper_process"],
  ];
  const vulns = (ai.vulnerabilities || {}).items || [];

  const dealForAi = { oid: rec.opp_id, accountName: h.account_name || rec.opp_id, oppName: h.opp_name, ownerName: h.owner_name };

  return (
    <div className="ddw">
      <style>{CSS}</style>

      <div className="dh">
        <div className="dh-top">
          <div className="crumb" onClick={onClose}><span className="chev">‹</span> Deals <span className="sep">/</span> <span className="cur">{h.account_name || rec.opp_id}</span></div>
          <div className="dh-actions">
            {analysed ? <span className="analysed" title={`Last analysed ${rec.swept_at}`}>✦ Analysed {analysed.label}{analysed.rel ? ` · ${analysed.rel}` : ""}</span> : null}
            {h.sf_link ? <a className="btn" href={h.sf_link} target="_blank" rel="noreferrer">Salesforce ↗</a> : null}
            <button className="btn ai" onClick={() => openNewDeal(dealForAi)}>✦ Ask AI</button>
            <div className="iconbtn" onClick={onClose}>✕</div>
          </div>
        </div>
        <div className="dh-deal">
          <Monogram name={h.account_name || rec.opp_id} kind="account" size={46} style={{ borderRadius: 13 }} />
          <div>
            <div className="dh-name">
              <span className="t">{h.account_name || rec.opp_id}</span>
              {verdict !== "—" ? <span className={`pill ${vRisk ? "risk" : "live"}`}><span className="dot" />{verdict}</span> : null}
              {h.stage ? <span className="pill stage">{h.stage}</span> : null}
            </div>
            <div className="dh-sub">{h.opp_name || ""}{h.owner_name ? ` · Owner ${h.owner_name}` : ""}{lastAct != null ? ` · Last activity ${lastAct}d ago` : ""}</div>
          </div>
        </div>
      </div>

      <div className="body">
        {/* PULSE */}
        <div className="card pulse">
          <div className="pulse-grid">
            <div className="pcell">
              <div className="pk">Days to close</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 7 }}>
                <span className={`pv ${vRisk ? "big" : ""}`}>{pulse.days_to_close ?? "—"}</span>
                {h.close_date ? <span className="pmeta" style={{ marginTop: 0 }}>· {fmtDate(h.close_date)}</span> : null}
              </div>
              {nsv.trajectory && nsv.trajectory !== "new" ? <div className="pmeta">{nsv.trajectory}</div> : null}
            </div>
            <div className="pcell">
              <div className="pk">Health</div>
              <div className="pflex"><span className="dot" style={{ background: vRisk ? "var(--crit)" : "var(--pos)" }} /><span className="lbl">{verdict}</span></div>
              <div className="pmeta">AI confidence · {rec.analysis_confidence || "—"}</div>
            </div>
            <div className="pcell">
              <div className="pk">Deal value</div>
              <div className="pv">{fmtAmount(h.amount)}</div>
              <div className="pmeta">Forecast · <b style={{ color: nsv.forecast_defensible === false ? "var(--over)" : "var(--ink)" }}>{nsv.recommended_forecast || h.forecast_category || "—"}</b></div>
            </div>
            <div className="pcell">
              <div className="pk">Main blocker</div>
              <div className="pflex"><span className="lbl crit">{blockerLabel}</span></div>
              <div className="pmeta">{pulse.state ? cap(pulse.state) : ""}{pulse.days_since_activity != null ? ` · ${pulse.days_since_activity}d since activity` : ""}</div>
            </div>
          </div>
        </div>

        {/* AI SUMMARY HERO */}
        <div className="card ai-hero">
          <div className="ai-head">
            <span className="ai-mark">✦</span>
            <span className="ai-title">AI Summary</span>
            {verdict !== "—" ? <span className={`pill ${vRisk ? "risk" : "live"}`}><span className="dot" />{verdict}</span> : null}
            {pulse.state ? <span className="pill live">{cap(pulse.state)}{lastAct != null ? ` · updated ${lastAct}d ago` : ""}</span> : null}
          </div>
          {nsv.headline ? <div className="ai-lede">{nsv.headline}</div> : null}
          {(champ.summary || (ai.confidence_signals || {}).summary || moves[0]) ? (
            <div className="ai-body">
              {champ.summary || (ai.confidence_signals || {}).summary || ""}
              {moves[0]?.action ? <> <b>The move:</b> {moves[0].action}</> : null}
            </div>
          ) : null}
        </div>

        {/* THE PLAY */}
        {gates.length ? (
          <div className="play">
            <div className="play-top">
              <div>
                <div className="play-eyebrow">The play · what moves this deal</div>
                <div className="play-title">{gates.length} ranked move{gates.length > 1 ? "s" : ""} — top first</div>
              </div>
              <button className="play-cta" onClick={() => openNewDeal(dealForAi)}>Work this with AI →</button>
            </div>
            <div className="gates">
              {gates.map((m: any, i: number) => (
                <div className="gate" key={i}>
                  <div className="gate-head"><span className={`gate-num ${i > 1 ? "soft" : ""}`}>{i + 1}</span><span className="gate-tag">{(m.owner || "MOVE").toUpperCase()}{m.act_by ? ` · BY ${fmtDate(m.act_by)}` : ""}</span></div>
                  <div className="gate-t">{m.action}</div>
                  {m.expected_effect ? <div className="gate-d">{m.expected_effect}</div> : (m.trigger ? <div className="gate-d">{m.trigger}</div> : null)}
                </div>
              ))}
            </div>
            {spof ? <div className="spof"><span>⚠</span><div><b>Single point of failure.</b> {spof}</div></div> : null}
          </div>
        ) : null}

        {/* SECTION NAV */}
        <div className="nav">
          <div className={`nav-item ${tab === "action" ? "active" : ""}`} onClick={() => setTab("action")}>Action Plan <span className="nav-cnt">{done}/{total}</span></div>
          <div className={`nav-item ${tab === "intel" ? "active" : ""}`} onClick={() => setTab("intel")}>Deal Intelligence</div>
          <div className={`nav-item ${tab === "people" ? "active" : ""}`} onClick={() => setTab("people")}>Stakeholders &amp; Risk {liveCount < stake.length ? <span className="nav-dot" /> : null}</div>
        </div>

        {/* ===== ACTION ===== */}
        <div className={`tab ${tab === "action" ? "active" : ""}`}>
          <div className="card progress-bar">
            <div className="ring">
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="22" fill="none" stroke="#eeeef6" strokeWidth="6" />
                <circle cx="27" cy="27" r="22" fill="none" stroke="#5b5bf0" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={total ? (C * (1 - done / total)).toFixed(2) : C} style={{ transition: "stroke-dashoffset .35s ease" }} />
              </svg>
              <div className="lbl">{done}/{total}</div>
            </div>
            <div className="progress-meta">
              <div className="t">Action plan</div>
              <div className="d">{total === 0 ? "No open actions." : done === total ? "All actions complete — push for the close." : "Open actions across requirements, plays and buyer dependencies."}</div>
            </div>
            <div className="filters">
              {[["all", "All", ""], ["crit", "Critical", "var(--crit)"], ["over", "Overdue", "var(--over)"], ["dep", "Dependency", "var(--dep)"]].map(([f, label, col]) => (
                <button key={f} className={`fchip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{col ? <span className="dot" style={{ background: col }} /> : null}{label}</button>
              ))}
            </div>
          </div>

          {buckets.map((b, bi) => {
            const items = b.items.filter((it: any) => filter === "all" || (it.flags || []).some((f: any) => f[0] === filter));
            if (!items.length) return null;
            return (
              <div className="bucket" key={bi}>
                <div className="bucket-head"><span className="sq" style={{ background: b.color }} /><span className="t">{b.title}</span><span className="c">{b.items.length}</span><span className="d">{b.desc}</span></div>
                <div className="bucket-body">
                  {items.map((it: any) => {
                    const isDone = !!checked[it.id];
                    const accent = (it.flags || []).some((f: any) => f[0] === "crit") ? "var(--crit)" : (it.flags || []).some((f: any) => f[0] === "over") ? "var(--over)" : (it.flags || []).some((f: any) => f[0] === "dep") ? "var(--dep)" : "#e6e6ef";
                    return (
                      <div className={`item ${isDone && !b.advisory ? "done" : ""}`} style={{ borderLeftColor: accent }} key={it.id}>
                        {b.advisory ? <div className="check advisory">◇</div>
                          : <div className={`check ${isDone ? "on" : ""}`} onClick={() => setChecked((c) => ({ ...c, [it.id]: !c[it.id] }))}>{isDone ? "✓" : ""}</div>}
                        <div className="it-body">
                          <div className="it-title">{it.title}</div>
                          {it.sub ? <div className="it-sub">{it.sub}</div> : null}
                          {(it.flags?.length || it.chips?.length) ? (
                            <div className="it-meta">
                              {(it.flags || []).map((f: any, i: number) => <span className={`flag ${f[0]}`} key={`f${i}`}><span className="dot" />{f[1]}</span>)}
                              {(it.chips || []).map((c: any, i: number) => <span className={`chip ${c[1] ? "due" : ""}`} key={`c${i}`}>{c[0]}</span>)}
                            </div>
                          ) : null}
                        </div>
                        <div className="it-right"><div className={`owner ${it.owner}`}>{it.owner === "ts" ? repInit : it.owner.toUpperCase()}</div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!buckets.length ? <div className="card card-pad ic-body">No action items on this deal yet.</div> : null}
        </div>

        {/* ===== INTEL ===== */}
        <div className={`tab ${tab === "intel" ? "active" : ""}`}>
          <div className="card card-pad mb14">
            <div className="ic-title" style={{ marginBottom: 12 }}>✦ AI Summary {verdict !== "—" ? <span className={`pill ${vRisk ? "crit2" : "pos2"}`}>{verdict}</span> : null}{pulse.state ? <span className="pill pos2">{cap(pulse.state)}</span> : null}</div>
            <div className="ic-body">{(ai.confidence_signals || {}).summary || nsv.headline || "No summary."}</div>
          </div>
          <div className="twocol">
            <div className="card card-pad">
              <div className="ic-title">AI Fit {(ai.ai_fit_signal || {}).tier ? <span className="pill crit2">{(ai.ai_fit_signal || {}).tier}</span> : null}</div>
              {(() => {
                const tier = String((ai.ai_fit_signal || {}).tier || "").toLowerCase();
                const score = /hungry/.test(tier) ? 8 : /warm/.test(tier) ? 5 : /latent/.test(tier) ? 3 : /resist|cold/.test(tier) ? 1 : 5;
                return <div className="meter">{Array.from({ length: 10 }).map((_, i) => <span key={i} className={i < score ? "on" : ""} />)}</div>;
              })()}
              <div className="ic-body">{(ai.ai_fit_signal || {}).summary || "No AI-fit signal."}</div>
            </div>
            <div className="card card-pad">
              <div className="ic-title">Pulse &amp; Forecast</div>
              <div className="ic-body" style={{ marginTop: 12 }}>
                {pulse.summary ? <><b>{cap(pulse.state)}.</b> {pulse.summary}<br /><br /></> : null}
                <b>Forecast:</b> {h.forecast_category || "—"}{nsv.recommended_forecast && nsv.forecast_defensible === false ? <> → recommend <b style={{ color: "var(--over)" }}>{nsv.recommended_forecast}</b></> : null}.
                <br /><b>Verdict:</b> {verdict} · Confidence {rec.analysis_confidence || "—"} · {fmtAmount(h.amount)} at stake.
              </div>
            </div>
          </div>
          <div className="card card-pad">
            <div className="ic-title">Competition</div>
            {(ai.competitive_position || {}).summary ? <div className="ic-body" style={{ color: "var(--ink-mute)", margin: "6px 0 8px" }}>{(ai.competitive_position || {}).summary}</div> : null}
            {competitors.map((c: any, i: number) => {
              const th = compThreat(c); const win = compWin(c);
              return (
                <div className="comp" key={i}>
                  <div className="lead"><div className="nm">{c.name || c.competitor || "Competitor"}</div><span className={`threat ${th[0]}`}>{th[1]}</span></div>
                  {win ? <div className="win"><b style={{ color: "var(--ink)" }}>How we win:</b> {win}</div> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== PEOPLE ===== */}
        <div className={`tab ${tab === "people" ? "active" : ""}`}>
          <div className="card card-pad mb14">
            <div className="cov-head">
              <div className="ic-title">Relationship coverage</div>
              {stake.length ? <div className="cov-warn">{liveCount} of {stake.length} live</div> : null}
            </div>
            <div className="cov-lede">{stake.length ? `${stake.length} mapped stakeholder${stake.length > 1 ? "s" : ""} — ${liveCount} with a live relationship.` : "No stakeholders mapped yet."}</div>
            <div className="cov-grid">
              {stake.map((s: any, i: number) => { const cv = covOf(s); return (
                <div className={`cov ${cv.kind}`} key={i}><div className="nm">{s.name}</div><div className="role">{s.title || s.role || ""}</div><div className="stat">{cv.stat}</div></div>
              ); })}
            </div>
          </div>

          <div className="card card-pad mb14">
            <div className="ic-title" style={{ marginBottom: 14 }}>Stakeholders</div>
            {stake.map((s: any, i: number) => (
              <div className="sh" key={i}>
                <Monogram name={s.name || "?"} kind="person" size={32} />
                <div className="who">
                  <div className="nm">{s.name}</div>
                  <div className="role">{s.title || ""}</div>
                  <div className="pow"><span className="p">{s.role || ""}</span><span className={`sent ${sentClass(s.sentiment)}`}>{sentLabel(s.sentiment)}</span></div>
                </div>
                <div className="read">{s.risk || (String(s.sentiment || "").length > 24 ? s.sentiment : "")}</div>
              </div>
            ))}
            {!stake.length ? <div className="ic-body">No stakeholders mapped.</div> : null}
          </div>

          <div className="card card-pad mb14">
            <div className="ic-title" style={{ marginBottom: 13 }}>MEDDPICC scorecard</div>
            <div className="medd">
              {meddDims.filter(([, k]) => (medd as any)[k]).map(([label, k]) => {
                const st = String(((medd as any)[k] || {}).status || "").toLowerCase();
                const ok = st === "confirmed";
                return <div className={`med ${ok ? "ok" : "weak"}`} key={k}><div className="l">{label}</div><div className="s">{st ? cap(st) : "—"}</div></div>;
              })}
            </div>
          </div>

          <div className="card card-pad">
            <div className="ic-title" style={{ marginBottom: 6 }}>Open risks</div>
            {vulns.map((v: any, i: number) => (
              <div className="risk" key={i}><span className="dot" /><div className="txt"><b>{cap(v.category)}:</b> {v.detail}</div></div>
            ))}
            {!vulns.length ? <div className="ic-body">No open risks recorded.</div> : null}
          </div>
        </div>

      </div>
    </div>
  );
}
