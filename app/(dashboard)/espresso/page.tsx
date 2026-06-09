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
    <div id="todoview">
      <div className="todo-top">
        <div className="ttl">Action plan for <b>{who}</b>, by forecast tier. Forecast deals get a full plan with back-planned dates; qualified pipeline is lighter and optional. Initial-interest deals are excluded.</div>
        <div className="todo-prog">{doneCount} of {total} done</div>
      </div>

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
                <DealBlock key={`${b.oid}-${i}`} b={b} done={done} toggle={toggle} sync={sync} backend={backend} showVp={vps.length !== 1} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DealBlock({ b, done, toggle, sync, backend, showVp }: { b: DealBlockData; done: Set<string>; toggle: (id: string) => void; sync: TodoSync; backend: Backend; showVp: boolean }) {
  const { h } = b;
  const vpMeta = showVp && OWNER_VP[b.ownerName] ? ` (${OWNER_VP[b.ownerName]})` : "";
  return (
    <div className="deal-blk">
      <div className="deal-h"><span className="nm">{b.accountName}</span><span className="amt">{fmtAmount(h.amount)}</span></div>
      <div className="deal-sub">{b.oppName} · {b.ownerName}{vpMeta} · {h.stage || ""}{h.close_date ? ` · close ${h.close_date}` : ""}{h.forecast_category ? ` · ${h.forecast_category}` : ""}</div>
      <DealTodoBuckets buckets={b.buckets} ownerName={b.ownerName} done={done} toggle={toggle} sync={sync} backend={backend} />
    </div>
  );
}
