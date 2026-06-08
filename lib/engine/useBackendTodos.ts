"use client";
import { useCallback, useEffect, useState } from "react";

// Fetches the WHOLE deal-engine to-do book once (GET /api/deal-engine/todo with
// NO owner param -> owner:"all") and builds a lookup index so the client-built
// Espresso to-dos can be matched back to the server's authoritative records
// (which carry todo_key / pushed / sf_task_id).
//
// The backend response is a dict grouped by category. Each category's items use a
// different display field for the human text, but the text equals what MASE
// renders (same AI source), so we index by ${opp_id}|${category}|${normText}.

const TODO_ENDPOINT = "/api/deal-engine/todo";

// category -> the field on the backend item that holds the display text.
const CATEGORY_TEXT_FIELD: Record<string, string> = {
  critical: "action",
  important: "commitment",
  explicitRequirements: "requirement",
  implicit: "inferred_need",
  bestPractice: "flag",
};

export interface BackendTodo {
  todo_key?: string;
  opp_id?: string;
  category?: string;
  pushed?: boolean;
  sf_task_id?: string;
  // display fields (one of these holds the text, per category)
  action?: string;
  commitment?: string;
  requirement?: string;
  inferred_need?: string;
  flag?: string;
  [k: string]: unknown;
}

export type BackendTodoIndex = Map<string, BackendTodo>;

function indexKey(oppId: string, category: string, text: string): string {
  return `${oppId}|${category}|${text.trim()}`;
}

// Re-export so callers (Espresso) compute the same key without duplicating logic.
export function backendKey(oppId: string, category: string, text: string): string {
  return indexKey(oppId, category, text);
}

function buildIndex(data: unknown): BackendTodoIndex {
  const idx: BackendTodoIndex = new Map();
  if (!data || typeof data !== "object") return idx;
  const book = data as Record<string, unknown>;
  for (const [category, field] of Object.entries(CATEGORY_TEXT_FIELD)) {
    const items = book[category];
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as BackendTodo;
      const oppId = item.opp_id;
      const text = item[field];
      if (typeof oppId !== "string" || typeof text !== "string" || !text.trim()) continue;
      idx.set(indexKey(oppId, category, text), { ...item, category });
    }
  }
  return idx;
}

export function useBackendTodos() {
  const [index, setIndex] = useState<BackendTodoIndex>(() => new Map());
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(TODO_ENDPOINT, { cache: "no-store" });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non-JSON / empty */ }
      if (res.ok) {
        setIndex(buildIndex(body));
      } else {
        setIndex(new Map());
      }
    } catch {
      // backend not deployed / network failure — empty index, never crash.
      setIndex(new Map());
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { index, ready, reload };
}
