"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { TIERS, fmtAmount, dealTier, isStalled, OWNER_VP, type Rec } from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { useTodoSync } from "@/lib/engine/useTodoSync";
import {
  useBackendTodos,
  CATEGORY_ORDER,
  type BackendCategory,
  type BackendTodoItem,
} from "@/lib/engine/useBackendTodos";
import { DealTodoBuckets, sfKey, type TodoSync, type Backend } from "@/components/deals/DealTodos";
import { type DealForAgent } from "@/components/deals/DealAgentPanel";
import { Monogram } from "@/components/ui/Monogram";
import { useDealAi } from "@/components/deals/DealAiProvider";

interface DealBlockData {
  oid: string;
  rec: Rec | undefined;
  h: any;
  accountName: string;
  oppName: string;
  ownerName: string;
  tierKey: string;
  buckets: { category: BackendCategory; items: BackendTodoItem[] }[];
}

export default function EspressoPage() {
  const { records, vps, rsds, filtered } = useDashboard();
  const { done, toggle } = useTodoDone();
  const sync = useTodoSync();
  const backend = useBackendTodos();
  const [activeTier, setActiveTier] = useState<string | null>(null);
  // A single page-level deal AI panel. Deal cards (✦ AI) open a NEW conversation;
  // the DealChatsDock opens an existing/running one. Lifting it here (instead of
  // per-card) lets the global message dock drive it.
  const { openNewDeal } = useDealAi();

  const who = rsds.length ? rsds.join(", ")
    : vps.length === 1 ? `${vps[0]}'s team`
    : vps.length ? vps.join(" & ")
    : "all VPs";

  // Opp-record lookup by 15-char opp_id prefix (for header fields + tier).
  const recByKey = useMemo(() => {
    const m = new Map<string, Rec>();
    for (const r of records) m.set(sfKey(r.opp_id), r);
    return m;
  }, [records]);

  // Scope set: only deals whose opp is in `filtered` (VP/RSD/filter-scoped),
  // matched by 15-char opp_id prefix.
  const scopeKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of filtered) s.add(sfKey(r.opp_id));
    return s;
  }, [filtered]);

  // Group all backend to-do items by opp_id into deal blocks, assign each deal a
  // forecast tier from its opp record, and drop deals out of scope or with no
  // matching tier (consistent with today — no "Other" bucket).
  const tiers = useMemo(() => {
    // opp_id (15-char key) -> per-category items
    const byOpp = new Map<string, { oid: string; cats: Record<BackendCategory, BackendTodoItem[]> }>();
    for (const item of backend.flat) {
      const key = sfKey(item.opp_id);
      if (!key) continue;
      if (!scopeKeys.has(key)) continue; // respect VP/RSD/filter scope
      let entry = byOpp.get(key);
      if (!entry) {
        entry = {
          oid: String(item.opp_id || ""),
          cats: { critical: [], important: [], explicitRequirements: [], implicit: [], bestPractice: [] },
        };
        byOpp.set(key, entry);
      }
      entry.cats[item.category].push(item);
    }

    // Build deal blocks, tag each with its tier (dropping ones with no tier).
    const blocks: DealBlockData[] = [];
    for (const [key, entry] of byOpp) {
      const rec = recByKey.get(key);
      const h = rec?.hard || {};
      const tier = rec ? dealTier(h) : null;
      if (!tier) continue; // no matching opp record OR not in a forecast tier -> drop
      if (isStalled(h)) continue; // stalled deals belong to Matcha — keep Espresso/Matcha disjoint
      const first = entry.cats.critical[0] || entry.cats.important[0]
        || entry.cats.explicitRequirements[0] || entry.cats.implicit[0] || entry.cats.bestPractice[0];
      const buckets = CATEGORY_ORDER
        .map((category) => ({ category, items: entry.cats[category] }))
        .filter((b) => b.items.length > 0);
      blocks.push({
        oid: entry.oid,
        rec,
        h,
        accountName: h.account_name || first?.account_name || h.opp_name || entry.oid,
        oppName: h.opp_name || first?.opp_name || "",
        ownerName: h.owner_name || first?.owner_name || "",
        tierKey: tier.key,
        buckets,
      });
    }

    // Group blocks by tier in TIERS order; sort each tier by amount desc.
    return TIERS.map((tier) => {
      const tierBlocks = blocks
        .filter((b) => b.tierKey === tier.key)
        .sort((a, b) => (Number(b.h.amount) || 0) - (Number(a.h.amount) || 0));
      if (!tierBlocks.length) return null;
      return { tier, blocks: tierBlocks };
    }).filter(Boolean) as { tier: (typeof TIERS)[number]; blocks: DealBlockData[] }[];
  }, [backend.flat, scopeKeys, recByKey]);

  // done/total across every row, keyed by todo_key. Pushed rows count as done.
  const { total, doneCount } = useMemo(() => {
    let t = 0, d = 0;
    for (const tg of tiers) for (const b of tg.blocks) for (const bk of b.buckets) for (const it of bk.items) {
      t++;
      if (backend.isPushed(it) || done.has(it.todoKey)) d++;
    }
    return { total: t, doneCount: d };
  }, [tiers, done, backend]);

  if (backend.loading && !backend.flat.length) return <div className="empty-s">Loading to-dos…</div>;
  if (backend.error && !backend.flat.length) return <div className="empty-s">Couldn&apos;t load to-dos. {backend.error}</div>;
  if (!records.length) return <div className="empty-s">No swept records yet.</div>;

  const tabKeys = tiers.map((t) => t.tier.key);
  const active = activeTier && tabKeys.includes(activeTier) ? activeTier : (tabKeys[0] || null);
  const shown = tiers.find((t) => t.tier.key === active);
  const shortLabel = (label: string) => label.split(" —")[0];

  return (
    <>
    <div id="todoview">
      <div className="todo-top">
        <div className="ttl">Action plan for <b>{who}</b>, by forecast tier. Forecast deals get a full plan with back-planned dates; qualified pipeline is lighter and optional. Initial-interest deals are excluded.</div>
        <div className="todo-prog">{doneCount} of {total} done</div>
      </div>

      {tiers.length > 0 ? <EspressoSummary tiers={tiers} doneCount={doneCount} total={total} /> : null}

      {tiers.length === 0 ? (
        <div className="empty-s">No forecast or qualified-pipeline deals in scope yet.</div>
      ) : (
        <>
          <div className="tiertabs-bar">
            <div className="tabs tiertabs">
              {tiers.map((tg) => (
                <button
                  key={tg.tier.key}
                  className={`tab ${active === tg.tier.key ? "active" : ""}`}
                  onClick={() => setActiveTier(tg.tier.key)}
                >
                  {shortLabel(tg.tier.label)} <span className="tcount">{tg.blocks.length}</span>
                </button>
              ))}
            </div>
          </div>

          {shown ? (
            <div className={`tier ${shown.tier.key}`}>
              {shown.blocks.map((b, i) => (
                <DealBlock key={`${b.oid}-${i}`} b={b} done={done} toggle={toggle} sync={sync} backend={backend} showVp={vps.length !== 1} onOpenAi={openNewDeal} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
    </>
  );
}

function DealBlock({ b, done, toggle, sync, backend, showVp, onOpenAi }: { b: DealBlockData; done: Set<string>; toggle: (id: string) => void; sync: TodoSync; backend: Backend; showVp: boolean; onOpenAi: (deal: DealForAgent) => void }) {
  const { h } = b;
  const { isAdminView } = useDashboard();
  const [collapsed, setCollapsed] = useState(true); // accordions closed by default
  const vpMeta = showVp && OWNER_VP[b.ownerName] ? ` (${OWNER_VP[b.ownerName]})` : "";
  const todoTotal = b.buckets.reduce((n, bk) => n + bk.items.length, 0);
  const critCount = b.buckets.find((bk) => bk.category === "critical")?.items.length || 0;
  return (
    <div className="deal-blk">
      {/* Header is a collapse toggle (each deal card folds independently). */}
      <div className="deal-h" onClick={() => setCollapsed((c) => !c)} style={{ cursor: "pointer", alignItems: "center" }}>
        <div className="deal-hrow">
          <span className="chev" aria-hidden style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
          <Monogram name={b.accountName} kind="account" size={34} />
          <span className="nmwrap">
            <span className="nm2">{b.accountName}</span>
            <span className="sub2">{b.oppName}</span>
          </span>
        </div>
        <div className="deal-hmeta">
          {collapsed ? (
            <>
              {b.ownerName ? <span className="dmeta">{b.ownerName}{vpMeta}</span> : null}
              {h.stage ? <span className="dchip">{h.stage}</span> : null}
              {h.close_date ? <span className="dmeta">close {h.close_date}</span> : null}
              {todoTotal ? <span className="dchip todo">{todoTotal} to-do{todoTotal !== 1 ? "s" : ""}</span> : null}
              {critCount ? <span className="dchip crit">{critCount} critical</span> : null}
            </>
          ) : null}
        </div>
        <span className="deal-hright">
          <span className="amt">{fmtAmount(h.amount)}</span>
          {isAdminView ? (
            <button type="button" className="deal-ai-btn" onClick={(e) => { e.stopPropagation(); onOpenAi({ oid: b.oid, accountName: b.accountName, oppName: b.oppName, ownerName: b.ownerName }); }} title="Complete this deal's tasks with AI" aria-label="Complete this deal's tasks with AI">✦ AI</button>
          ) : null}
        </span>
      </div>
      {!collapsed ? (
        <>
          <div className="deal-sub">{b.ownerName}{vpMeta} · {h.stage || ""}{h.close_date ? ` · close ${h.close_date}` : ""}{h.forecast_category ? ` · ${h.forecast_category}` : ""}</div>
          <DealTodoBuckets buckets={b.buckets} ownerName={b.ownerName} done={done} toggle={toggle} sync={sync} backend={backend} />
        </>
      ) : null}
    </div>
  );
}

// Summary strip: a "done" donut + due-window counts (Critical = overdue/today,
// High = next 7d, Medium = next 14d, Low = next 30d) computed across ALL in-scope
// to-dos (every tier), not just the active tab. Purely derived; no new data.
function EspressoSummary({ tiers, doneCount, total }: { tiers: { tier: (typeof TIERS)[number]; blocks: DealBlockData[] }[]; doneCount: number; total: number }) {
  const counts = useMemo(() => {
    const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00");
    let crit = 0, high = 0, med = 0, low = 0;
    for (const tg of tiers) for (const b of tg.blocks) for (const bk of b.buckets) for (const it of bk.items) {
      const eff = (it.act_by || it.due) as string | undefined;
      const t = eff ? Date.parse(eff + "T00:00:00") : NaN;
      if (isNaN(t)) { if (it.category === "critical") crit++; continue; }
      const d = Math.round((t - today) / 86400000);
      if (d <= 0) crit++; else if (d <= 7) high++; else if (d <= 14) med++; else low++;
    }
    return { crit, high, med, low };
  }, [tiers]);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  return (
    <div className="esp-summary">
      <div className="esp-stat done">
        <div className="esp-donut" style={{ "--p": pct } as any}><span className="pct">{pct}%</span></div>
        <div className="esp-stat-txt">
          <div className="big">{doneCount} of {total}</div>
          <div className="sub">to-dos done</div>
        </div>
      </div>
      <Stat cls="crit" n={counts.crit} lab="Critical" sub="Overdue or due today" icon="flag" />
      <Stat cls="high" n={counts.high} lab="High" sub="Due in next 7 days" icon="clock" />
      <Stat cls="med" n={counts.med} lab="Medium" sub="Due in next 14 days" icon="cal" />
      <Stat cls="low" n={counts.low} lab="Low" sub="Due in next 30 days" icon="check" />
    </div>
  );
}

function Stat({ cls, n, lab, sub, icon }: { cls: string; n: number; lab: string; sub: string; icon: "flag" | "clock" | "cal" | "check" }) {
  return (
    <div className={`esp-stat ${cls}`}>
      <span className="ic"><StatIcon icon={icon} /></span>
      <div className="esp-stat-txt">
        <div className="big">{n} <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{lab}</span></div>
        <div className="sub">{sub}</div>
      </div>
    </div>
  );
}

function StatIcon({ icon }: { icon: "flag" | "clock" | "cal" | "check" }) {
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (icon === "flag") return <svg {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
  if (icon === "clock") return <svg {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
  if (icon === "cal") return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
  return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
}
