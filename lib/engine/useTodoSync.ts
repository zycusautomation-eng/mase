"use client";
import { useCallback, useEffect, useState } from "react";
import type { BackendTodoItem } from "@/lib/engine/useBackendTodos";

// Tracks which to-dos have been pushed to Salesforce via POST /todo/push.
// Server-side `pushed` is the source of truth (see useBackendTodos); this hook
// only carries optimistic / transient state for the current session so the UI
// updates immediately on a successful push. `synced` ids are persisted to
// localStorage (so they survive reload until the next GET /todo confirms them).
// `status` is in-memory only — transient per-id fetch state.
const SYNCED_KEY = "deal_engine_todo_synced";
const EVT = "deal_engine_todo_synced_changed";

const PUSH_ENDPOINT = "/api/deal-engine/todo/push";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

// The body we POST: the full backend to-do object (carries todo_key, opp_id,
// category, display field + context) plus who clicked.
export type PushPayload = BackendTodoItem & { pushed_by?: string };

function load(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || "[]")); } catch { return new Set(); }
}

export function useTodoSync() {
  const [synced, setSynced] = useState<Set<string>>(load);
  const [status, setStatus] = useState<Record<string, SyncStatus>>({});
  const [sfTaskIds, setSfTaskIds] = useState<Record<string, string>>({});

  useEffect(() => {
    const refresh = () => setSynced(load());
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(EVT, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  const markSynced = useCallback((id: string) => {
    setSynced((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(SYNCED_KEY, JSON.stringify([...next])); } catch {}
      window.dispatchEvent(new Event(EVT));
      return next;
    });
  }, []);

  // `id` is the UI key (the item's todo_key, used to track per-row UI state);
  // `payload` is the backend object + pushed_by that actually goes to Salesforce.
  // Returns { ok, sf_task_id } so the caller can flip the optimistic pushed
  // override on success (already_pushed:true is treated as success too).
  const sync = useCallback(async (id: string, payload: PushPayload): Promise<{ ok: boolean; sf_task_id?: string }> => {
    setStatus((s) => ({ ...s, [id]: "syncing" }));
    try {
      const res = await fetch(PUSH_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non-JSON / empty body */ }
      const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

      // 502 = Salesforce write failed — safe to retry. Do NOT mark synced; leave
      // the box tickable. 400/404 = backend pending / bad request. Both -> error.
      if (!res.ok || b.ok !== true) {
        setStatus((s) => ({ ...s, [id]: "error" }));
        return { ok: false };
      }

      // Success (idempotent — already_pushed:true returns ok:true with same task).
      const sfTaskId = typeof b.sf_task_id === "string" ? (b.sf_task_id as string) : undefined;
      if (sfTaskId) {
        setSfTaskIds((m) => ({ ...m, [id]: sfTaskId }));
      }
      markSynced(id);
      setStatus((s) => ({ ...s, [id]: "synced" }));
      return { ok: true, sf_task_id: sfTaskId };
    } catch {
      // network failure / endpoint not built yet (404 etc.) — never crash.
      setStatus((s) => ({ ...s, [id]: "error" }));
      return { ok: false };
    }
  }, [markSynced]);

  return { synced, markSynced, status, sfTaskIds, sync };
}
