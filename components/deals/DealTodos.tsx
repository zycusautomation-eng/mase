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
import { Monogram } from "@/components/ui/Monogram";

// Per-row visual classification: a type icon (call / email / people / doc / flag)
// derived from the to-do text + category, and a priority (high/med/low) from the
// urgency field falling back to the category. Display-only — no behavior change.
function rowKind(it: BackendTodoItem): { icon: "call" | "mail" | "people" | "doc" | "flag"; prio: "high" | "med" | "low" } {
  const text = String(it.text || "").toLowerCase();
  const cat = it.category;
  let icon: "call" | "mail" | "people" | "doc" | "flag" = "doc";
  if (/\bcall\b|phone|dial|\bring\b/.test(text)) icon = "call";
  else if (/email|e-mail|\bsend\b|draft|reply|recap|follow[- ]?up|outreach|message/.test(text)) icon = "mail";
  else if (/meet|workshop|demo|\bexec\b|stakeholder|champion|align|connect|\bintro\b|sponsor|\bmap\b/.test(text)) icon = "people";
  else if (cat === "critical") icon = "flag";
  const u = String((it.urgency as string) || "").toLowerCase();
  let prio: "high" | "med" | "low" = cat === "critical" ? "high" : (cat === "important" || cat === "explicitRequirements") ? "med" : "low";
  if (/high|critical|urgent|immediate/.test(u)) prio = "high";
  else if (/\blow\b/.test(u)) prio = "low";
  return { icon, prio };
}

function TypeIcon({ kind }: { kind: "call" | "mail" | "people" | "doc" | "flag" }) {
  const p = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "call") return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>;
  if (kind === "mail") return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>;
  if (kind === "people") return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  if (kind === "flag") return <svg {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
  return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;
}

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

// The 4 VP-facing display buckets. Each backend to-do keeps its own `category`
// (so Edit / Delete / Salesforce push are unchanged); for PRESENTATION it is
// mapped to one of these. Commitments split by `who`: ours -> Next phase, the
// buyer's -> Waiting on the buyer.
export const DISPLAY_BUCKET_META = {
  prospect:     { label: "Prospect requirements", tone: "impt",  blurb: "What the prospect has asked of us, still open." },
  next:         { label: "Next phase",            tone: "moves", blurb: "The most important things to do to move the deal." },
  buyerOwed:    { label: "Waiting on the buyer",  tone: "impl",  blurb: "What the prospect owes us." },
  bestPractice: { label: "Best practices",        tone: "bpr",   blurb: "From experience, plays that move the outcome." },
} as const;
export type DisplayBucketKey = keyof typeof DISPLAY_BUCKET_META;
const DISPLAY_ORDER: DisplayBucketKey[] = ["prospect", "next", "buyerOwed", "bestPractice"];
const TOP_N = 5; // only the best to the table; the rest are one click away.

// Buyer-side commitment? Anything not clearly ours (mirrors the backend's
// who-normalisation, so "Publicis legal" lands under Waiting-on-the-buyer).
function isBuyerSide(who: unknown): boolean {
  const w = String(who || "").trim().toLowerCase();
  if (!w) return false;
  return !/(zycus|seller|^we\b|^us\b|\bour\b)/.test(w);
}
function displayBucketOf(it: BackendTodoItem): DisplayBucketKey {
  if (it.category === "explicitRequirements") return "prospect";
  if (it.category === "bestPractice") return "bestPractice";
  if (it.category === "important") return isBuyerSide(it.who) ? "buyerOwed" : "next";
  return "next"; // critical (next moves) + implicit (deliverables we promised)
}

// --- Club homogeneous to-dos (mirror of the backend de-duplicator) ---
// Collapse near-duplicate items (same theme) into ONE, so a bucket shows the
// distinct asks, not many phrasings of the same thing. Keeps the longest /
// most-specific text as the representative. Display-only — every item keeps its
// own todo_key, so the rep stays editable/pushable.
const CLUB_STOP = new Set(
  ("the a an to of for and or by on in with is are be we our us they their them this that at as it its from per " +
   "not yet no new revised first second third fourth round version send sending provide schedule scheduling secure " +
   "finalize finalise ensure confirm get make push start begin complete address answer come back return due open " +
   "overdue still again also now asap week next early late end month before after").split(" "));
