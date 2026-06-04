"use client";
import { dealEngine } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { money, dateStr } from "@/lib/format";
import { Loading, ErrorBanner, Empty } from "./states";

export default function MatchaTab({ owner }: { owner: string }) {
  const { data, loading, error, reload } = useAsync(() => dealEngine.matcha(owner), [owner]);

  if (loading) return <Loading label="Loading pipeline health…" />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <Empty title="No pipeline data" />;

  const hasAnything =
    data.coverage.length > 0 ||
    Object.keys(data.byStage).length > 0 ||
    Object.keys(data.naaByMonth).length > 0 ||
    data.stalledAtQualified.length > 0;

  if (!hasAnything) {
    return <Empty title="No pipeline health to show" hint={`Coverage target ${money(data.target)} per RSD. Charts populate when deals exist.`} />;
  }

  const stageRows = Object.entries(data.byStage);
  const maxStageAmt = Math.max(1, ...stageRows.map(([, s]) => s.amount));
  const naaRows = Object.entries(data.naaByMonth).sort(([a], [b]) => a.localeCompare(b));
  const maxNaa = Math.max(1, ...naaRows.map(([, c]) => c));

  return (
    <div className="grid">
      {/* Coverage vs target */}
      {data.coverage.length > 0 && (
        <div className="card">
          <div className="section-title">Coverage vs target <span className="count">target {money(data.target)}</span></div>
          {data.coverage.map((c) => {
            const pct = Math.min(100, (c.open_amount / (c.target || 1)) * 100);
            const bad = c.status === "inadequate";
            return (
              <div className="bar-row" key={c.owner}>
                <span>{c.owner}</span>
                <div className="bar-wrap">
                  <div className={`bar-fill ${bad ? "bad" : ""}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="num">
                  {money(c.open_amount)} <span className={`badge ${bad ? "amber" : "green"}`}>{c.status}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Stage funnel */}
      {stageRows.length > 0 && (
        <div className="card">
          <div className="section-title">By stage</div>
          {stageRows.map(([stage, s]) => (
            <div className="bar-row" key={stage}>
              <span>{stage}</span>
              <div className="bar-wrap">
                <div className="bar-fill" style={{ width: `${(s.amount / maxStageAmt) * 100}%` }} />
              </div>
              <span className="num">{money(s.amount)} · {s.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* NAA by month */}
      {naaRows.length > 0 && (
        <div className="card">
          <div className="section-title">New deals by qualified month</div>
          {naaRows.map(([month, count]) => (
            <div className="bar-row" key={month}>
              <span>{month}</span>
              <div className="bar-wrap">
                <div className="bar-fill" style={{ width: `${(count / maxNaa) * 100}%` }} />
              </div>
              <span className="num">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stalled deals */}
      {data.stalledAtQualified.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="section-title" style={{ padding: "14px 18px 0" }}>
            Stalled at Qualified <span className="count">{data.stalledAtQualified.length}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Owner</th>
                <th className="num">Amount</th>
                <th className="num">Last activity</th>
                <th className="num">Days idle</th>
              </tr>
            </thead>
            <tbody>
              {data.stalledAtQualified.map((s) => (
                <tr key={s.opp_id}>
                  <td>{s.account_name || s.opp_name || s.opp_id}</td>
                  <td>{s.owner_name || "—"}</td>
                  <td className="num">{money(s.amount)}</td>
                  <td className="num">{dateStr(s.last_activity_date)}</td>
                  <td className="num">{s.days_since_activity ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
