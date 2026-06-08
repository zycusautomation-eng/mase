"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { TIERS, fmtAmount, ownerKind, dealTier, OWNER_VP, type Rec } from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { useTodoSync, type SyncStatus } from "@/lib/engine/useTodoSync";
import {
  useBackendTodos,
  CATEGORY_ORDER,
  type BackendCategory,
  type BackendTodoItem,
} from "@/lib/engine/useBackendTodos";

// Per-category label + tone (reusing the existing .todo-grp tone classes).
const CATEGORY_META: Record<BackendCategory, { label: string; tone: string }> = {
  critical: { label: "Critical / next moves", tone: "moves" },
  important: { label: "Commitments", tone: "impt" },
  explicitRequirements: { label: "Open requirements", tone: "impt" },
  implicit: { label: "Implicit / promised", tone: "impl" },
  bestPractice: { label: "Best practice", tone: "bpr" },
};

// First 15 chars of a SF id — opp_ids come in 15- and 18-char forms; compare on
// the shared prefix so scope matching and opp-record lookup are robust.
const sfKey = (id: any): string => String(id || "").slice(0, 15);

type TodoSync = ReturnType<typeof useTodoSync>;
type Backend = ReturnType<typeof useBackendTodos>;

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
      {b.buckets.map((bk) => {
        const meta = CATEGORY_META[bk.category];
        return (
          <div key={bk.category}>
            <div className={`todo-grp ${meta.tone}`}>{meta.label} <span className="c">{bk.items.length}</span></div>
            <ul className="todo-list">
              {bk.items.map((it, idx) => {
                const serverPushed = backend.isPushed(it);
                const isDone = serverPushed || done.has(it.todoKey);
                return (
                  <li className={`todo-item ${isDone ? "done" : ""}`} key={`${it.todoKey || it.text}-${idx}`}>
                    <input type="checkbox" checked={isDone} disabled={serverPushed} onChange={() => toggle(it.todoKey)} />
                    <div className="td-body">
                      <div className="td-txt">{it.text}</div>
                      <ContextMeta it={it} />
                    </div>
                    <SfButton it={it} ownerName={b.ownerName} enabled={done.has(it.todoKey)} sync={sync} backend={backend} serverPushed={serverPushed} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Small context chips per category. Owner-ish fields render as ownerchip; date-ish
// fields render as duechip; said_by renders as "asked by X".
function ContextMeta({ it }: { it: BackendTodoItem }) {
  const owner = (it.intervention_owner || it.who) as string | undefined;
  const due = (it.due || it.act_by || it.trigger_date || it.date) as string | undefined;
  const askedBy = it.said_by as string | undefined;
  const trigger = it.trigger as string | undefined;
  const urgency = it.urgency as string | undefined;
  const status = it.status as string | undefined;
  const hasAny = owner || due || askedBy || trigger || urgency || status;
  if (!hasAny) return null;
  return (
    <div className="td-meta">
      {owner ? <span className={`ownerchip ${ownerKind(owner) === "VP" ? "vp" : ""}`}>{owner}</span> : null}
      {askedBy ? <span className="ownerchip">asked by {askedBy}</span> : null}
      {due ? <span className="duechip">{due}</span> : null}
      {trigger ? <span className="ownerchip">{trigger}</span> : null}
      {urgency ? <span className="ownerchip">{urgency}</span> : null}
      {status ? <span className="ownerchip">{status}</span> : null}
    </div>
  );
}

function SfButton({ it, ownerName, enabled, sync, backend, serverPushed }: { it: BackendTodoItem; ownerName?: string; enabled: boolean; sync: TodoSync; backend: Backend; serverPushed: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const id = it.todoKey; // UI state keyed by todo_key
  const isSynced = serverPushed || sync.synced.has(id);
  const st: SyncStatus = isSynced ? "synced" : (sync.status[id] || "idle");
  const syncing = st === "syncing";
  const error = st === "error";
  const sfTaskId = backend.sfTaskIdFor(it) || sync.sfTaskIds[id];

  // Two-step gate: disabled until the checkbox is ticked. Once synced/syncing it
  // stays disabled (no re-push). On error the box stays tickable so the user can
  // retry.
  const disabled = !enabled || syncing || isSynced;

  const title = syncing ? "Pushing to Salesforce…"
    : serverPushed ? `Logged in Salesforce${sfTaskId ? ` (task ${sfTaskId})` : ""}`
    : isSynced ? `Marked complete in Salesforce${sfTaskId ? ` (task ${sfTaskId})` : ""}`
    : error ? "Couldn't complete — Salesforce write failed or backend pending; retry"
    : !enabled ? "Tick the box first"
    : "Mark complete in Salesforce";

  const doPush = async () => {
    // Body = the full backend item (carries todo_key + opp_id VERBATIM) + the
    // category + who clicked. No recomputation, no opp_id reformatting.
    const payload = { ...it, category: it.category, pushed_by: ownerName };
    const result = await sync.sync(id, payload);
    if (result.ok) backend.markPushed(it.todoKey, result.sf_task_id);
  };

  const onClick = () => {
    if (disabled) return;
    setConfirming(true);
  };

  return (
    <>
      <button
        type="button"
        className={`sf-btn ${st}`}
        disabled={disabled}
        title={title}
        aria-label={title}
        onClick={onClick}
      >
        {syncing ? (
          <span className="sf-spin" aria-hidden />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/salesforce.svg" alt="" width={18} height={18} className="sf-cloud" />
            {isSynced ? <span className="sf-badge ok" aria-hidden>✓</span> : null}
            {error ? <span className="sf-badge err" aria-hidden /> : null}
          </>
        )}
      </button>

      {confirming ? (
        <div className="sfm-overlay" onClick={() => setConfirming(false)}>
          <div className="sfm-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sfm-h">Log this to-do as complete in Salesforce?</div>
            <div className="sfm-txt">{it.text}</div>
            <div className="sfm-actions">
              <button type="button" className="sfm-btn cancel" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                type="button"
                className="sfm-btn confirm"
                onClick={() => { setConfirming(false); doPush(); }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