function clubSig(text: string): Set<string> {
  const t = String(text || "").toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\b\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/g, " ")
    .replace(/\bof[12]\b/g, "orderform")
    .replace(/[^a-z\s]/g, " ");
  return new Set(t.split(/\s+/).filter((w) => w.length > 2 && !CLUB_STOP.has(w)));
}
function clubItems(items: BackendTodoItem[]): BackendTodoItem[] {
  const clusters: { sig: Set<string>; rep: BackendTodoItem }[] = [];
  for (const it of items) {
    const sig = clubSig(it.text);
    let placed = false;
    for (const c of clusters) {
      let inter = 0;
      for (const x of sig) if (c.sig.has(x)) inter++;
      const need = Math.min(2, sig.size, c.sig.size);
      const overlap = sig.size && c.sig.size ? inter / Math.min(sig.size, c.sig.size) : 0;
      if (inter >= need && overlap >= 0.5) {
        for (const x of sig) c.sig.add(x);
        if (String(it.text || "").length > String(c.rep.text || "").length) c.rep = it;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ sig, rep: it });
  }
  return clusters.map((c) => c.rep);
}

const TD_ICONBTN: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: "var(--muted,#7E8DA1)",
  fontSize: 12, padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap",
};

// One to-do row — checkbox + text + context chips + Edit/Delete + AI/Salesforce
// actions. Edit/Delete persist to the backend overrides layer (sticky across
// re-sweeps); editing opens an inline editor (text + optional due date). A to-do
// already logged to Salesforce (pushed) is locked from edit/delete.
function TodoRow({
  it, idx, ownerName, done, toggle, sync, backend,
}: {
  it: BackendTodoItem; idx: number; ownerName?: string;
  done: Set<string>; toggle: (id: string) => void; sync: TodoSync; backend: Backend;
}) {
  const serverPushed = backend.isPushed(it);
  const isDone = serverPushed || done.has(it.todoKey);
  const canModify = !!it.todoKey && !serverPushed;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(it.text);
  const [draftDue, setDraftDue] = useState<string>(String(it.act_by || it.due || ""));
  const [busy, setBusy] = useState(false);

  const openEdit = () => { setDraft(it.text); setDraftDue(String(it.act_by || it.due || "")); setEditing(true); };
  const saveEdit = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    await backend.editTodo(it, draft, draftDue || undefined);
    setBusy(false); setEditing(false);
  };
  const doDelete = async () => {
    if (!window.confirm("Delete this to-do? It stays deleted across future syncs.")) return;
    setBusy(true);
    await backend.deleteTodo(it);
    setBusy(false);
  };

  if (editing) {
    return (
      <li className="todo-item">
        <div className="td-body" style={{ width: "100%" }}>
          <textarea
            value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
            style={{ width: "100%", font: "inherit", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line,#D7DEE8)", resize: "vertical" }}
          />
          <div className="td-meta" style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12 }}>Due <input type="date" value={draftDue} onChange={(e) => setDraftDue(e.target.value)} style={{ font: "inherit" }} /></label>
            <button type="button" className="sfm-btn confirm" disabled={busy || !draft.trim()} onClick={saveEdit}>Save</button>
            <button type="button" className="sfm-btn cancel" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      </li>
    );
  }

  const k = rowKind(it);
  const avatarName = String((it.intervention_owner as string) || (it.who as string) || ownerName || "");
  const prioLabel = k.prio === "high" ? "High" : k.prio === "med" ? "Medium" : "Low";
  return (
    <li className={`todo-item ${isDone ? "done" : ""}`} key={`${it.todoKey || it.text}-${idx}`}>
      <input type="checkbox" checked={isDone} disabled={serverPushed} onChange={() => toggle(it.todoKey)} />
      <span className={`td-ic ${k.prio}`} aria-hidden><TypeIcon kind={k.icon} /></span>
      <div className="td-body">
        <div className="td-txt">
          {it.text}
          {it.edited ? <span className="ownerchip" style={{ marginLeft: 6 }}>edited</span> : null}
        </div>
        <ContextMeta it={it} />
      </div>
      <span className={`prio ${k.prio}`} title={`${prioLabel} priority`}>{prioLabel}</span>
      {avatarName ? <Monogram kind="person" name={avatarName} size={24} className="td-owner" /> : null}
      {canModify ? <button type="button" style={TD_ICONBTN} title="Edit this to-do" aria-label="Edit" onClick={openEdit}>Edit</button> : null}
      {canModify ? <button type="button" style={TD_ICONBTN} title="Delete this to-do" aria-label="Delete" disabled={busy} onClick={doDelete}>Delete</button> : null}
      <AgentButton it={it} ownerName={ownerName} />
      <SfButton it={it} ownerName={ownerName} enabled={done.has(it.todoKey)} sync={sync} backend={backend} serverPushed={serverPushed} />
    </li>
  );
}

