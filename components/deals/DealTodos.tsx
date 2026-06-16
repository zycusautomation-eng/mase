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
import { useAgentRun } from "@/components/agent/AgentRun";
import { useDashboard } from "@/lib/engine/DashboardContext";

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

// Which rolling horizon a next-move falls in: prefer the backend `horizon` tag;
// otherwise derive from the (always-future) due date. Everything lands in one of
// the three windows so no move is hidden — the board is re-planned daily.
type Horizon = "next_7_days" | "next_14_days" | "next_30_days";
const HORIZON_ORDER: Horizon[] = ["next_7_days", "next_14_days", "next_30_days"];
const HORIZON_LABEL: Record<Horizon, string> = {
  next_7_days: "Next 7 days", next_14_days: "Next 14 days", next_30_days: "Next 30 days",
};
function horizonOf(it: BackendTodoItem): Horizon {
  const tag = String((it.horizon as string) || "").toLowerCase();
  if (tag.includes("7")) return "next_7_days";
  if (tag.includes("14")) return "next_14_days";
  if (tag.includes("30")) return "next_30_days";
  const di = dueInfo(it);
  if (di?.dueBy) {
    const days = Math.round((Date.parse(di.dueBy + "T00:00:00Z") - Date.parse(todayISO() + "T00:00:00Z")) / 86400000);
    if (days <= 7) return "next_7_days";
    if (days <= 14) return "next_14_days";
  }
  return "next_30_days";
}

// One to-do row — checkbox + text + context chips + AI/Salesforce actions.
function TodoRow({
  it, idx, ownerName, done, toggle, sync, backend,
}: {
  it: BackendTodoItem; idx: number; ownerName?: string;
  done: Set<string>; toggle: (id: string) => void; sync: TodoSync; backend: Backend;
}) {
  const serverPushed = backend.isPushed(it);
  const isDone = serverPushed || done.has(it.todoKey);
  return (
    <li className={`todo-item ${isDone ? "done" : ""}`} key={`${it.todoKey || it.text}-${idx}`}>
      <input type="checkbox" checked={isDone} disabled={serverPushed} onChange={() => toggle(it.todoKey)} />
      <div className="td-body">
        <div className="td-txt">{it.text}</div>
        <ContextMeta it={it} />
      </div>
      <AgentButton it={it} ownerName={ownerName} />
      <SfButton it={it} ownerName={ownerName} enabled={done.has(it.todoKey)} sync={sync} backend={backend} serverPushed={serverPushed} />
    </li>
  );
}

