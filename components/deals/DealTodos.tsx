"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { ownerKind } from "@/lib/engine/helpers";
import { useTodoSync, type SyncStatus } from "@/lib/engine/useTodoSync";
import {
  useBackendTodos,
  CATEGORY_ORDER,
  type BackendCategory,
  type BackendTodoItem,
} from "@/lib/engine/useBackendTodos";

// SHARED to-do renderer — the single source of truth for how a deal's to-dos
// look and behave. Used by BOTH the Espresso tab and the deal drawer, sourced
// from the same backend GET /todo arrays, so the two are guaranteed identical
// (same items, same todo_key, same pushed state, same Salesforce push).

// Per-category label + tone (reusing the existing .todo-grp tone classes).
export const CATEGORY_META: Record<BackendCategory, { label: string; tone: string }> = {
  critical: { label: "Critical / next moves", tone: "moves" },
  important: { label: "Commitments", tone: "impt" },
  explicitRequirements: { label: "Open requirements", tone: "impt" },
  implicit: { label: "Implicit requirements", tone: "impl" },
  bestPractice: { label: "Best practice", tone: "bpr" },
};

// First 15 chars of a SF id — opp_ids come in 15- and 18-char forms; compare on
// the shared prefix so scope matching and opp-record lookup are robust.
export const sfKey = (id: any): string => String(id || "").slice(0, 15);

export type TodoSync = ReturnType<typeof useTodoSync>;
export type Backend = ReturnType<typeof useBackendTodos>;

export interface TodoBucket {
  category: BackendCategory;
  items: BackendTodoItem[];
}

// Build the 5 category buckets (non-empty only) for a single opp from the flat
// backend list, matched by 15-char prefix. This is the exact same grouping the
// Espresso tab uses per deal block.
export function bucketsForOpp(flat: BackendTodoItem[], oppId: any): TodoBucket[] {
  const key = sfKey(oppId);
  const cats: Record<BackendCategory, BackendTodoItem[]> = {
    critical: [], important: [], explicitRequirements: [], implicit: [], bestPractice: [],
  };
  for (const it of flat) {
    if (!key || sfKey(it.opp_id) !== key) continue;
    cats[it.category].push(it);
  }
  return CATEGORY_ORDER
    .map((category) => ({ category, items: cats[category] }))
    .filter((b) => b.items.length > 0);
}

// Renders the category buckets for one deal — each row a checkbox + context
// chips + the Salesforce push button + confirm modal.
export function DealTodoBuckets({
  buckets, ownerName, done, toggle, sync, backend,
}: {
  buckets: TodoBucket[];
  ownerName?: string;
  done: Set<string>;
  toggle: (id: string) => void;
  sync: TodoSync;
  backend: Backend;
}) {
  return (
    <>
      {buckets.map((bk) => {
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
                    <SfButton it={it} ownerName={ownerName} enabled={done.has(it.todoKey)} sync={sync} backend={backend} serverPushed={serverPushed} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

// Small context chips per category. Owner-ish fields render as ownerchip; date-ish
// fields render as duechip; said_by renders as "asked by X".
export function ContextMeta({ it }: { it: BackendTodoItem }) {
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

export function SfButton({ it, ownerName, enabled, sync, backend, serverPushed }: { it: BackendTodoItem; ownerName?: string; enabled: boolean; sync: TodoSync; backend: Backend; serverPushed: boolean }) {
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
