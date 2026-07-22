"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { createPortal } from "react-dom";
import { ownerKind, fmtDue, diffDays, clipWordsClean } from "@/lib/engine/helpers";
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
// 4-head MECE model. The backend to-do CATEGORY strings are kept stable (so the
// Salesforce push / edit / delete ledger keyed by todo_key survives), but their
// MEANING is now: critical = Moves, explicitRequirements = Prospect Requirements,
// implicit = Commitments made by Zycus (head 3a), important = Waiting on the buyer
// (head 3b), bestPractice = Best practices.
export const CATEGORY_META: Record<BackendCategory, { label: string; tone: string }> = {
  critical: { label: "Moves", tone: "crit" },
  important: { label: "Waiting on the buyer", tone: "exp" },
  explicitRequirements: { label: "Prospect Requirements", tone: "impt" },
  implicit: { label: "Commitments made by Zycus", tone: "impl" },
  bestPractice: { label: "Best practices", tone: "bpr" },
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

// The 4 display buckets. Each backend to-do keeps its own `category` (so Edit /
// Delete / Salesforce push are unchanged); for PRESENTATION it maps to exactly ONE:
//   prospect     <- explicitRequirements         (what the prospect asked of us)
//   commitments  <- implicit + critical (MOVES)  (everything Zycus owes/should do next)
//   buyerOwed    <- important                     (what the buyer owes us)
//   bestPractice <- bestPractice                  (advisory levers)
// Moves (critical) fold into "Commitments made by Zycus" so the day's plays are
// always visible in the same place on BOTH Espresso and the deal drawer.
export const DISPLAY_BUCKET_META = {
  prospect:     { label: "Prospect requirements",     tone: "impt", blurb: "Requirements the prospect clearly asked us for." },
  commitments:  { label: "Commitments made by Zycus", tone: "impl", blurb: "Only what Zycus explicitly committed to on a call." },
  buyerOwed:    { label: "Waiting on the buyer",      tone: "exp",  blurb: "What the prospect owes us, to unblock our delivery." },
  bestPractice: { label: "Best practices",            tone: "bpr",  blurb: "Actions to move the deal forward, plus gaps — capped at 7." },
} as const;
export type DisplayBucketKey = keyof typeof DISPLAY_BUCKET_META;
// The four display heads, in order.
const ACTION_ORDER: DisplayBucketKey[] = ["prospect", "commitments", "buyerOwed", "bestPractice"];
const TOP_N = 5; // only the best to the table; the rest are one click away.

// Buyer-side? Anything not clearly ours. Splitting on `who` keeps this correct against
// BOTH the new backend (important = buyer_dependent, all Buyer) AND the legacy backend
// (important = open_deliverables of EITHER side) — so during/after rollout a Zycus
// commitment never lands under "Waiting on the buyer".
function isBuyerSide(who: unknown): boolean {
  const w = String(who || "").trim().toLowerCase();
  if (!w) return false;
  return !/(zycus|seller|^we\b|^us\b|\bour\b)/.test(w);
}
function displayBucketOf(it: BackendTodoItem): DisplayBucketKey {
  // Buyer owes us (their input / approval / info) -> Waiting on the buyer.
  if (it.category === "important") return isBuyerSide(it.who) ? "buyerOwed" : "commitments";
  // ANYTHING the engine tagged as a prospect requirement ALWAYS shows under
  // Prospect requirements — even when the sweep didn't capture a "who asked" name.
  // (Previously an unattributed ask was demoted to Best practices, hiding a real
  // prospect deliverable from the bucket the team tracks against.)
  if (it.category === "explicitRequirements") return "prospect";
  // ONLY what Zycus explicitly committed to ON A CALL (carries grounding evidence /
  // source) -> Commitments. An inferred "we should…" is NOT a commitment -> Best practices.
  if (it.category === "implicit") return ((it as any).grounding_quote || (it as any).source) ? "commitments" : "bestPractice";
  // Moves are RECOMMENDED next actions, NOT on-call commitments -> Best practices.
  // (The top-3 also surface as Play cards — the one allowed overlap.)
  if (it.category === "critical") return "bestPractice";
  // best_practice flags + everything else.
  return "bestPractice";
}

// A recommended "move" sometimes phrases something the PROSPECT actually asked us
// for (a deliverable they requested, an RFP/questionnaire/security review to
// answer, written responses to their questions). The sweep didn't tag it as an
// explicit_requirement, so without this it would only ever read as one of our
// moves. Detect those conservatively so they ALSO surface under Prospect
// requirements — they still show as a Play card (the allowed overlap). The regex
// requires an explicit BUYER-request signal, not a generic "provide/schedule",
// to keep purely-internal moves out. Display-only; the item keeps its todo_key.
const PROSPECT_ASK_RE = new RegExp(
  // The BUYER explicitly asked/requested/requires/wants/needs something. (Subject
  // is restricted to buyer nouns — NOT "they/their/our team" — so an internal
  // "position our product team" move isn't mistaken for a prospect ask.)
  "\\b(?:buyer|prospect|client|customer)\\b[^.]{0,40}?\\b(?:asked|requested|require[sd]?|want(?:s|ed)?|need(?:s|ed)?)\\b" +
  "|\\b(?:as|per)\\s+(?:requested|their\\s+request)\\b" +
  "|\\brequested\\s+by\\b" +
  "|\\b(?:requested|stated|specified)\\s+(?:levels?|criteria|requirements?|experience)\\b" +
  // Responding to THEIR questions / concerns / RFP.
  "|\\b(?:respond(?:ing)?|response|written\\s+responses?|reply|answer(?:ing)?)\\s+to\\b[^.]{0,40}?\\b(?:question|ask|request|query|concern|rfp|rfi|rfq|questionnaire|brd)\\b" +
  "|\\b(?:address(?:ing)?|answer(?:ing)?)\\b[^.]{0,40}?\\b(?:their|buyer'?s?|prospect'?s?|client'?s?)\\b[^.]{0,20}?\\b(?:question|concern|ask|requirement)s?\\b" +
  // An RFP/RFI/RFQ/BRD with a real deliverable / process qualifier — so "manual
  // RFP management" (a value-prop topic) does NOT match, but "RFP response",
  // "RFI debrief", "RFP submission status" do.
  "|\\b(?:rfp|rfi|rfq|brd)\\s+(?:response|document|requirements?|deadline|submission|submitted|status|timeline|scoring|criteria|shortlist|debrief|process|questionnaire)\\b" +
  "|\\b(?:respond(?:ing)?\\s+to|submit|complete|deliver|provide|return|fill|craft|prepare)\\b[^.]{0,30}?\\b(?:rfp|rfi|rfq|brd)\\b" +
  // A buyer-driven security/infosec gate we must satisfy, or a standalone questionnaire.
  "|\\b(?:infosec|security)\\s+(?:questionnaire|review|assessment)\\b" +
  "|\\bquestionnaire\\b|\\bvendor\\s+assessment\\b",
  "i",
);
function looksLikeProspectAsk(text: string): boolean {
  return PROSPECT_ASK_RE.test(String(text || ""));
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
// Normalised full-text key + "same ask" test — a second, stricter matcher layered
// on top of the token-overlap one, so an exact or contained restatement ("Provide
// ROI form" vs "Provide ROI form to Kristopher") is caught even if token overlap is
// borderline. Containment is length-guarded so short generic phrases don't collapse.
function normText(t: unknown): string {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function sameAsk(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length > 12 && long.includes(short);
}
function clubItems(items: BackendTodoItem[]): BackendTodoItem[] {
  const clusters: { sig: Set<string>; rep: BackendTodoItem }[] = [];
  for (const it of items) {
    const sig = clubSig(it.text);
    let placed = false;
    for (const c of clusters) {
      // strict text match first (exact / contained), then token-overlap.
      if (sameAsk(normText(it.text), normText(c.rep.text))) {
        if (String(it.text || "").length > String(c.rep.text || "").length) c.rep = it;
        placed = true;
        break;
      }
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

// Cross-bucket MECE: a theme already shown in a higher-precedence bucket
// (prospect > commitments > buyerOwed > bestPractice) is removed from the lower
// ones, so the same ask never appears under two heads. Top-3 Play cards read
// ai.recommended_moves directly and are unaffected (the one allowed overlap).
function dedupeAcrossBuckets(grouped: Record<DisplayBucketKey, BackendTodoItem[]>): void {
  const seen: Set<string>[] = [];
  const seenNorm: string[] = [];
  const isDup = (sig: Set<string>): boolean => {
    if (!sig.size) return false;
    return seen.some((s) => {
      let inter = 0;
      for (const x of sig) if (s.has(x)) inter++;
      const need = Math.min(2, sig.size, s.size);
      return inter >= need && inter / Math.min(sig.size, s.size) >= 0.5;
    });
  };
  for (const k of ACTION_ORDER) {
    grouped[k] = grouped[k].filter((it) => {
      const sig = clubSig(it.text);
      const nt = normText(it.text);
      // dup if EITHER the token-overlap matcher OR the strict exact/contained
      // matcher fires against anything already kept in a higher-precedence bucket.
      if (isDup(sig) || seenNorm.some((s) => sameAsk(nt, s))) return false;
      if (sig.size) seen.push(sig);
      if (nt) seenNorm.push(nt);
      return true;
    });
  }
}

const TD_ICONBTN: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: "var(--muted,#7E8DA1)",
  fontSize: 12, padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap",
};

// One to-do row — checkbox + text + context chips + Edit/Delete + AI/Salesforce
// actions. Edit/Delete persist to the backend overrides layer (sticky across
// re-sweeps); editing opens an inline editor (text + optional due date). A to-do
// already logged to Salesforce (pushed) is locked from edit/delete.
// Keep a to-do row scannable: long items (wordy Moves / Best-practice essays) are
// capped at ~30 words ending on a clean clause, with a more/less toggle. Short
// items (the crisp majority) render untouched.
function TodoText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = String(text || "").trim().split(/\s+/).filter(Boolean).length > 30;
  if (!long) return <>{text}</>;
  return (
    <>
      {open ? text : clipWordsClean(text, 30)}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ marginLeft: 6, border: "none", background: "none", color: "var(--accent,#5b5bf0)", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}
      >{open ? "less" : "more"}</button>
    </>
  );
}

function TodoRow({
  it, idx, ownerName, done, toggle, sync, backend,
}: {
  it: BackendTodoItem; idx: number; ownerName?: string;
  done: Set<string>; toggle: (id: string) => void; sync: TodoSync; backend: Backend;
}) {
  const serverPushed = backend.isPushed(it);
  // A move injected from the record but not yet surfaced by the backend /todo book
  // (shown for visibility; push/edit unlock once the next sweep makes it a real to-do).
  const pending = Boolean((it as any).pending);
  const isDone = serverPushed || done.has(it.todoKey);
  const canModify = !!it.todoKey && !serverPushed && !pending;
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
          <TodoText text={it.text} />
          {it.edited ? <span className="ownerchip" style={{ marginLeft: 6 }}>edited</span> : null}
        </div>
        <ContextMeta it={it} />
      </div>
      <span className={`prio ${k.prio}`} title={`${prioLabel} priority`}>{prioLabel}</span>
      {avatarName ? <Monogram kind="person" name={avatarName} size={24} className="td-owner" /> : null}
      {canModify ? <button type="button" style={TD_ICONBTN} title="Edit this to-do" aria-label="Edit" onClick={openEdit}>Edit</button> : null}
      {canModify ? <button type="button" style={TD_ICONBTN} title="Delete this to-do" aria-label="Delete" disabled={busy} onClick={doDelete}>Delete</button> : null}
      {!pending ? <AgentButton it={it} ownerName={ownerName} /> : null}
      {!pending
        ? <SfButton it={it} ownerName={ownerName} enabled={done.has(it.todoKey)} sync={sync} backend={backend} serverPushed={serverPushed} />
        : <span className="ownerchip" title="Surfaces as a Salesforce-pushable to-do on the next sweep" style={{ alignSelf: "center" }}>queued</span>}
    </li>
  );
}

// Renders the 4 VP-facing buckets for one deal. Whatever the caller passes (the
// 5 backend categories) is flattened, re-grouped into Prospect requirements /
// Next phase / Waiting on the buyer / Best practices, CLUBBED (homogeneous items
// collapsed to one), then each bucket capped to the top few (rest behind "Show
// all"). Items keep their backend category, so Edit / Delete / Salesforce push
// are unchanged.
// Rank items so a per-bucket cap keeps the MOST IMPORTANT few: priority first
// (urgency → category, via rowKind), then overdue before upcoming, then soonest due,
// then dated before undated. Stable, so equal items keep their emitted order.
function sortByPriority(items: BackendTodoItem[]): BackendTodoItem[] {
  const today = todayISO();
  const rank = (it: BackendTodoItem) => { const p = rowKind(it).prio; return p === "high" ? 0 : p === "med" ? 1 : 2; };
  return [...items].sort((a, b) => {
    const pr = rank(a) - rank(b);
    if (pr) return pr;
    const da = String(a.act_by || a.due || ""), db = String(b.act_by || b.due || "");
    const oa = da && da < today ? 0 : 1, ob = db && db < today ? 0 : 1; // overdue first
    if (oa !== ob) return oa - ob;
    if (da && db && da !== db) return da < db ? -1 : 1;                  // soonest due first
    if (!!da !== !!db) return da ? -1 : 1;                               // dated before undated
    return 0;
  });
}

// The reduction pipeline that turns the 5 raw backend categories into the 4 VP-facing
// display buckets ACTUALLY shown in the UI: optimistic edit/delete overlay → re-group
// (displayBucketOf) → club homogeneous → cross-bucket de-dup → cap each head at 5.
// Exported so the drawer's "done/total" counter can count the SAME rows the list
// renders — the two must never diverge (that was the 0/41-vs-actual mismatch).
export function buildActionBuckets(
  buckets: TodoBucket[],
  backend: Backend,
): Record<DisplayBucketKey, BackendTodoItem[]> {
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
  const grouped: Record<DisplayBucketKey, BackendTodoItem[]> = { prospect: [], commitments: [], buyerOwed: [], bestPractice: [] };
  // Each item lands in the ONE bucket its nature fits (displayBucketOf); inferred
  // requirements/commitments fall through to Best practices.
  for (const it of effItems(buckets.flatMap((b) => b.items))) {
    grouped[displayBucketOf(it)].push(it);
    // A "move" that actually phrases a prospect-stated ask is ALSO mirrored into
    // Prospect requirements (it still appears as a Play card — the allowed
    // overlap). Cross-bucket de-dup then keeps it out of Best practices.
    if (it.category === "critical" && looksLikeProspectAsk(it.text)) {
      grouped.prospect.push({ ...it, mirroredAsk: true } as BackendTodoItem);
    }
  }
  for (const k of ACTION_ORDER) grouped[k] = clubItems(grouped[k]); // collapse homogeneous within each bucket
  dedupeAcrossBuckets(grouped); // cross-bucket MECE: a theme never repeats across heads
  // Cap EVERY bucket at its 5 highest-priority items so no head becomes a tiring,
  // exhaustive list — the dropped ones are the lowest-priority, never the urgent few.
  for (const k of ACTION_ORDER) grouped[k] = sortByPriority(grouped[k]).slice(0, 5);
  return grouped;
}

// The FLAT list of to-dos the drawer/Espresso actually render (all 4 heads, in order).
// The Action-plan progress counter counts THESE, so "3/9" equals the rows on screen —
// not the larger raw backend list, which is clubbed / de-duped / capped away.
export function displayedTodos(buckets: TodoBucket[], backend: Backend): BackendTodoItem[] {
  const grouped = buildActionBuckets(buckets, backend);
  return ACTION_ORDER.flatMap((k) => grouped[k]);
}

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
  // Completed todos (pushed to Salesforce, or locally checked off) are HIDDEN by default so
  // a fresh sweep reads as a clean, actionable list — they live on in Salesforce and can be
  // revealed with the toggle. isDone mirrors TodoRow's own rule (serverPushed || checked).
  const [showDone, setShowDone] = useState(false);
  const rowProps = { ownerName, done, toggle, sync, backend };
  const grouped = buildActionBuckets(buckets, backend);
  const isDone = (it: BackendTodoItem) => backend.isPushed(it) || done.has(it.todoKey);
  const doneCount = ACTION_ORDER.reduce((n, k) => n + grouped[k].filter(isDone).length, 0);
  return (
    <>
      {ACTION_ORDER.map((key) => {
        const items = showDone ? grouped[key] : grouped[key].filter((it) => !isDone(it));
        return items.length ? <BucketBlock key={key} bucketKey={key} items={items} rowProps={rowProps} /> : null;
      })}
      {doneCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="td-meta"
          style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 2px", color: "var(--muted,#7E8DA1)", fontWeight: 700 }}
        >
          {showDone ? `Hide ${doneCount} completed` : `Show ${doneCount} completed ✓`}
        </button>
      ) : null}
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

// A prospect requirement is date-TRACKED: unlike a move (whose chip is always
// re-planned into the future), a requirement keeps its true timeliness so a
// slipped deliverable is visible. The due is whatever the backend derived
// (a stated deadline, else one back-planned from close) or a mirrored move's act_by.
function reqDueOf(it: BackendTodoItem): { iso: string; overdue: boolean; n: number; stated: boolean } | null {
  const iso = (it.act_by || it.due) as string | undefined;
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = todayISO();
  const delta = diffDays(t, iso); // iso - today: negative = overdue
  return { iso, overdue: iso < t, n: Math.abs(delta ?? 0), stated: (it as any).due_source === "stated" };
}

// Small context chips per category. Owner-ish fields render as ownerchip; said_by
// renders as "asked by X". Moves get an always-future due chip; a prospect
// requirement gets a timeliness-preserving one (overdue Nd when slipped).
export function ContextMeta({ it }: { it: BackendTodoItem }) {
  const owner = (it.intervention_owner || it.who) as string | undefined;
  const askedBy = it.said_by as string | undefined;
  // Drop standalone status-like chips ("overdue" / "open" / "completed" / "no due date") on any
  // field — the due chip carries the timing now, and a bare "overdue" contradicts it.
  // Narrative triggers (e.g. "5 overdue deliverables") are long, not bare, so they survive.
  const NOISE = /^(open|overdue|completed|no due date|next_\d+_days)$/i;
  const clean = (s: string | undefined) => (s && !NOISE.test(s.trim()) ? s : undefined);
  const urgency = clean(it.urgency as string | undefined);
  const status = clean(it.status as string | undefined);
  // Requirements (real or mirrored from a move) are date-tracked with timeliness;
  // everything else keeps the always-future move chip.
  const isReq = it.category === "explicitRequirements" || Boolean((it as any).mirroredAsk);
  const reqDue = isReq ? reqDueOf(it) : null;
  const di = isReq ? null : dueInfo(it);
  const hasAny = owner || di || reqDue || askedBy || urgency || status;
  if (!hasAny) return null;
  return (
    <div className="td-meta">
      {owner ? <span className={`ownerchip ${ownerKind(owner) === "VP" ? "vp" : ""}`}>{owner}</span> : null}
      {askedBy ? <span className="ownerchip">asked by {askedBy}</span> : null}
      {reqDue ? (
        <span
          className={`duechip${reqDue.overdue ? " overdue" : ""}`}
          title={reqDue.stated ? "stated deadline" : "target — back-planned from the close date"}
        >
          {reqDue.overdue
            ? `overdue ${reqDue.n}d · was ${fmtDue(reqDue.iso)}`
            : reqDue.n === 0 ? "due today" : `due ${fmtDue(reqDue.iso)}`}
        </span>
      ) : null}
      {di ? <span className="duechip">due {di.dueBy}</span> : null}
      {di?.from ? <span className="ownerchip">from {di.from}</span> : null}
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

      {/* Portal to <body>: the deal drawer uses `transform` for its slide-in, which makes
          it the containing block for position:fixed descendants — so an inline modal gets
          trapped/clipped inside the drawer panel (Confirm unreachable). Portaling escapes
          the drawer's transform so the modal always centres on the viewport, above the drawer. */}
      {confirming && typeof document !== "undefined"
        ? createPortal(
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
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
