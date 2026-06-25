"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { daysSince, fmtAmount, teamOwners, stageRank, clipWords, type Rec } from "@/lib/engine/helpers";
import DealDrawer from "@/components/deals/DealDrawer";
import { useBackendTodos } from "@/lib/engine/useBackendTodos";
import { topMoveForOpp, replanDue } from "@/components/deals/DealTodos";

const TARGET = 4000000;
const NM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function MatchaPage() {
  const { records, vps, rsds, filtered, playbook } = useDashboard();
  const [selected, setSelected] = useState<Rec | null>(null);
  const backend = useBackendTodos(); // to surface each stalled deal's next move
  const hard = filtered.map((r) => r.hard || {});

  const owners = teamOwners(records, vps);
  const scopeOwners = rsds.length ? rsds : owners;

  // coverage tiles
  const tiles = scopeOwners.map((o) => {
    const deals = hard.filter((h) => h.owner_name === o);
    const val = deals.reduce((s, h) => s + (Number(h.amount) || 0), 0);
    const ok = val >= TARGET;
    const pct = TARGET > 0 ? Math.round((100 * val) / TARGET) : 0; // true coverage %
    const p = Math.min(100, pct);                                  // bar width caps at 100
    return { o, count: deals.length, val, ok, p, pct };
  });

  // by stage — ordered exactly like the Salesforce Opportunity StageName picklist
  const stMap: Record<string, { n: number; v: number }> = {};
  hard.forEach((h) => { const s = h.stage || "Other"; (stMap[s] = stMap[s] || { n: 0, v: 0 }); stMap[s].n++; stMap[s].v += Number(h.amount) || 0; });
  const order = Object.keys(stMap).sort((a, b) => { const d = stageRank(a) - stageRank(b); return d !== 0 ? d : a.localeCompare(b); });
  const maxV = Math.max(1, ...Object.values(stMap).map((o) => o.v));

  // NAA by month
  const naa: Record<string, { n: number; v: number }> = {};
  hard.forEach((h) => { const q = h.qualified_date; if (!q) return; const ym = q.slice(0, 7); (naa[ym] = naa[ym] || { n: 0, v: 0 }); naa[ym].n++; naa[ym].v += Number(h.amount) || 0; });
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(2026, 5 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const maxN = Math.max(1, ...months.map((m) => (naa[m] || { n: 0 }).n));
  const mlabel = (ym: string) => { const [y, mo] = ym.split("-"); return NM[+mo - 1] + " '" + y.slice(2); };
  const older = Object.entries(naa).filter(([m]) => !months.includes(m)).reduce((s, [, o]) => s + o.n, 0);

  // Stalled at Qualified — measured by days since the last *logged* activity.
  // Salesforce LastActivityDate only reflects COMPLETED tasks/events, so a deal
  // with only open/planned tasks has a null activity date. Fall back to the
  // qualified (then last-modified) date so we measure a REAL untouched age
  // rather than emitting a sentinel — and so brand-new deals aren't flagged.
  const stale = filtered
    .map((r) => ({ r, h: r.hard || {} }))
    .filter(({ h }) => (h.stage || "") === "Qualified")
    .map(({ r, h }) => {
      const sinceActivity = daysSince(h.last_activity_date);
      const refDays = sinceActivity ?? daysSince(h.qualified_date) ?? daysSince(h.last_modified_date);
      return { r, h, sinceActivity, refDays };
    })
    .filter((x) => x.refDays != null && x.refDays > 30)
    .sort((a, b) => (b.refDays as number) - (a.refDays as number));

  if (!records.length) return <div className="empty-s">No swept records yet.</div>;

  return (
    <div id="matchaview">
      <div className="todo-top"><div className="ttl">Pipeline health. Coverage target is <b>$4M</b> of open pipeline per RSD.</div></div>

      <div className="tiles">
        {tiles.map(({ o, count, val, ok, p, pct }) => (
          <div className="covcard" key={o} data-state={ok ? "ok" : "warn"}>
            <div className="covcard-top">
              <div className="covcard-amount" title={fmtAmount(val)}>{fmtAmount(val)}</div>
              <span className={`pill ${ok ? "good" : "warn"}`}>{ok ? "adequate" : "inadequate"}</span>
            </div>
            <div className="covcard-owner" title={o}>{o}</div>
            <div className="covcard-sub">{count} open deal{count === 1 ? "" : "s"}</div>
            <div className="covcard-track"><div className="covcard-fill" style={{ width: `${p}%` }} /></div>
            <div className="covcard-foot">
              <span className="covcard-pct">{pct}% of $4M</span>
              <span className="covcard-gap">{ok ? "✓ on target" : `short ${fmtAmount(TARGET - val)}`}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="sec-title">Deals by stage</div>
      <div className="card"><div className="bars">
        {order.map((s) => (
          <div className="bar" key={s}>
            <span className="lab">{s} ({stMap[s].n})</span>
            <div className="track"><div className="fill" style={{ width: `${Math.round((100 * stMap[s].v) / maxV)}%` }} /></div>
            <span className="val">{fmtAmount(stMap[s].v)}</span>
          </div>
        ))}
      </div></div>

      <div className="sec-title">New opportunities added by month (moved to Qualified)</div>
      <div className="card">
        <div className="bars">
          {months.map((m) => { const o = naa[m] || { n: 0, v: 0 }; return (
            <div className="bar" key={m}>
              <span className="lab">{mlabel(m)}</span>
              <div className="track"><div className="fill" style={{ width: `${Math.round((100 * o.n) / maxN)}%` }} /></div>
              <span className="val">{o.n} deal{o.n === 1 ? "" : "s"} · {fmtAmount(o.v)}</span>
            </div>
          ); })}
        </div>
        {older ? <div className="td-meta" style={{ marginTop: 8 }}>Plus {older} qualified before this 12-month window.</div> : null}
      </div>

      <div className="sec-title">Stalled at Qualified — not touched in 30+ days <span style={{ color: "var(--muted)" }}>({stale.length})</span></div>
      <div className="card"><ul className="ilist">
        {stale.length ? stale.map(({ r, h, sinceActivity, refDays }) => {
          // The intelligent next move to un-stall this deal: the backend's rank-1 move if it
          // has one, else a synthesized re-engage play. Always a future due date.
          const silent = sinceActivity ?? refDays;
          const move = topMoveForOpp(backend.flat, r.opp_id) || {
            text: `Re-engage the buyer (${silent != null ? `${silent}d` : "30+d"} silent): book a checkpoint, re-confirm the next milestone and decision timeline, and reset a mutual close plan.`,
            dueBy: replanDue(silent != null && silent > 60),
          };
          return (
            <li key={h.opp_id} className="click" onClick={() => setSelected(r)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r); } }}
              title="Open deal">
              <div className="top"><span className="nm">{h.account_name} <span className="meta">· {h.opp_name}</span></span><span className="amt">{fmtAmount(h.amount)}</span></div>
              <div className="meta">{h.owner_name} · qualified {h.qualified_date || "?"} · {h.last_activity_date
                ? `last activity ${h.last_activity_date} (${sinceActivity} days ago)`
                : `no activity logged${refDays != null ? ` · ${refDays}d untouched` : ""}`}</div>
              <div className="why" style={{ marginTop: 5 }}>
                <b>► Next:</b> {clipWords(move.text, 18)}
                {move.dueBy ? <span className="duechip" style={{ marginLeft: 6 }}>due {move.dueBy}</span> : null}
              </div>
            </li>
          );
        }) : <div className="empty-s">No Qualified deals sitting untouched. Momentum is being held.</div>}
      </ul></div>

      <DealDrawer record={selected} records={records} playbook={playbook} onClose={() => setSelected(null)} />
    </div>
  );
}
