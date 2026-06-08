"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { TIERS, fmtAmount, ownerKind, buildDealTodos, OWNER_VP, type Rec } from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { useTodoSync, type SyncStatus } from "@/lib/engine/useTodoSync";
import { useBackendTodos, backendKey, type BackendTodo } from "@/lib/engine/useBackendTodos";

// MASE group key -> backend category. The backend item's display field is keyed
// off the category (see useBackendTodos), so we only need the category here.
const GROUP_CATEGORY: Record<string, string> = {
  moves: "critical",
  explicit: "explicitRequirements",
  implicit: "implicit",
  bestpractice: "bestPractice",
};

export default function EspressoPage() {
  const { records, vps, rsds, playbook, filtered } = useDashboard();
  const { done, toggle } = useTodoDone();
  const sync = useTodoSync();
  const backend = useBackendTodos();
  const [activeTier, setActiveTier] = useState<string | null>(null);

  const who = rsds.length ? rsds.join(", ")
    : vps.length === 1 ? `${vps[0]}'s team`
    : vps.length ? vps.join(" & ")
    : "all VPs";

  // Build tiers -> deals -> items via the SHARED buildDealTodos, so these to-dos
  // are byte-for-byte the same as what the deal drawer shows for each deal.
  const tiers = useMemo(() => {
    return TIERS.map((tier) => {
      const deals = filtered
        .filter((r: Rec) => tier.match(r.hard || {}))
        .sort((a, b) => (Number((b.hard || {}).amount) || 0) - (Number((a.hard || {}).amount) || 0));
      if (!deals.length) return null;
      const blocks = deals.map((r: Rec) => {
        const todos = buildDealTodos(r, records, playbook);
        if (!todos) return null;
        const h = r.hard || {};
        return { oid: h.opp_id, dn: h.account_name || h.opp_name || h.opp_id, h, groups: todos.groups, dc: todos.dc, plays: todos.plays };
      }).filter(Boolean) as any[];
      if (!blocks.length) return null;
      const totalVal = deals.reduce((s, r) => s + (Number((r.hard || {}).amount) || 0), 0);
      return { tier, deals, blocks, totalVal };
    }).filter(Boolean) as any[];
  }, [filtered, records, playbook]);

  const { total, doneCount } = useMemo(() => {
    let t = 0, d = 0;
    for (const tg of tiers) for (const b of tg.blocks) for (const g of b.groups) for (const it of g.items) { t++; if (done.has(it.id)) d++; }
    return { total: t, doneCount: d };
  }, [tiers, done]);

  if (!records.length) return <div className="empty-s">No swept records yet.</div>;

  const tabKeys = tiers.map((t) => t.tier.key);
  const active = activeTier && tabKeys.includes(activeTier) ? activeTier : (tabKeys[0] || null);
  const shown = tiers.find((t) => t.tier.key === active);
  const shortLabel = (label: string) => label.split(" —")[0];

  return (
    <div id="todoview">
      <div className="todo-top">
        <div className="ttl">Action plan for <b>{who}</b>, by forecast tier. Forecast deals get a full plan with back-planned dates; qualified pipeline is lighter and optional. Initial-interest deals are excluded.</div>
        <div className="todo-prog">{doneCount} of {total} done</div>
      </div>

      {tiers.length === 0 ? (
        <div className="empty-s">No forecast or qualified-pipeline deals in scope yet.</div>
      ) : (
        <>
          <div className="tiertabs-bar">
            <div className="tabs tiertabs">
              {tiers.map((tg) => (
                <button
                  key={tg.tier.key}
                  className={`tab ${active === tg.tier.key ? "active" : ""}`}
                  onClick={() => setActiveTier(tg.tier.key)}
                >
                  {shortLabel(tg.tier.label)} <span className="tcount">{tg.deals.length}</span>
                </button>
              ))}
            </div>
          </div>

          {shown ? (
            <div className={`tier ${shown.tier.key}`}>
              {shown.blocks.map((b: any, i: number) => (
                <DealBlock key={`${b.oid}-${i}`} b={b} done={done} toggle={toggle} sync={sync} index={backend.index} showVp={vps.length !== 1} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

type TodoSync = ReturnType<typeof useTodoSync>;
type BackendIndex = ReturnType<typeof useBackendTodos>["index"];

function DealBlock({ b, done, toggle, sync, index, showVp }: { b: any; done: Set<string>; toggle: (id: string) => void; sync: TodoSync; index: BackendIndex; showVp: boolean }) {
  const { h } = b;
  const vpMeta = showVp && OWNER_VP[h.owner_name] ? ` (${OWNER_VP[h.owner_name]})` : "";
  const closeMeta = h.close_date
    ? <> · close {h.close_date}{b.dc != null ? (b.dc < 0 ? <> · <span className="od">past close</span></> : ` · ${b.dc}d`) : ""}</>
    : "";
  return (
    <div className="deal-blk">
      <div className="deal-h"><span className="nm">{h.account_name || h.opp_name || h.opp_id}</span><span className="amt">{fmtAmount(h.amount)}</span></div>
      <div className="deal-sub">{h.opp_name || ""} · {h.owner_name || ""}{vpMeta} · {h.stage || ""}{closeMeta}</div>
      {b.groups.map((g: any) => {
        const category = GROUP_CATEGORY[g.key];
        return (
          <div key={g.key}>
            <div className={`todo-grp ${g.tone}`}>{g.label} <span className="c">{g.items.length}</span></div>
            <ul className="todo-list">
              {g.items.map((it: any, idx: number) => {
                // Bridge the client-built to-do back to the server's record by
                // (opp_id, category, normalised text). May be undefined if the
                // backend hasn't published this item (or isn't deployed yet).
                const match: BackendTodo | undefined = category
                  ? index.get(backendKey(b.oid, category, it.text))
                  : undefined;
                const serverPushed = match?.pushed === true;
                const isDone = serverPushed || done.has(it.id);
                return (
                  <li className={`todo-item ${isDone ? "done" : ""}`} key={`${it.id}-${idx}`}>
                    <input type="checkbox" checked={isDone} disabled={serverPushed} onChange={() => toggle(it.id)} />
                    <div className="td-body">
                      <div className="td-txt">{it.text}</div>
                      <div className="td-meta">
                        {it.owner ? <span className={`ownerchip ${ownerKind(it.owner) === "VP" ? "vp" : ""}`}>{it.owner}</span> : null}
                        {it.meta ? <span className="ownerchip">{it.meta}</span> : null}
                        {it.due ? <span className={`duechip ${it.due.cls}`}>{it.due.txt}</span> : null}
                      </div>
                    </div>
                    <SfButton oid={b.oid} it={it} enabled={done.has(it.id)} sync={sync} match={match} ownerName={h.owner_name} serverPushed={serverPushed} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function SfButton({ oid, it, enabled, sync, match, ownerName, serverPushed }: { oid: string; it: any; enabled: boolean; sync: TodoSync; match: BackendTodo | undefined; ownerName?: string; serverPushed: boolean }) {
  const [confirming, setConfirming] = useState(false);
  // Server pushed state takes precedence over local/optimistic tracking.
  const isSynced = serverPushed || sync.synced.has(it.id);
  const st: SyncStatus = isSynced ? "synced" : (sync.status[it.id] || "idle");
  const syncing = st === "syncing";
  const error = st === "error";
  const sfTaskId = match?.sf_task_id || sync.sfTaskIds[it.id];

  // Two-step gate: disabled until the checkbox is ticked. Once synced/syncing it
  // stays disabled too (no re-push). On 502 error the box stays tickable so the
  // user can retry.
  const disabled = !enabled || syncing || isSynced;

  const title = syncing ? "Pushing to Salesforce…"
    : serverPushed ? `Logged in Salesforce${sfTaskId ? ` (task ${sfTaskId})` : ""}`
    : isSynced ? `Marked complete in Salesforce${sfTaskId ? ` (task ${sfTaskId})` : ""}`
    : error ? "Couldn't complete — Salesforce write failed or backend pending; retry"
    : !enabled ? "Tick the box first"
    : "Mark complete in Salesforce";

  const doPush = () => {
    // Build the body from the matched backend object so it carries todo_key,
    // opp_id, category and the display field/context. If there's no match yet
    // (backend not deployed), still POST a best-effort body — the backend will
    // 400 and we handle it gracefully.
    const payload = {
      ...(match || { opp_id: oid, category: undefined, action: it.text }),
      pushed_by: ownerName,
    };
    sync.sync(it.id, payload as any);
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