// Renders the category buckets for one deal. The "critical / next moves" bucket is
// split into rolling 7 / 14 / 30-day horizons so there is always a clear plan for
// each window; other buckets render flat.
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
  const rowProps = { ownerName, done, toggle, sync, backend };
  return (
    <>
      {buckets.map((bk) => {
        const meta = CATEGORY_META[bk.category];
        if (bk.category === "critical" && bk.items.length) {
          const groups: Record<Horizon, BackendTodoItem[]> = { next_7_days: [], next_14_days: [], next_30_days: [] };
          bk.items.forEach((it) => groups[horizonOf(it)].push(it));
          return (
            <div key={bk.category}>
              <div className={`todo-grp ${meta.tone}`}>{meta.label} <span className="c">{bk.items.length}</span></div>
              {HORIZON_ORDER.filter((hz) => groups[hz].length).map((hz) => (
                <div key={hz}>
                  <div className="td-meta" style={{ margin: "7px 0 2px", fontWeight: 600, color: "var(--accent)" }}>{HORIZON_LABEL[hz]}</div>
                  <ul className="todo-list">
                    {groups[hz].map((it, idx) => <TodoRow key={`${it.todoKey || it.text}-${idx}`} it={it} idx={idx} {...rowProps} />)}
                  </ul>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={bk.category}>
            <div className={`todo-grp ${meta.tone}`}>{meta.label} <span className="c">{bk.items.length}</span></div>
            <ul className="todo-list">
              {bk.items.map((it, idx) => <TodoRow key={`${it.todoKey || it.text}-${idx}`} it={it} idx={idx} {...rowProps} />)}
            </ul>
          </div>
        );
      })}
    </>
  );
}

// --- Due dates are ALWAYS in the future ---
// A to-do's "due by" must never be a past date. A genuine future deadline is kept as-is;
// a past or missing one is re-planned to an urgency-based window from today (the board is
// re-planned daily, so "today" stays current): urgent ~2 days, otherwise ~7 days. The
// origin date (when it was raised / the move was triggered) is shown separately as "from".
const todayISO = (): string => new Date().toISOString().slice(0, 10);
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isUrgentTodo(it: BackendTodoItem): boolean {
  const u = String((it.urgency as string) || "").toLowerCase();
  if (/high|critical|urgent|immediate/.test(u)) return true;
  if (it.category === "critical") return true; // next-moves are time-sensitive by nature
  return /\b(today|immediately|this week|asap|urgent|escalat|dealbreaker|overdue|right away|within 48)\b/i
    .test(String(it.text || ""));
}
function dueInfo(it: BackendTodoItem): { dueBy: string; from: string | null } | null {
  const deadline = (it.act_by || it.due) as string | undefined; // a real deadline field
  const origin = (it.trigger_date || it.date) as string | undefined; // when raised / triggered
  if (!deadline && !origin) return null; // undated item (e.g. a best-practice flag): no due chip
  const t = todayISO();
  const dueBy = deadline && deadline >= t ? deadline : addDays(t, isUrgentTodo(it) ? 2 : 7);
  const from = origin && origin < dueBy ? origin : null;
  return { dueBy, from };
}

// A future due date (>= today) re-planned from today by urgency. Exposed so other views
// (e.g. Matcha) can date a synthesized move the same way the to-do chips do.
export function replanDue(urgent: boolean): string {
  return addDays(todayISO(), urgent ? 2 : 7);
}

// The single highest-leverage NEXT MOVE for one opp — the rank-1 critical to-do — with its
// future due date. Used by Matcha to put an actionable "Next" on each stalled deal instead
// of just metadata. Returns null when the opp has no critical move (caller can synthesize one).
export function topMoveForOpp(
  flat: BackendTodoItem[],
  oppId: unknown,
): { text: string; dueBy: string; owner?: string } | null {
  const key = sfKey(oppId);
  for (const it of flat) {
    if (it.category === "critical" && sfKey(it.opp_id) === key && it.text) {
      const di = dueInfo(it);
      return {
        text: it.text,
        dueBy: di?.dueBy || replanDue(isUrgentTodo(it)),
        owner: (it.intervention_owner as string) || undefined,
      };
    }
  }
  return null;
}

// Small context chips per category. Owner-ish fields render as ownerchip; the due date is
// always future; said_by renders as "asked by X".
export function ContextMeta({ it }: { it: BackendTodoItem }) {
  const owner = (it.intervention_owner || it.who) as string | undefined;
  const askedBy = it.said_by as string | undefined;
  // Drop standalone status-like chips ("overdue" / "open" / "completed" / "no due date") on any
  // field — the future due chip carries the timing now, and a bare "overdue" contradicts it.
  // Narrative triggers (e.g. "5 overdue deliverables") are long, not bare, so they survive.
  const NOISE = /^(open|overdue|completed|no due date|next_\d+_days)$/i;
  const clean = (s: string | undefined) => (s && !NOISE.test(s.trim()) ? s : undefined);
  const trigger = clean(it.trigger as string | undefined);
  const urgency = clean(it.urgency as string | undefined);
  const status = clean(it.status as string | undefined);
  const di = dueInfo(it);
  const hasAny = owner || di || askedBy || trigger || urgency || status;
  if (!hasAny) return null;
  return (
    <div className="td-meta">
      {owner ? <span className={`ownerchip ${ownerKind(owner) === "VP" ? "vp" : ""}`}>{owner}</span> : null}
      {askedBy ? <span className="ownerchip">asked by {askedBy}</span> : null}
      {di ? <span className="duechip">due {di.dueBy}</span> : null}
      {di?.from ? <span className="ownerchip">from {di.from}</span> : null}
      {trigger ? <span className="ownerchip">{trigger}</span> : null}
      {urgency ? <span className="ownerchip">{urgency}</span> : null}
      {status ? <span className="ownerchip">{status}</span> : null}
    </div>
  );
}

// "Run with AI" — hands this to-do to the Tactical Fulfillment Agent, which
// drafts the outbound email live in a right-side panel. Draft-only; a human
// reviews and sends. ADMIN-ONLY for now: neither reps nor VPs see it — only a
// real admin in their own (not simulated) view, so simulating any user hides it
// (the preview matches what that user actually sees: nothing).
export function AgentButton({ it, ownerName }: { it: BackendTodoItem; ownerName?: string }) {
  const { start } = useAgentRun();
  const { realIsAdmin, simEmail } = useDashboard();
  const canRunAI = realIsAdmin && simEmail == null;
  if (!canRunAI) return null;
  return (
    <button
      type="button"
      className="ai-btn"
      title="Run with AI — draft this on the rep's behalf"
      aria-label="Run with AI"
      onClick={() => start(it, ownerName)}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" fill="currentColor" />
        <circle cx="18.5" cy="17.5" r="2.2" fill="currentColor" opacity=".7" />
      </svg>
    </button>
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
