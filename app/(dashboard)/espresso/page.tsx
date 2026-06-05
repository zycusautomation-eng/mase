"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import {
  TIERS, fmtAmount, slug, heavyStep, backPlannedDue, fmtDue, diffDays, refToday,
  ownerKind, matchPlays, type Rec,
} from "@/lib/engine/helpers";

const DONE_KEY = "deal_engine_todo_done";
function loadDone(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]")); } catch { return new Set(); }
}

export default function EspressoPage() {
  const { records, vp, rsd, playbook, filtered } = useDashboard();
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [activeTier, setActiveTier] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(DONE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const who = rsd !== "all" ? rsd : vp !== "all" ? `${vp}'s team` : "all VPs";

  // Build tiers -> deals -> items, mirroring dealBlock/renderTodo.
  const tiers = useMemo(() => {
    return TIERS.map((tier) => {
      let deals = filtered.filter((r: Rec) => tier.match(r.hard || {}));
      if (!deals.length) return null;
      deals = deals.sort((a, b) => (Number((b.hard || {}).amount) || 0) - (Number((a.hard || {}).amount) || 0));
      const blocks = deals.map((r: Rec) => {
        const h = r.hard || {}, ai = r.ai || {};
        const dn = h.account_name || h.opp_name || h.opp_id, oid = h.opp_id;
        const moves = ((ai.recommended_moves || {}).items || []).slice()
          .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99)).slice(0, tier.cap);
        const total = moves.length;
        const items = moves.map((m: any, idx: number) => {
          const t = (m.action || "").trim();
          if (!t) return null;
          const id = oid + ":" + slug(dn + "|" + t);
          const heavy = heavyStep(m.action);
          const due = heavy ? { txt: "confirm timeline", cls: "heavy" }
            : (h.close_date ? { txt: `due ${fmtDue(backPlannedDue(records, h.close_date, idx, total))}`, cls: "" } : null);
          return { id, text: t, owner: m.owner, due };
        }).filter(Boolean) as any[];
        if (!items.length) return null;
        const dc = diffDays(refToday(records), h.close_date);
        const plays = matchPlays(playbook, h, tier.key === "qualified" ? 1 : 2);
        return { oid, dn, h, items, dc, plays };
      }).filter(Boolean) as any[];
      if (!blocks.length) return null;
      const totalVal = deals.reduce((s, r) => s + (Number((r.hard || {}).amount) || 0), 0);
      return { tier, deals, blocks, totalVal };
    }).filter(Boolean) as any[];
  }, [filtered, records, playbook]);

  const { total, doneCount } = useMemo(() => {
    let t = 0, d = 0;
    for (const tg of tiers) for (const b of tg.blocks) for (const it of b.items) { t++; if (done.has(it.id)) d++; }
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

          {shown ? (
            <div className={`tier ${shown.tier.key}`}>
              {shown.blocks.map((b: any, i: number) => (
                <DealBlock key={`${b.oid}-${i}`} b={b} done={done} toggle={toggle} vp={vp} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DealBlock({ b, done, toggle, vp }: { b: any; done: Set<string>; toggle: (id: string) => void; vp: string }) {
  const { h } = b;
  const vpMeta = vp === "all" && h.manager_name ? ` (${h.manager_name})` : "";
  const closeMeta = h.close_date
    ? <> · close {h.close_date}{b.dc != null ? (b.dc < 0 ? <> · <span className="od">past close</span></> : ` · ${b.dc}d`) : ""}</>
    : "";
  return (
    <div className="deal-blk">
      <div className="deal-h"><span className="nm">{h.account_name || h.opp_name || h.opp_id}</span><span className="amt">{fmtAmount(h.amount)}</span></div>
      <div className="deal-sub">{h.opp_name || ""} · {h.owner_name || ""}{vpMeta} · {h.stage || ""}{closeMeta}</div>
      <ul className="todo-list">
        {b.items.map((it: any, idx: number) => {
          const isDone = done.has(it.id);
          return (
            <li className={`todo-item ${isDone ? "done" : ""}`} key={`${it.id}-${idx}`}>
              <input type="checkbox" checked={isDone} onChange={() => toggle(it.id)} />
              <div className="td-body">
                <div className="td-txt">{it.text}</div>
                <div className="td-meta">
                  {it.owner ? <span className={`ownerchip ${ownerKind(it.owner) === "VP" ? "vp" : ""}`}>{it.owner}</span> : null}
                  {it.due ? <span className={`duechip ${it.due.cls}`}>{it.due.txt}</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
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