// Renders the 4 VP-facing buckets for one deal. Whatever the caller passes (the
// 5 backend categories) is flattened, re-grouped into Prospect requirements /
// Next phase / Waiting on the buyer / Best practices, CLUBBED (homogeneous items
// collapsed to one), then each bucket capped to the top few (rest behind "Show
// all"). Items keep their backend category, so Edit / Delete / Salesforce push
// are unchanged.
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
  // Apply optimistic edit/delete overlays so a row vanishes/updates instantly
  // (the server applies the same overrides, so a later reload stays consistent).
  const effItems = (items: BackendTodoItem[]): BackendTodoItem[] =>
    items
      .filter((it) => !backend.isDeleted(it))
      .map((it) => {
        const ed = backend.editedTextFor(it);
        if (!ed) return it;
        return { ...it, text: ed.text, edited: true, ...(ed.due ? { due: ed.due, act_by: ed.due } : {}) };
      });
  const grouped: Record<DisplayBucketKey, BackendTodoItem[]> = { prospect: [], next: [], buyerOwed: [], bestPractice: [] };
  for (const it of effItems(buckets.flatMap((b) => b.items))) grouped[displayBucketOf(it)].push(it);
  for (const k of DISPLAY_ORDER) grouped[k] = clubItems(grouped[k]); // collapse homogeneous within each bucket
  return (
    <>
      {DISPLAY_ORDER.map((key) =>
        grouped[key].length ? <BucketBlock key={key} bucketKey={key} items={grouped[key]} rowProps={rowProps} /> : null,
      )}
    </>
  );
}

// One display bucket: header + blurb, the top TOP_N rows, then a "Show all" toggle.
function BucketBlock({
  bucketKey, items, rowProps,
}: {
  bucketKey: DisplayBucketKey;
  items: BackendTodoItem[];
  rowProps: { ownerName?: string; done: Set<string>; toggle: (id: string) => void; sync: TodoSync; backend: Backend };
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = DISPLAY_BUCKET_META[bucketKey];
  const shown = expanded ? items : items.slice(0, TOP_N);
  const hidden = items.length - shown.length;
  return (
    <div style={{ marginBottom: 6 }}>
      <div className={`todo-grp ${meta.tone}`}>{meta.label} <span className="c">{items.length}</span></div>
      <div className="td-meta" style={{ margin: "0 0 4px", color: "var(--muted,#7E8DA1)" }}>{meta.blurb}</div>
      <ul className="todo-list">
        {shown.map((it, idx) => <TodoRow key={`${it.todoKey || it.text}-${idx}`} it={it} idx={idx} {...rowProps} />)}
      </ul>
      {hidden > 0 ? (
        <button type="button" style={TD_ICONBTN} onClick={() => setExpanded(true)}>Show all {items.length} ↓</button>
      ) : null}
      {expanded && items.length > TOP_N ? (
        <button type="button" style={TD_ICONBTN} onClick={() => setExpanded(false)}>Show top {TOP_N} ↑</button>
      ) : null}
    </div>
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
  const { isAdminView } = useDashboard();
  if (!isAdminView) return null;
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
