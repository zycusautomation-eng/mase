"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fixManagerName } from "./helpers";

// Fetches the WHOLE deal-engine to-do book once (GET /api/deal-engine/todo with
// NO owner param -> owner:"all") and renders the Espresso tab DIRECTLY from the
// server's authoritative records. Each item carries todo_key / pushed /
// sf_task_id straight off the wire — NO client-side re-derivation, NO key
// matching. This is what makes "push to Salesforce" work: todo_key and opp_id
// are sent back verbatim.
//
// The backend response is a dict grouped by category. The 5 array names ARE the
// category values; each category has its own primary text field.

const TODO_ENDPOINT = "/api/deal-engine/todo";

// category -> the field on the backend item that holds the display text. In the
// 4-head MECE model the `implicit` category carries our commitments (head 3a) and
// `important` carries buyer-owed dependencies (head 3b); both use `deliverable`.
export const CATEGORY_TEXT_FIELD: Record<BackendCategory, string> = {
  critical: "action",
  important: "deliverable",
  explicitRequirements: "requirement",
  implicit: "deliverable",
  bestPractice: "flag",
};

// Render order for the 5 buckets within a deal block.
export const CATEGORY_ORDER: BackendCategory[] = [
  "critical",
  "important",
  "explicitRequirements",
  "implicit",
  "bestPractice",
];

// CRM data-entry / field hygiene dressed as a deal move — never a real action item
// (the To-Do Scoring Model caps these at 2). Matches a SF field API name (__c), a
// boolean/null field state, a data-entry verb, or a record-repair / data-integrity
// task. Applied to BOTH bestPractice flags AND critical "next moves" — a few hygiene
// tasks (reconstruct deal state, verify opp id/SOQL, diagnose null fields) leak into
// the critical bucket and must not show as the deal's next move.
const CRM_HYGIENE_FLAG =
  /__c\b|\b(is|are)\s+(false|null)\b|[=:]\s*(false|null)\b|amount\s*[=:]\s*0|\bpopulate\b|log (recent )?activity|update salesforce|complete the (crm|salesforce) record|no products scoped|contact roles? in salesforce|no salesforce (opportunity )?data|reconstruct (the )?deal state|corrupted record|verify (the )?(opp(ortunity)?|record) id|verify and correct|\bmalformed\b|\bsoql\b|data[ -]?(hygiene|integrity)|null fields?\b|resolve .*data (access|integrity)|restore .*record integrity/i;

export type BackendCategory =
  | "critical"
  | "important"
  | "explicitRequirements"
  | "implicit"
  | "bestPractice";

// Raw backend item. Carries the identity fields + the category's primary text
// field + per-category context. We keep it permissive with an index signature so
// context fields (intervention_owner, who, due, said_by, date, …) are reachable.
export interface BackendTodoRaw {
  opp_id?: string;
  account_name?: string;
  opp_name?: string;
  owner_name?: string;
  todo_key?: string;
  pushed?: boolean;
  sf_task_id?: string;
  // display fields (one per category)
  action?: string;
  commitment?: string;
  requirement?: string;
  inferred_need?: string;
  flag?: string;
  [k: string]: unknown;
}

// An item after annotation: original fields + the array name (category) + the
// resolved display text + the todo_key surfaced as `todoKey`.
export interface BackendTodoItem extends BackendTodoRaw {
  category: BackendCategory;
  text: string;
  todoKey: string;
}

