"use client";
// Tiny in-session registry of running per-deal agent tasks. The global
// DealChatsDock reads this to show which deals have an agent actively working
// right now (the "Running" view) alongside the persisted conversation history
// (the "Chats" view, loaded from mase_chats). In-session only — a page reload
// clears it (the run continues backend-side, but this tab stops tracking it).

export interface RunningTask {
  convoKey: string;
  oid: string;
  accountName: string;
  startedAt: number;
  /** The live streaming chat_id of the in-progress turn, so the dock can reopen
   *  and reconnect to a running run instead of starting a fresh scan. */
  streamChatId?: string;
}

type Listener = () => void;

const running = new Map<string, RunningTask>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function setRunning(task: RunningTask) {
  running.set(task.convoKey, task);
  emit();
}

export function clearRunning(convoKey: string) {
  if (running.delete(convoKey)) emit();
}

export function getRunning(): RunningTask[] {
  return Array.from(running.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
