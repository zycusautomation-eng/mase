"use client";
import { useCallback, useEffect, useState } from "react";

// Mirrors useTodoDone: tracks which to-dos have been pushed to Salesforce.
// `synced` ids are persisted to localStorage (so they survive reload) and kept
// consistent across the page via a custom event + the storage event. `status`
// is in-memory only — transient per-id fetch state (idle/syncing/synced/error).
const SYNCED_KEY = "deal_engine_todo_synced";
const EVT = "deal_engine_todo_synced_changed";

const COMPLETE_ENDPOINT = "/api/deal-engine/todo/complete";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";
export type SyncPayload = { opp_id: string; todo_id: string; text: string };

function load(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || "[]")); } catch { return new Set(); }
}

export function useTodoSync() {
  const [synced, setSynced] = useState<Set<string>>(load);
  const [status, setStatus] = useState<Record<string, SyncStatus>>({});

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

  const sync = useCallback(async (id: string, payload: SyncPayload) => {
    setStatus((s) => ({ ...s, [id]: "syncing" }));
    try {
      const res = await fetch(COMPLETE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non-JSON / empty body */ }
      const errored = !res.ok || (body && typeof body === "object" && "error" in (body as Record<string, unknown>));
      if (errored) {
        setStatus((s) => ({ ...s, [id]: "error" }));
        return;
      }
      markSynced(id);
      setStatus((s) => ({ ...s, [id]: "synced" }));
    } catch {
      // network failure / endpoint not built yet (404 etc.) — never crash
      setStatus((s) => ({ ...s, [id]: "error" }));
    }
  }, [markSynced]);

  return { synced, markSynced, status, sync };
}
