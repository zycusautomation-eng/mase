"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Redesigned deal drawer ("Bandhan" layout). Rendered by DealDrawer in place of the
// shared DealDetailView, wired to the REAL deal record (rec). The /deals/[id] page
// keeps the original DealDetailView, so this is drawer-only and reversible.
// All CSS is scoped under .ddw so it can never collide with the app's global styles.
import { useMemo, useState } from "react";
import { fmtAmount, daysSince, healthLabel, verdictTone, clipWords, clipWordsClean, getEbOverride, sfLinkFor, type Rec } from "@/lib/engine/helpers";
import { useDealAi } from "@/components/deals/DealAiProvider";
import { Monogram } from "@/components/ui/Monogram";
import { useBackendTodos } from "@/lib/engine/useBackendTodos";
import { AddUpdateForm } from "@/components/deals/DealDetailView";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { useTodoSync } from "@/lib/engine/useTodoSync";
import { DealTodoBuckets, bucketsForOpp, displayedTodos } from "@/components/deals/DealTodos";
import { DealReasonsPanel } from "@/components/deals/DealScores";
import { useDashboard } from "@/lib/engine/DashboardContext";

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
.ddw .gate-head{display:flex;align-items:flex-start;gap:9px}
.ddw .gate-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--indigo)}
.ddw .gate-num.soft{background:rgba(255,255,255,.14)}
.ddw .gate-tag{font-size:11.5px;font-weight:700;letter-spacing:.1px;color:#b9b6f5;line-height:1.35}
.ddw .gate-tag.overdue{color:#ff9fb0;font-weight:800}
.ddw .gate-t{font-size:13.5px;font-weight:700;margin-top:9px;line-height:1.4}
.ddw .gate-d{font-size:11.5px;color:#c4c2ea;margin-top:6px;line-height:1.5}
.ddw .gate-more{margin-left:6px;border:none;background:none;color:#cbc7ff;font-size:11.5px;font-weight:700;cursor:pointer;padding:0;text-decoration:underline;white-space:nowrap}
.ddw .spof{margin-top:16px;background:rgba(210,59,84,.16);border:1px solid rgba(210,59,84,.45);border-radius:12px;padding:12px 14px;display:flex;gap:11px;align-items:flex-start;font-size:12px;color:#ffe3e8;line-height:1.55}
.ddw .spof b{color:#fff}
.ddw .ebok{margin-top:16px;background:rgba(31,157,87,.16);border:1px solid rgba(31,157,87,.45);border-radius:12px;padding:12px 14px;display:flex;gap:11px;align-items:flex-start;font-size:12px;color:#d6f3e2;line-height:1.55}
.ddw .ebok b{color:#fff}
.ddw .ebok .ebsrc{color:#9fd9bb}
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
.ddw .meter span.on{background:#9aa0b5}
.ddw .meter.aes-hungry span.on{background:#1aa06a}
.ddw .meter.aes-curious span.on{background:#7fd0a4}
.ddw .meter.aes-resist span.on{background:#e34b63}
.ddw .pill.aes-hungry{background:#cdeede;color:#0f7a52;border-color:transparent}
.ddw .pill.aes-curious{background:#eef9f2;color:#46916b;border-color:transparent}
.ddw .pill.aes-resist{background:var(--red-bg);color:var(--red-ink);border-color:transparent}
.ddw .foldmeta{font-size:12px;color:var(--ink-mute);margin:0 0 12px;display:flex;flex-wrap:wrap;gap:7px;align-items:baseline}
.ddw .foldmeta b{color:var(--ink);font-weight:700}
.ddw .scorestrip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.ddw .scell{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:13px 16px;box-shadow:var(--shadow-sm)}
.ddw .sk{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-faint);font-family:var(--mono)}
.ddw .sv{font-size:30px;font-weight:800;letter-spacing:-1px;margin-top:7px;line-height:1;color:var(--ink)}
.ddw .sv.b-g{color:var(--pos)} .ddw .sv.b-a{color:var(--over)} .ddw .sv.b-r{color:var(--crit)} .ddw .sv.b-n{color:var(--ink-mute)}
.ddw .sv .strend{font-size:12px;font-weight:700;color:var(--ink-faint);letter-spacing:0}
.ddw .sv.aistier{font-size:18px;letter-spacing:-.2px;padding-top:8px}
.ddw .sv.ais-hungry{color:#0f7a52} .ddw .sv.ais-curious{color:#46916b} .ddw .sv.ais-resist{color:var(--crit)} .ddw .sv.ais-none{color:var(--ink-mute)}
.ddw .sm{font-size:11.5px;color:var(--ink-faint);font-weight:600;margin-top:7px}
.ddw .whatmatters{padding:16px 18px;margin-bottom:14px}
.ddw .wm-h{font-size:13px;font-weight:800;color:var(--ink);margin-bottom:11px}
.ddw .wm-row{display:flex;gap:11px;padding:8px 0;border-top:1px solid var(--line-soft)}
.ddw .wm-row:first-of-type{border-top:none;padding-top:0}
.ddw .wm-lens{flex:0 0 118px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;font-family:var(--mono);padding-top:2px;line-height:1.4}
.ddw .wm-lens.t-pos{color:var(--pos)} .ddw .wm-lens.t-warn{color:var(--over)} .ddw .wm-lens.t-neu{color:var(--ink-mute)} .ddw .wm-lens.t-crit{color:var(--crit)}
.ddw .wm-text{flex:1;font-size:12.5px;color:var(--ink-soft);line-height:1.55}
.ddw .donow{background:var(--indigo-soft);border:1px solid #dcdcfb;border-radius:var(--radius);padding:15px 18px;margin-bottom:14px}
.ddw .donow-h{display:flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--indigo);font-family:var(--mono);margin-bottom:8px}
.ddw .donow-ic{margin-right:5px;font-size:13px}
.ddw .donow-ai{margin-left:auto;border:none;background:transparent;color:var(--indigo);font-weight:800;font-size:11px;letter-spacing:.3px;cursor:pointer;text-transform:none;font-family:inherit}
.ddw .donow-text{font-size:13.5px;color:var(--ink);line-height:1.5;font-weight:600}
.ddw .donow-foot{font-size:11.5px;color:var(--ink-soft);margin-top:10px;border-top:1px solid #e0e0f7;padding-top:9px}
.ddw .donow-foot b{color:var(--ink);font-weight:700}
.ddw .scopechip{display:inline-block;font-size:10.5px;font-weight:700;color:var(--ink-mute);background:var(--neu-bg);border-radius:6px;padding:2px 8px;margin-right:6px;letter-spacing:.2px}
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
.ddw .sk{background:linear-gradient(90deg,#ececf4 25%,#f6f6fb 37%,#ececf4 63%);background-size:400% 100%;animation:ddwsk 1.25s ease infinite;border-radius:7px;display:block}
@keyframes ddwsk{0%{background-position:100% 0}100%{background-position:-100% 0}}
.ddw .sk-grp{height:11px;width:160px;margin:6px 2px 10px}
.ddw .sk-row{display:flex;gap:13px;padding:14px 16px;border-top:1px solid var(--line-soft);align-items:flex-start}
.ddw .sk-row:first-child{border-top:none}
.ddw .sk-ck{width:19px;height:19px;border-radius:6px;flex:none}
.ddw .sk-body{flex:1;min-width:0}
.ddw .sk-hint{font-size:11.5px;color:var(--ink-faint);font-weight:600;margin:0 2px 8px;display:flex;align-items:center;gap:7px}
.ddw .sk-hint .dot{width:7px;height:7px;border-radius:50%;background:var(--indigo);animation:ddwpulse 1.1s ease infinite}
@keyframes ddwpulse{0%,100%{opacity:1}50%{opacity:.25}}
.ddw .donow-more{margin-left:6px;border:none;background:none;color:var(--indigo);font-size:11.5px;font-weight:800;cursor:pointer;padding:0;text-decoration:underline;white-space:nowrap;font-family:inherit}
.ddw .wm-more{margin-left:5px;border:none;background:none;color:var(--indigo);font-size:12px;font-weight:800;cursor:pointer;padding:0;text-decoration:underline;white-space:nowrap;font-family:inherit}
`;

const cap = (s: any) => { const t = String(s || ""); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
const sentClass = (s: any) => { const t = String(s || "").toLowerCase(); return /pos/.test(t) ? "pos" : /neg|unk|risk/.test(t) ? "unk" : "neu"; };
// Sentiment is sometimes a full sentence from the model — the pill must show only a
// short label (the long prose, if any, drops into the read column instead).
const sentLabel = (s: any) => { const t = String(s || "").toLowerCase(); return /pos/.test(t) ? "Positive" : /neg|risk|concern|unk/.test(t) ? "At risk" : t ? "Neutral" : "Unknown"; };
const fmtDate = (s: any) => { if (!s) return ""; const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
// A "by date" is past due once its calendar day is strictly before today (a date that
// falls on today is still on time). Compared on local date parts to ignore time-of-day.
const isPastDue = (s: any) => { if (!s) return false; const d = new Date(s); if (isNaN(d.getTime())) return false; const now = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); };
// One play gate. The action is truncated to 12 words by default (the user wants the
// short read); a "more" toggle reveals the full move + its expected effect on click.
function PlayGate({ m, i }: { m: any; i: number }) {
  const [open, setOpen] = useState(false);
  const full = String(m.action || "");
  const truncated = full.trim().split(/\s+/).filter(Boolean).length > 30;
  const overdue = isPastDue(m.act_by);
  return (
    <div className="gate">
      <div className="gate-head"><span className={`gate-num ${i > 1 ? "soft" : ""}`}>{i + 1}</span><span className={`gate-tag${overdue ? " overdue" : ""}`}>{m.act_by ? (overdue ? `Past due · ${fmtDate(m.act_by)}` : `by ${fmtDate(m.act_by)}`) : "next"}</span></div>
      <div className="gate-t">
        {open || !truncated ? full : clipWordsClean(full, 30)}
        {truncated ? <button type="button" className="gate-more" onClick={() => setOpen((o) => !o)}>{open ? "less" : "more"}</button> : null}
      </div>
      {open && m.expected_effect ? <div className="gate-d">{m.expected_effect}</div> : null}
    </div>
  );
}

// Inline "more / less" clamp — collapses long text to an N-word clean clip with a
// toggle to reveal the rest. Mirrors the PlayGate "more" affordance so everything in
// the drawer expands the same way. When the text already fits, it renders as-is.
function ClampMore({ text, words = 16, cls = "donow-more" }: { text: string; words?: number; cls?: string }) {
  const [open, setOpen] = useState(false);
  const full = String(text || "").trim();
  const truncated = full.split(/\s+/).filter(Boolean).length > words;
  if (!truncated) return <>{full}</>;
  return (
    <>
      {open ? full : clipWordsClean(full, words)}
      <button type="button" className={cls} onClick={() => setOpen((o) => !o)}>{open ? "less" : "more"}</button>
    </>
  );
}
// A short one-liner that says WHAT the move is — the leading clause of the action,
// cut at the first natural boundary (the buyer/date/connective), capped. Used as the
// gate header in place of the owner ("Deal team") label.

export default function DealDrawerView({ rec, onClose }: { rec: Rec; onClose?: () => void }) {
  const { openNewDeal } = useDealAi();
  const { canSeeScores } = useDashboard();
  const backend = useBackendTodos();
  const { done: doneSet, toggle } = useTodoDone();
  const sync = useTodoSync();
  const [tab, setTab] = useState<"action" | "intel" | "people" | "reasons">("action");

  const h = rec.hard || {}, ai = rec.ai || {}, pulse = rec.pulse || {};
  const nsv = ai.north_star_verdict || {};
  const verdict = healthLabel(nsv.verdict);
  // Negative tone = amber/red (Slowing or Off Track). On Track + Close-date risk
  // are POSITIVE (green / light green), so they must NOT read as risk.
  const vRisk = ((t) => t === "v-slow" || t === "v-off")(verdictTone(nsv.verdict));
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
  // EB visibility override: if the buyer is recorded in MEDDPICC (held in helpers), the
  // sweep's "economic buyer gap" is a false visibility alert — clear it and show the name.
  const ebName = getEbOverride(rec.opp_id);
  const ebGap = ebName ? false : (medd.economic_buyer || {}).status === "gap";
  const champ = ai.champion_strength || {};
  const spof = ebGap
    ? `Economic Buyer unmapped. ${(medd.economic_buyer || {}).status === "gap" ? "Never confirmed in Salesforce contact roles or on a call." : ""} Every critical item routes through getting them engaged.`
    : champ.at_risk
      ? `Champion ${champ.champion || ""} is single-threaded / developing — no confirmed executive multi-thread.`
      : "";

  // ---- Main blocker ---- (skip the economic-buyer gap when the EB is known)
  const blockerKey = ["economic_buyer", "paper_process", "metrics", "champion", "decision_process"]
    .find((k) => !(k === "economic_buyer" && ebName) && ((medd as any)[k] || {}).status === "gap");
  const blockerLabel = blockerKey
    ? ({ economic_buyer: "Economic Buyer", paper_process: "Paper / Legal", metrics: "Metrics", champion: "Champion", decision_process: "Decision Process" } as any)[blockerKey]
    : ((ai.vulnerabilities || {}).items || [])[0]?.category ? cap(((ai.vulnerabilities || {}).items || [])[0].category) : "—";

  // ---- Action items: sourced from the backend to-do book so each row carries its
  // todo_key + pushed state — that's what makes the per-row "push to Salesforce"
  // work (same items, same keys, same push as the old drawer + Espresso). ----
  // Build the to-do buckets from the backend /todo book, then ensure EVERY one of the
  // deal's recommended moves is present (they fold into "Commitments made by Zycus").
  // The backend only surfaces moves as to-dos on forecast-critical deals; for every
  // other deal we inject them straight from the record (the same source as "The Play")
  // so all moves are always visible. Deduped by action text, so once the backend
  // surfaces them (after the gate change ships) there is no double-up; the injected
  // ones are flagged `pending` (visible, but push/edit unlock on the next sweep).
  const todoBuckets = useMemo(() => {
    const base: any[] = bucketsForOpp(backend.flat, rec.opp_id);
    const recMoves = (((rec.ai || {}).recommended_moves || {}).items || []) as any[];
    if (!recMoves.length) return base;
    const norm = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const crit = base.find((b) => b.category === "critical");
    const have = new Set((crit?.items || []).map((it: any) => norm(it.text || it.action)));
    const oid15 = String(rec.opp_id || "").slice(0, 15);
    const extra = recMoves
      .slice()
      .sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .filter((m) => m.action && !have.has(norm(m.action)))
      .map((m, i) => ({
        category: "critical", text: m.action, action: m.action,
        todoKey: `pending:${oid15}:mv${i}`, pending: true, opp_id: rec.opp_id,
        act_by: m.act_by, trigger_date: m.trigger_date, urgency: m.urgency,
        horizon: m.horizon, expected_effect: m.expected_effect, intervention_owner: m.owner,
      }));
    if (!extra.length) return base;
    if (crit) return base.map((b) => b.category === "critical" ? { ...b, items: [...b.items, ...extra] } : b);
    return [{ category: "critical", items: extra }, ...base];
  }, [backend.flat, rec]);
  // Count the to-dos ACTUALLY rendered below. buildActionBuckets clubs / de-dupes /
  // caps the raw backend list, so the counter must count that SAME reduced set — else
  // "done/total" won't match the rows on screen (the 0/41-vs-actual mismatch).
  const shownTodos = displayedTodos(todoBuckets, backend);
  const total = shownTodos.length;
  const done = shownTodos.filter((it: any) => backend.isPushed(it) || doneSet.has(it.todoKey)).length;

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
  // Open risks: for a known-EB deal, drop any risk that's about the EB being *unknown*
  // (a visibility false-positive) — but KEEP engagement risks ("not engaged", "single-
  // threaded"), since whether the buyer is engaged is a real, separate question.
  const EB_VISIBILITY_RE = /(economic buyer|decision[\s-]?maker)[^.]*\b(not identified|unidentified|unmapped|un-?mapped|unconfirmed|not confirmed|unknown|missing|tbd)\b|no access to (the )?(economic buyer|power)/i;
  const vulns = (((ai.vulnerabilities || {}).items || []) as any[])
    .filter((v) => !(ebName && EB_VISIBILITY_RE.test(`${v.category || ""} ${v.detail || ""}`)));

  const dealForAi = { oid: rec.opp_id, accountName: h.account_name || rec.opp_id, oppName: h.opp_name, ownerName: h.owner_name };

  // ===== Hybrid fold (v1) — all derived from already-swept fields =====
  const ds = (ai.deal_scores || {}).headline || {};
  const fmtScore = (v: any) => (v == null || isNaN(Number(v)) ? "—" : Math.round(Number(v)));
  const scoreBand = (v: any) => (v == null || isNaN(Number(v)) ? "n" : Number(v) >= 70 ? "g" : Number(v) >= 45 ? "a" : "r");
  const aisTierRaw = String((ai.ai_fit_signal || {}).tier || "").trim();
  const aisKey = /hungry/i.test(aisTierRaw) ? "hungry" : /resist|cold|low/i.test(aisTierRaw) ? "resist" : aisTierRaw ? "curious" : "none";

  // "What matters" — first 4 lenses with content (competition / EB / champion / value / motion).
  const eb = stake.find((s: any) => /economic buyer|^eb$/i.test(String(s.role || ""))) || null;
  const lastMove = ((ai.deal_movement || {}).items || []).slice(-1)[0];
  const bc = ai.business_case || {};
  // CRO-clean: drop tactical "CRM / Salesforce / field / this sweep / Avoma" sentences.
  const cro = (s: string) => {
    const tactical = /(\bcrm\b|salesforce|\bfield\b|this sweep|\bsweep\b|per avoma|\bavoma\b|next[- ]step|ais field|no ais)/i;
    const parts = String(s || "").match(/[^.!?]+[.!?]*/g) || [String(s || "")];
    const kept = parts.filter((x) => x.trim() && !tactical.test(x)).join(" ").replace(/\s+/g, " ").trim();
    return kept || String(s || "");
  };
  // Keep the FULL cleaned text — the What-matters rows clamp it at render with a
  // more/less toggle (ClampMore), so the reader can expand any signal in place.
  const sig = (lens: string, text: any, tone = "neu") => ({ lens, text: cro(String(text || "")), tone });
  const champName = String(champ.champion || "");
  const ebName2 = String((eb || {}).name || "");
  const sameName = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a) || a.split(" ")[0].toLowerCase() === b.split(" ")[0].toLowerCase());
  const topMove = (gates[0] || {}) as any;
  // Latest motion = the decisive live event (the top move's trigger / verdict math), NOT
  // Salesforce field churn (amount/stage/forecast moves are visible to everyone).
  const motionText = topMove.trigger || nsv.math || (lastMove || {}).change || "";
  // Product scope → grouped module chips (keeps the header uncrowded).
  const PROD_GROUP: [RegExp, string][] = [
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
  const prodGroups: string[] = [];
  String(((ai.product_scope || {}) as any).scope || "").split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((t) => {
    const m = PROD_GROUP.find(([re]) => re.test(t));
    const g = m ? m[1] : t;
    if (g && !prodGroups.includes(g)) prodGroups.push(g);
  });
  // Prefer the backend's structured `critical_signals` (CRO-written) when present; else derive.
  const structured = Array.isArray((ai as any).critical_signals)
    ? (ai as any).critical_signals.map((c: any) => ({ lens: c.lens || c.label || "Signal", text: cro(String(c.text || c.summary || "")), tone: c.tone || "neu" })).filter((c: any) => c.text)
    : null;
  const derivedSignals = ([
    (ai.competitive_position || {}).summary ? sig("Competition", (ai.competitive_position || {}).summary, "warn") : null,
    eb ? sig("Economic buyer", `${ebName2 || "EB"}${eb.title ? ` (${eb.title})` : ""} — our relationship: ${eb.sentiment || eb.risk || "unmapped"}`, eb.risk ? "warn" : "pos") : null,
    (champName && !sameName(champName, ebName2)) ? sig("Champion", `${champName} — ${champ.strength || "developing"} relationship${champ.at_risk ? ", at risk" : ""}`, champ.at_risk ? "warn" : "pos") : null,
    (bc.evidence || bc.status) ? sig("Commercials / value", `Value case ${bc.status || ""}${bc.evidence ? ` — ${bc.evidence}` : ""}`, bc.status === "strong" ? "pos" : "warn") : null,
    motionText ? sig("Latest motion", motionText, "warn") : null,
  ].filter(Boolean) as any[]);
  const signals = (structured && structured.length ? structured : derivedSignals).slice(0, 4);
  const doNow = (gates[0] || null) as any;

  const isLate = /vendor selected|negotiat|contract|signed|po received|closing/i.test(String(h.stage || ""));

  return (
    <div className="ddw">
      <style>{CSS}</style>

      <div className="dh">
        <div className="dh-top">
          <div className="crumb" onClick={onClose}><span className="chev">‹</span> Deals <span className="sep">/</span> <span className="cur">{h.account_name || rec.opp_id}</span></div>
          <div className="dh-actions">
            {analysed ? <span className="analysed" title={`Last analysed ${rec.swept_at}`}>✦ Analysed {analysed.label}{analysed.rel ? ` · ${analysed.rel}` : ""}</span> : null}
            {(() => { const sf = sfLinkFor(h, rec.opp_id); return sf ? <a className="btn" href={sf} target="_blank" rel="noreferrer">Salesforce ↗</a> : null; })()}
            <button className="btn ai" onClick={() => openNewDeal(dealForAi)}>✦ Ask AI</button>
            <div className="iconbtn" onClick={onClose}>✕</div>
          </div>
        </div>
        <div className="dh-deal">
          <Monogram name={h.account_name || rec.opp_id} kind="account" size={46} style={{ borderRadius: 13 }} />
          <div>
            <div className="dh-name">
              <span className="t">{h.account_name || rec.opp_id}</span>
              {h.stage ? <span className="pill stage">{h.stage}</span> : null}
            </div>
            <div className="dh-sub">{prodGroups.length ? prodGroups.map((g, i) => <span className="scopechip" key={i}>{g}</span>) : (h.opp_name || "")}</div>
          </div>
        </div>
      </div>

      <div className="body">
        {/* META LINE — value · close · ONE honest recency number (fixes the -26d/1d bug) */}
        <div className="foldmeta">
          <span><b>{fmtAmount(h.amount)}</b></span>
          {h.owner_name ? <span>· {h.owner_name}</span> : null}
          {h.close_date ? <span>· closes {fmtDate(h.close_date)}{pulse.days_to_close != null ? ` · ${pulse.days_to_close}d to close` : ""}</span> : null}
          {lastAct != null ? <span>· last activity {Math.abs(lastAct)}d ago</span> : null}
          <span>· Forecast <b style={{ color: nsv.forecast_defensible === false ? "var(--over)" : "var(--ink)" }}>{nsv.recommended_forecast || h.forecast_category || "—"}</b>{nsv.forecast_defensible === false ? " · not yet earned" : ""}</span>
        </div>

        {/* SCORE STRIP — the two engine scores + AI excitement */}
        <div className="scorestrip">
          <div className="scell">
            <div className="sk">Zycus win position</div>
            <div className={`sv b-${canSeeScores ? scoreBand(ds.win_position) : "n"}`}>{canSeeScores ? fmtScore(ds.win_position) : "—"}</div>
            <div className="sm">can we win it</div>
          </div>
          <div className="scell">
            <div className="sk">Deal momentum</div>
            <div className={`sv b-${canSeeScores ? scoreBand(ds.deal_momentum) : "n"}`}>{canSeeScores ? fmtScore(ds.deal_momentum) : "—"}{canSeeScores && nsv.trajectory && nsv.trajectory !== "new" ? <span className="strend"> {nsv.trajectory}</span> : null}</div>
            <div className="sm">is it moving</div>
          </div>
          <div className="scell">
            <div className="sk">AI excitement</div>
            <div className={`sv aistier ais-${aisKey}`}>{aisTierRaw || "—"}</div>
            <div className="sm">AI appetite</div>
          </div>
        </div>

        {/* WHAT MATTERS — top signals across the lenses */}
        {signals.length ? (
          <div className="card whatmatters">
            <div className="wm-h">⚠ What matters on this deal</div>
            {signals.map((s: any, i: number) => (
              <div className="wm-row" key={i}>
                <span className={`wm-lens t-${s.tone}`}>{s.lens}</span>
                <span className="wm-text"><ClampMore text={s.text} words={30} cls="wm-more" /></span>
              </div>
            ))}
          </div>
        ) : null}

        {/* DO NOW — the single highest-leverage next move (path-to-win detail lives in the Action tab) */}
        {doNow ? (
          <div className="donow">
            <div className="donow-h"><span className="donow-ic">▷</span> Do now{doNow.act_by ? ` · by ${fmtDate(doNow.act_by)}` : ""}<button className="donow-ai" onClick={() => openNewDeal(dealForAi)}>Work this with AI →</button></div>
            <div className="donow-text">{clipWords(String(doNow.action || ""), 34)}</div>
            {spof ? <div className="donow-foot"><b>⚠ Single point of failure.</b> <ClampMore text={spof} words={16} /></div>
              : ebName ? <div className="donow-foot"><b>✓ Economic buyer:</b> {ebName} · confirmed in MEDDPICC</div> : null}
          </div>
        ) : null}

        {/* SECTION NAV */}
        <div className="nav">
          <div className={`nav-item ${tab === "action" ? "active" : ""}`} onClick={() => setTab("action")}>Action Plan <span className="nav-cnt">{done}/{total}</span></div>
          <div className={`nav-item ${tab === "intel" ? "active" : ""}`} onClick={() => setTab("intel")}>Deal Intelligence</div>
          <div className={`nav-item ${tab === "people" ? "active" : ""}`} onClick={() => setTab("people")}>Stakeholders &amp; Risk {liveCount < stake.length ? <span className="nav-dot" /> : null}</div>
          {canSeeScores && ai.deal_scores ? (
            <div className={`nav-item ${tab === "reasons" ? "active" : ""}`} onClick={() => setTab("reasons")}>Scores &amp; Reasons</div>
          ) : null}
        </div>

        {/* ===== ACTION ===== */}
        <div className={`tab ${tab === "action" ? "active" : ""}`}>
          <div className="card card-pad mb14">
            <div className="ic-title" style={{ marginBottom: 4 }}>☁ Log to Salesforce</div>
            <div className="ic-body" style={{ color: "var(--ink-faint)", marginBottom: 2 }}>Write a completed task, an open to-do, or a Next Step straight to this opportunity in Salesforce.</div>
            <AddUpdateForm oppId={rec.opp_id} backend={backend} />
          </div>

          {/* Moves (Commitments made by Zycus) come from the record and render instantly;
              the other buckets come from the /todo fetch. While that's loading, show a
              skeleton BELOW the moves so it's clear the rest is still arriving. */}
          <DealTodoBuckets buckets={todoBuckets} ownerName={h.owner_name} done={doneSet} toggle={toggle} sync={sync} backend={backend} />
          {backend.loading ? (
            <div className="card sk-card" style={{ overflow: "hidden", marginTop: 12, padding: "12px 6px 10px" }}>
              <div className="sk-hint"><span className="dot" />Loading the rest of this deal&apos;s to-dos…</div>
              {[0, 1].map((g) => (
                <div key={g} style={{ marginTop: g ? 14 : 4 }}>
                  <div className="sk sk-grp" />
                  {[0, 1].map((i) => (
                    <div className="sk-row" key={i}>
                      <span className="sk sk-ck" />
                      <div className="sk-body">
                        <div className="sk" style={{ height: 12, width: `${74 - i * 12}%`, marginBottom: 8 }} />
                        <div className="sk" style={{ height: 10, width: `${50 - i * 8}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (!todoBuckets.length ? <div className="card card-pad ic-body" style={{ marginTop: 12 }}>No open to-dos on this deal yet.</div> : null)}
        </div>

        {/* ===== INTEL ===== */}
        <div className={`tab ${tab === "intel" ? "active" : ""}`}>
          <div className="card card-pad mb14">
            {(() => {
              // Only the MASE-sweep AI read — no stale Salesforce AIS status/score badges.
              const tierRaw = String((ai.ai_fit_signal || {}).tier || "").trim();
              const t = tierRaw.toLowerCase();
              const key = /hungry/.test(t) ? "hungry"
                : /curious|moderate|warm/.test(t) ? "curious"
                : /resist|cold|low/.test(t) ? "resist"
                : "curious";
              const score = key === "hungry" ? 8 : key === "resist" ? 2 : 5;
              // CRO-readable: strip tactical "no AIS field / per Avoma / based on call evidence" scaffolding.
              const cleanAes = (s: string) => {
                if (!s) return "";
                const tactical = /(ais field|\bais\b|no ais|field value|this sweep|\bsweep\b|based on call evidence|call evidence|treat as ai|per avoma|\bavoma\b|salesforce|next[- ]step)/i;
                const parts = String(s).match(/[^.!?]+[.!?]*/g) || [String(s)];
                return parts.filter((x) => x.trim() && !tactical.test(x)).join(" ").replace(/\s+/g, " ").trim();
              };
              const body = cleanAes((ai.ai_fit_signal || {}).summary || "");
              return (<>
                <div className="ic-title">AI Excitement Score (AES)
                  {tierRaw ? <span className={`pill aes-${key}`} style={{ marginLeft: 8 }}>{tierRaw}</span> : null}
                </div>
                <div className={`meter aes-${key}`}>{Array.from({ length: 10 }).map((_, i) => <span key={i} className={i < score ? "on" : ""} />)}</div>
                <div className="ic-body">{body || "No clear AI-appetite signal from buyer conversations yet."}</div>
              </>);
            })()}
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
              {meddDims.filter(([, k]) => (medd as any)[k] || (k === "economic_buyer" && ebName)).map(([label, k]) => {
                const ebRow = k === "economic_buyer" && !!ebName;
                const st = ebRow ? "confirmed" : String(((medd as any)[k] || {}).status || "").toLowerCase();
                const ok = st === "confirmed";
                return <div className={`med ${ok ? "ok" : "weak"}`} key={k} title={ebRow ? `Economic buyer: ${ebName}` : undefined}><div className="l">{label}</div><div className="s">{st ? cap(st) : "—"}</div></div>;
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

        {/* ===== SCORES & REASONS ===== */}
        {canSeeScores && ai.deal_scores ? (
          <div className={`tab ${tab === "reasons" ? "active" : ""}`}>
            <div className="card card-pad mb14">
              <div className="ic-title" style={{ marginBottom: 6 }}>Scores &amp; reasons</div>
              <div className="ic-body" style={{ color: "var(--ink-faint)", marginBottom: 10 }}>A plain-English read on each score, the honest downside, and what moves the deal — grounded in the latest Salesforce and call evidence.</div>
              <DealReasonsPanel ds={ai.deal_scores} />
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}
