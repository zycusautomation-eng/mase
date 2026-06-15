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

// category -> the field on the backend item that holds the display text.
export const CATEGORY_TEXT_FIELD: Record<BackendCategory, string> = {
  critical: "action",
  important: "commitment",
  explicitRequirements: "requirement",
  implicit: "inferred_need",
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

// Best-practice flags that are CRM data-entry / field hygiene rather than deal moves.
// Matches a SF field API name (__c), a boolean/null field state, or a data-entry verb.
const CRM_HYGIENE_FLAG =
  /__c\b|\b(is|are)\s+(false|null)\b|[=:]\s*(false|null)\b|amount\s*[=:]\s*0|\bpopulate\b|log (recent )?activity|update salesforce|complete the (crm|salesforce) record|no products scoped|contact roles? in salesforce|no salesforce (opportunity )?data/i;

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

function annotate(data: unknown): {
  arrays: Record<BackendCategory, BackendTodoItem[]>;
  flat: BackendTodoItem[];
  owner: string | null;
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
  if (!data || typeof data !== "object") return { arrays, flat, owner };
  const book = data as Record<string, unknown>;
  if (typeof book.owner === "string") owner = book.owner;
  for (const category of CATEGORY_ORDER) {
    const field = CATEGORY_TEXT_FIELD[category];
    const items = book[category];
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as BackendTodoRaw;
      const textVal = item[field];
      // Correct the owner's manager in the display text: the backend leaves a literal
      // `manager_name` token or fabricates a non-existent manager; resolve it from the
      // deterministic owner→manager map so "Executive connect" moves name the real person.
      const text = typeof textVal === "string" ? fixManagerName(textVal, item.owner_name) : "";
      // A to-do moves the deal; it does not fill Salesforce. Drop best-practice flags that
      // are CRM data-entry / field hygiene (cite a SF field API name, a boolean/null field
      // state, or a "populate/log activity" task). The same deal gaps survive as clean,
      // field-name-free flags and in the rich MEDDPICC panel. This keeps the UI clean now;
      // the v2 sweep stops emitting these, so over time this is just a safety net.
      if (category === "bestPractice" && CRM_HYGIENE_FLAG.test(text)) continue;
      const todoKey = typeof item.todo_key === "string" ? item.todo_key : "";
      const annotated: BackendTodoItem = { ...item, category, text, todoKey };
      arrays[category].push(annotated);
      flat.push(annotated);
    }
  }
  return { arrays, flat, owner };
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-todo_key optimistic override for pushed state. A successful push flips
  // the row green without waiting for a refetch.
  const [pushedOverride, setPushedOverride] = useState<Record<string, { pushed: true; sf_task_id?: string }>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(TODO_ENDPOINT, { cache: "no-store" });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non-JSON / empty */ }
      if (res.ok) {
        const { arrays, flat, owner } = annotate(body);
        setArrays(arrays);
        setFlat(flat);
        setOwner(owner);
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

  return useMemo(
    () => ({ arrays, flat, owner, loading, error, reload, markPushed, isPushed, sfTaskIdFor, pushedOverride }),
    [arrays, flat, owner, loading, error, reload, markPushed, isPushed, sfTaskIdFor, pushedOverride],
  );
}
