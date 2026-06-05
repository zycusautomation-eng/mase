"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { TIERS, fmtAmount, ownerKind, buildDealTodos, OWNER_VP, type Rec } from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";

export default function EspressoPage() {
  const { records, vps, rsds, playbook, filtered } = useDashboard();
  const { done, toggle } = useTodoDone();
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
                <DealBlock key={`${b.oid}-${i}`} b={b} done={done} toggle={toggle} showVp={vps.length !== 1} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DealBlock({ b, done, toggle, showVp }: { b: any; done: Set<string>; toggle: (id: string) => void; showVp: boolean }) {
  const { h } = b;
  const vpMeta = showVp && OWNER_VP[h.owner_name] ? ` (${OWNER_VP[h.owner_name]})` : "";
  const closeMeta = h.close_date
    ? <> · close {h.close_date}{b.dc != null ? (b.dc < 0 ? <> · <span className="od">past close</span></> : ` · ${b.dc}d`) : ""}</>
    : "";
  return (
    <div className="deal-blk">
      <div className="deal-h"><span className="nm">{h.account_name || h.opp_name || h.opp_id}</span><span className="amt">{fmtAmount(h.amount)}</span></div>
      <div className="deal-sub">{h.opp_name || ""} · {h.owner_name || ""}{vpMeta} · {h.stage || ""}{closeMeta}</div>
      {b.groups.map((g: any) => (
        <div key={g.key}>
          <div className={`todo-grp ${g.tone}`}>{g.label} <span className="c">{g.items.length}</span></div>
          <ul className="todo-list">
            {g.items.map((it: any, idx: number) => {
              const isDone = done.has(it.id);
              return (
                <li className={`todo-item ${isDone ? "done" : ""}`} key={`${it.id}-${idx}`}>
                  <input type="checkbox" checked={isDone} onChange={() => toggle(it.id)} />
                  <div className="td-body">
                    <div className="td-txt">{it.text}</div>
                    <div className="td-meta">
                      {it.owner ? <span className={`ownerchip ${ownerKind(it.owner) === "VP" ? "vp" : ""}`}>{it.owner}</span> : null}
                      {it.meta ? <span className="ownerchip">{it.meta}</span> : null}
                      {it.due ? <span className={`duechip ${it.due.cls}`}>{it.due.txt}</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {b.plays.length ? (
        <div className="plays">
          <div className="plays-h">Winning plays from similar wins</div>
          {b.plays.map(({ p, beats }: any, i: number) => (
            <details className="play" key={i}>
              <summary>{p.title}{beats.length ? <span className="beats">beats {beats.join(", ")}</span> : null}</summary>
              <div className="play-g">{p.guidance}</div>
              {p.proof && p.proof[0] ? <div className="play-proof">won at {p.proof[0].account}{p.proof[0].date ? " · " + p.proof[0].date : ""}</div> : null}
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
