"use client";
// Bulk "push to Salesforce": pushes EVERY to-do you've ticked (done) but not yet
// pushed, all at once. Each becomes a completed Salesforce task, exactly like the
// per-row cloud button, just batched. The "selection" is simply the ticked rows, so
// there's no extra checkbox. Used by Espresso (across every deal in scope) and the
// deal drawer / detail page (that one deal).
import { useState } from "react";
import type { BackendTodoItem } from "@/lib/engine/useBackendTodos";
import type { Backend, TodoSync } from "@/components/deals/DealTodos";

export function BulkPushBar({ items, done, sync, backend, ownerOf }: {
  items: BackendTodoItem[];
  done: Set<string>;
  sync: TodoSync;
  backend: Backend;
  ownerOf?: (it: BackendTodoItem) => string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Ready-to-push = ticked done, not already pushed, not deleted — the same gate the
  // per-row cloud button uses, so this just batches it.
  const targets = items.filter(
    (it) => it.todoKey && done.has(it.todoKey) && !backend.isPushed(it) && !backend.isDeleted(it),
  );
  const n = targets.length;
  if (n < 1 && !busy) return null;

  const run = async () => {
    setConfirming(false);
    setBusy(true);
    for (const it of targets) {
      const r = await sync.sync(it.todoKey, { ...it, category: it.category, pushed_by: ownerOf?.(it) });
      if (r.ok) backend.markPushed(it.todoKey, r.sf_task_id);
    }
    setBusy(false);
  };

  return (
    <div className="bulkpush" role="region" aria-label="Push ticked to-dos to Salesforce">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/salesforce.svg" alt="" width={18} height={18} className="sf-cloud" />
      <span className="bulkpush-n">{busy ? "Pushing to Salesforce…" : `${n} to-do${n === 1 ? "" : "s"} ticked`}</span>
      <button type="button" className="sfm-btn confirm" disabled={busy || n < 1} onClick={() => setConfirming(true)}>
        Push {n} to Salesforce
      </button>
      {confirming ? (
        <div className="sfm-overlay" onClick={() => setConfirming(false)}>
          <div className="sfm-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sfm-h">Log {n} to-do{n === 1 ? "" : "s"} as complete in Salesforce?</div>
            <div className="sfm-txt">Each becomes a completed Salesforce task, the same as pushing a row one at a time.</div>
            <div className="sfm-actions">
              <button type="button" className="sfm-btn cancel" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="sfm-btn confirm" onClick={run}>Push {n}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