// A manually-added completed update (logged via "Add update"): a note + the date
// it was done, optionally backed by a Salesforce Task. Surfaces in the drawer's
// "Recently completed" list. Carries opp_id so the drawer can filter by deal.
export interface ManualUpdate {
  id?: string;
  opp_id?: string;
  note?: string;
  done_date?: string | null;
  sf_task_id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

function annotate(data: unknown): {
  arrays: Record<BackendCategory, BackendTodoItem[]>;
  flat: BackendTodoItem[];
  owner: string | null;
  manualCompleted: ManualUpdate[];
} {
  const arrays: Record<BackendCategory, BackendTodoItem[]> = {
    critical: [],
    important: [],
    explicitRequirements: [],
    implicit: [],
    bestPractice: [],
  };
  const flat: BackendTodoItem[] = [];
  let owner: string | null = null;
  if (!data || typeof data !== "object") return { arrays, flat, owner, manualCompleted: [] };
  const book = data as Record<string, unknown>;
  if (typeof book.owner === "string") owner = book.owner;
  const manualCompleted: ManualUpdate[] = Array.isArray(book.manualCompleted)
    ? (book.manualCompleted as ManualUpdate[])
    : [];
  for (const category of CATEGORY_ORDER) {
    const field = CATEGORY_TEXT_FIELD[category];
    const items = book[category];
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as BackendTodoRaw;
      // Resolve the display text from this category's primary field, then fall back
      // across EVERY known text field so a row is never blank — this tolerates both the
      // new backend shape (`deliverable`) and the legacy one (`commitment` /
      // `inferred_need` / `action` / `requirement` / `flag`) during/after rollout.
      const pickText = (...keys: string[]): string => {
        for (const k of keys) { const v = item[k]; if (typeof v === "string" && v.trim()) return v; }
        return "";
      };
      const rawText = pickText(field, "deliverable", "commitment", "inferred_need", "action", "requirement", "flag");
      // Correct the owner's manager in the display text: the backend leaves a literal
      // `manager_name` token or fabricates a non-existent manager; resolve it from the
      // deterministic owner→manager map so "Executive connect" moves name the real person.
      const text = fixManagerName(rawText, item.owner_name);
      // A to-do moves the deal; it does not fill Salesforce. Drop best-practice flags that
      // are CRM data-entry / field hygiene (cite a SF field API name, a boolean/null field
      // state, or a "populate/log activity" task). The same deal gaps survive as clean,
      // field-name-free flags and in the rich MEDDPICC panel. This keeps the UI clean now;
      // the v2 sweep stops emitting these, so over time this is just a safety net.
      if ((category === "bestPractice" || category === "critical") && CRM_HYGIENE_FLAG.test(text)) continue;
      const todoKey = typeof item.todo_key === "string" ? item.todo_key : "";
      const annotated: BackendTodoItem = { ...item, category, text, todoKey };
      arrays[category].push(annotated);
      flat.push(annotated);
    }
  }
  return { arrays, flat, owner, manualCompleted };
}

