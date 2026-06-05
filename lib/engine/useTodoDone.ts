"use client";
import { useCallback, useEffect, useState } from "react";

// Shared completion state for to-dos. The Espresso tab and the deal drawer both
// use this hook, so ticking a to-do in one place reflects in the other (same tab
// via a custom event, across tabs via the storage event) — and the ids come from
// buildDealTodos, so a deal's to-dos are the same items in both views.
const DONE_KEY = "deal_engine_todo_done";
const EVT = "deal_engine_todo_done_changed";

function load(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]")); } catch { return new Set(); }
}

export function useTodoDone() {
  const [done, setDone] = useState<Set<string>>(load);

  useEffect(() => {
    const refresh = () => setDone(load());
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(EVT, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  const toggle = useCallback((id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(DONE_KEY, JSON.stringify([...next])); } catch {}
      window.dispatchEvent(new Event(EVT));
      return next;
    });
  }, []);

  return { done, toggle };
}
