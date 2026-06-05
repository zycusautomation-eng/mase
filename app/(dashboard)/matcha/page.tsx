"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useDashboard } from "@/lib/engine/DashboardContext";
import { daysSince, fmtAmount, teamOwners, stageRank } from "@/lib/engine/helpers";

const TARGET = 4000000;
const NM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function MatchaPage() {
  const { records, vps, rsds, filtered } = useDashboard();
  const hard = filtered.map((r) => r.hard || {});

  const owners = teamOwners(records, vps);
  const scopeOwners = rsds.length ? rsds : owners;

  // coverage tiles
  const tiles = scopeOwners.map((o) => {
    const deals = hard.filter((h) => h.owner_name === o);
    const val = deals.reduce((s, h) => s + (Number(h.amount) || 0), 0);
    const ok = val >= TARGET;
    const p = Math.min(100, Math.round((100 * val) / TARGET));
    return { o, count: deals.length, val, ok, p };
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

  // stalled at Qualified
  const stale = hard.filter((h) => (h.stage || "") === "Qualified" && daysSince(h.last_activity_date) > 30)
    .sort((a, b) => daysSince(b.last_activity_date) - daysSince(a.last_activity_date));

  if (!records.length) return <div className="empty-s">No swept records yet.</div>;

  return (
    <div id="matchaview">
      <div className="todo-top"><div className="ttl">Pipeline health. Coverage target is <b>$4M</b> of open pipeline per RSD.</div></div>

      <div className="tiles">
        {tiles.map(({ o, count, val, ok, p }) => (
          <div className="card cov" key={o} style={{ ["--c" as any]: ok ? "var(--green)" : "var(--amber)" }}>
            <div className="row"><div className="big">{fmtAmount(val)}</div><span className={`pill ${ok ? "good" : "warn"}`}>{ok ? "adequate" : "inadequate"}</span></div>
            <div className="lab">{o} — {count} open deals</div>
            <div className="bars" style={{ marginTop: 8 }}>
              <div className="bar">
                <span className="lab">vs $4M</span>
                <div className="track"><div className="fill" style={{ width: `${p}%`, background: ok ? "var(--green)" : "var(--amber)" }} /></div>
                <span className="val">{p}%{ok ? "" : ` · short ${fmtAmount(TARGET - val)}`}</span>
              </div>
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
        {stale.length ? stale.map((h) => (
          <li key={h.opp_id}>
            <div className="top"><span className="nm">{h.account_name} <span className="meta">· {h.opp_name}</span></span><span className="amt">{fmtAmount(h.amount)}</span></div>
            <div className="meta">{h.owner_name} · qualified {h.qualified_date || "?"} · last activity {h.last_activity_date || "none"} ({daysSince(h.last_activity_date)} days ago)</div>
          </li>
        )) : <div className="empty-s">No Qualified deals sitting untouched. Momentum is being held.</div>}
      </ul></div>
    </div>
  );
}