export function useBackendTodos() {
  const [arrays, setArrays] = useState<Record<BackendCategory, BackendTodoItem[]>>(() => ({
    critical: [],
    important: [],
    explicitRequirements: [],
    implicit: [],
    bestPractice: [],
  }));
  const [flat, setFlat] = useState<BackendTodoItem[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [manualCompleted, setManualCompleted] = useState<ManualUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-todo_key optimistic override for pushed state. A successful push flips
  // the row green without waiting for a refetch.
  const [pushedOverride, setPushedOverride] = useState<Record<string, { pushed: true; sf_task_id?: string }>>({});
  // Optimistic edit/delete state so a row updates/vanishes instantly. The server
  // (derive_todo) also applies these, so a later reload stays consistent.
  const [deletedKeys, setDeletedKeys] = useState<Record<string, true>>({});
  const [editedByKey, setEditedByKey] = useState<Record<string, { text: string; due?: string }>>({});
  // Optimistically-added manual updates (appended to the server list until reload).
  const [addedUpdates, setAddedUpdates] = useState<ManualUpdate[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(TODO_ENDPOINT, { cache: "no-store" });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non-JSON / empty */ }
      if (res.ok) {
        const { arrays, flat, owner, manualCompleted } = annotate(body);
        setArrays(arrays);
        setFlat(flat);
        setOwner(owner);
        setManualCompleted(manualCompleted);
        // Server state now reflects any prior edit/delete/add — clear optimistic layers.
        setDeletedKeys({});
        setEditedByKey({});
        setAddedUpdates([]);
      } else {
        setError(`Request failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const markPushed = useCallback((todoKey: string, sfTaskId?: string) => {
    if (!todoKey) return;
    setPushedOverride((prev) => ({ ...prev, [todoKey]: { pushed: true, sf_task_id: sfTaskId } }));
  }, []);

  // Helpers reading the effective pushed state (server `pushed` OR optimistic
  // override) for a given item.
  const isPushed = useCallback(
    (item: BackendTodoItem): boolean => item.pushed === true || pushedOverride[item.todoKey]?.pushed === true,
    [pushedOverride],
  );
  const sfTaskIdFor = useCallback(
    (item: BackendTodoItem): string | undefined => pushedOverride[item.todoKey]?.sf_task_id || item.sf_task_id,
    [pushedOverride],
  );

  // --- Edit / delete / add-update actions (persist to the backend overrides layer) ---
  const post = async (path: string, body: unknown): Promise<{ ok: boolean; data: any }> => {
    try {
      const res = await fetch(`/api/deal-engine${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: any = null; try { data = await res.json(); } catch { /* empty */ }
      return { ok: res.ok && data?.ok !== false, data };
    } catch (e) {
      return { ok: false, data: { error: e instanceof Error ? e.message : String(e) } };
    }
  };

  // Delete a to-do (sticky across re-sweeps). Optimistically hides the row.
  const deleteTodo = useCallback(async (item: BackendTodoItem): Promise<boolean> => {
    if (!item.todoKey) return false;
    setDeletedKeys((p) => ({ ...p, [item.todoKey]: true }));
    const r = await post("/todo/override", { opp_id: item.opp_id, todo_key: item.todoKey, action: "delete",
      category: item.category, orig_text: item.text });
    if (!r.ok) setDeletedKeys((p) => { const n = { ...p }; delete n[item.todoKey]; return n; });
    return r.ok;
  }, []);

  // Edit a to-do's text (and optional due date). Optimistically shows the new text.
  const editTodo = useCallback(async (item: BackendTodoItem, text: string, due?: string): Promise<boolean> => {
    if (!item.todoKey || !text.trim()) return false;
    const prev = editedByKey[item.todoKey];
    setEditedByKey((p) => ({ ...p, [item.todoKey]: { text: text.trim(), due } }));
    const r = await post("/todo/override", { opp_id: item.opp_id, todo_key: item.todoKey, action: "edit", text: text.trim(), due,
      category: item.category, orig_text: item.text });
    if (!r.ok) setEditedByKey((p) => ({ ...p, [item.todoKey]: prev as { text: string; due?: string } }));
    return r.ok;
  }, [editedByKey]);

  // Add a manual completed update (logs a completed SF Task + shows in Recently completed).
  const addUpdate = useCallback(async (oppId: string, note: string, doneDate: string, destination: string = "completed", dueDate?: string): Promise<{ ok: boolean; sfTaskId?: string; sfError?: string; destination?: string; nextStepUpdated?: boolean }> => {
    const body: Record<string, unknown> = { opp_id: oppId, note, done_date: doneDate, destination };
    if (dueDate) body.due_date = dueDate;
    const r = await post("/todo/update", body);
    if (r.ok) {
      const row: ManualUpdate = (r.data?.update as ManualUpdate) || { opp_id: oppId, note, done_date: dueDate || doneDate, sf_task_id: r.data?.sf_task_id };
      setAddedUpdates((p) => [row, ...p]);
    }
    return { ok: r.ok, sfTaskId: r.data?.sf_task_id, sfError: r.data?.sf_error, destination: r.data?.destination, nextStepUpdated: r.data?.next_step_updated };
  }, []);

  const isDeleted = useCallback((item: BackendTodoItem) => !!deletedKeys[item.todoKey], [deletedKeys]);
  const editedTextFor = useCallback((item: BackendTodoItem) => editedByKey[item.todoKey], [editedByKey]);
  // Effective manual updates for one opp (server + optimistic), newest done-date first.
  const manualForOpp = useCallback((oppId: unknown): ManualUpdate[] => {
    const k = String(oppId || "").slice(0, 15);
    const all = [...addedUpdates, ...manualCompleted].filter((m) => String(m.opp_id || "").slice(0, 15) === k);
    return all.sort((a, b) => String(b.done_date || b.created_at || "").localeCompare(String(a.done_date || a.created_at || "")));
  }, [addedUpdates, manualCompleted]);

  return useMemo(
    () => ({ arrays, flat, owner, loading, error, reload, markPushed, isPushed, sfTaskIdFor, pushedOverride,
             deleteTodo, editTodo, addUpdate, isDeleted, editedTextFor, manualForOpp }),
    [arrays, flat, owner, loading, error, reload, markPushed, isPushed, sfTaskIdFor, pushedOverride,
     deleteTodo, editTodo, addUpdate, isDeleted, editedTextFor, manualForOpp],
  );
}
