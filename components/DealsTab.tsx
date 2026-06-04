"use client";
import { useState } from "react";
import { dealEngine } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { DealRecord, RecommendedMove } from "@/lib/types";
import { money, dateStr, tone } from "@/lib/format";
import { Loading, ErrorBanner, Empty } from "./states";

export default function DealsTab({ owner }: { owner: string }) {
  const { data, loading, error, reload } = useAsync(() => dealEngine.opportunities(owner), [owner]);
  const [selected, setSelected] = useState<DealRecord | null>(null);

  if (loading) return <Loading label="Loading deals…" />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data || data.count === 0) {
    return <Empty title="No deals in the book yet" hint="When the backend is populated, opportunities will appear here." />;
  }

  if (selected) return <DealDetail deal={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table>
        <thead>
          <tr>
            <th>Account / Opportunity</th>
            <th>Owner</th>
            <th>Stage</th>
            <th>Verdict</th>
            <th className="num">Amount</th>
            <th className="num">Close</th>
          </tr>
        </thead>
        <tbody>
          {data.records.map((d) => {
            const v = d.ai?.north_star_verdict?.verdict;
            return (
              <tr className="row" key={d.opp_id} onClick={() => setSelected(d)}>
                <td>
                  <div style={{ fontWeight: 600 }}>{d.hard?.account_name || "—"}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{d.hard?.opp_name || d.opp_id}</div>
                </td>
                <td>{d.hard?.owner_name || "—"}</td>
                <td>{d.hard?.stage || "—"}</td>
                <td>{v ? <span className={`badge ${tone(v)}`}>{v}</span> : <span className="muted">—</span>}</td>
                <td className="num">{money(d.hard?.amount)}</td>
                <td className="num">{dateStr(d.hard?.close_date)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DealDetail({ deal, onBack }: { deal: DealRecord; onBack: () => void }) {
  const { hard, ai } = deal;
  const verdict = ai?.north_star_verdict;
  const moves: RecommendedMove[] = ai?.recommended_moves?.items ?? [];

  return (
    <div>
      <button className="detail-back" onClick={onBack}>
        ← Back to deals
      </button>

      <div className="card">
        <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>{hard?.account_name || deal.opp_id}</h2>
        <div className="muted" style={{ marginBottom: 12 }}>{hard?.opp_name}</div>
        <dl className="kv">
          <dt>Owner</dt><dd>{hard?.owner_name || "—"}</dd>
          <dt>Stage</dt><dd>{hard?.stage || "—"}</dd>
          <dt>Forecast</dt><dd>{hard?.forecast_category || "—"}</dd>
          <dt>Amount</dt><dd>{money(hard?.amount)}</dd>
          <dt>Close date</dt><dd>{dateStr(hard?.close_date)}</dd>
          <dt>Last activity</dt><dd>{dateStr(hard?.last_activity_date)}</dd>
          <dt>AI status</dt><dd>{hard?.ais_status ? <span className={`badge ${tone(hard.ais_status)}`}>{hard.ais_status}</span> : "—"}</dd>
          <dt>Confidence</dt><dd>{deal.analysis_confidence || "—"}</dd>
        </dl>
      </div>

      {verdict && (verdict.verdict || verdict.headline) && (
        <div className="card">
          <div className="section-title">
            North Star Verdict
            {verdict.verdict && <span className={`badge ${tone(verdict.verdict)}`}>{verdict.verdict}</span>}
          </div>
          {verdict.headline && <p style={{ margin: 0 }}>{verdict.headline}</p>}
        </div>
      )}

      {moves.length > 0 && (
        <div className="card">
          <div className="section-title">Recommended Moves <span className="count">{moves.length}</span></div>
          {moves
            .slice()
            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
            .map((m, i) => (
              <div className="move" key={i}>
                <div>
                  {m.rank != null && <span className="rank">#{m.rank}</span>}
                  {m.action || "—"}
                </div>
                {(m.owner || m.trigger || m.trigger_date || m.expected_effect) && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                    {m.owner && <>Owner: {m.owner}. </>}
                    {m.trigger && <>Trigger: {m.trigger}{m.trigger_date ? ` (${m.trigger_date})` : ""}. </>}
                    {m.expected_effect && <>Effect: {m.expected_effect}.</>}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
