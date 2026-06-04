"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AI_ORDER, HARD_LABELS, cleanText, cleanVal, fmtAmount, verdictTone, type Rec } from "@/lib/engine/helpers";

function ItemsTable({ items }: { items: any[] }) {
  if (!items || !items.length) return null;
  const keys = [...items.reduce((s: Set<string>, it: any) => { Object.keys(it).forEach((k) => s.add(k)); return s; }, new Set<string>())];
  return (
    <table className="itab">
      <thead><tr>{keys.map((k) => <th key={k}>{k}</th>)}</tr></thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i}>
            {keys.map((k) => (
              <td key={k} className={k === "owner" ? "owner" : undefined}>{it[k] == null ? "" : String(it[k])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EvidenceBlock({ ev }: { ev: any[] }) {
  if (!ev || !ev.length) return null;
  return (
    <details className="evid">
      <summary>Evidence ({ev.length})</summary>
      {ev.map((e, i) => {
        const tag = (e.kind || "").replace("_", " ");
        const meta = [e.ref, e.speaker, e.date].filter(Boolean).join(" · ");
        return (
          <div className="ev" key={i}>
            <span className="tag">{tag}</span>{meta}
            {e.quote ? <div className="q">“{e.quote}”</div> : null}
          </div>
        );
      })}
    </details>
  );
}

function AiCard({ label, cell }: { label: string; cell: any }) {
  if (!cell) return null;
  return (
    <div className="card">
      <h3>{label}</h3>
      {cell.verdict ? <div><span className={`chip ${verdictTone(cell.verdict)}`}>{cell.verdict}</span></div> : null}
      {cell.headline ? <div className="headline">{cleanText(cell.headline)}</div> : null}
      {cell.body ? <div className="body">{cleanText(cell.body)}</div> : null}
      {cell.items && cell.items.length ? <ItemsTable items={cell.items} /> : null}
      {cell.flags && cell.flags.length ? (
        <div className="flags">{cell.flags.map((f: string, i: number) => <span className="flag" key={i}>{f}</span>)}</div>
      ) : null}
      <EvidenceBlock ev={cell.evidence} />
    </div>
  );
}

export default function DealDrawer({ record, onClose }: { record: Rec | null; onClose: () => void }) {
  const open = !!record;
  const h = record?.hard || {};
  const ai = record?.ai || {};
  const SKIP = new Set(["sf_link"]);

  return (
    <>
      <div className={`overlay ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`}>
        {record ? (
          <>
            <div className="dhead">
              <span className="closex" onClick={onClose}>×</span>
              <h2>{(h.account_name || "") + " — " + (h.opp_name || record.opp_id)}</h2>
              <div className="meta">
                {`${h.stage || ""} · ${h.forecast_category || ""} · ${fmtAmount(h.amount)} · close ${h.close_date || "?"} (${h.days_to_close} days) · ${h.owner_name || ""}`}
                {h.sf_link ? <> · <a href={h.sf_link} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Salesforce ↗</a></> : null}
                {` · swept ${record.swept_at || "?"}`}
              </div>
            </div>
            <div className="dbody">
              <div className="sec-title">Deal facts</div>
              <div className="hardgrid">
                {Object.keys(HARD_LABELS).filter((k) => !SKIP.has(k)).map((k) => {
                  let v: any = h[k];
                  if (k === "amount") v = fmtAmount(v);
                  else if (typeof v === "boolean") v = v ? "Yes" : "No";
                  else v = cleanVal(v);
                  return (
                    <div key={k}>
                      <div className="k">{HARD_LABELS[k]}</div>
                      <div className="val">{v}</div>
                    </div>
                  );
                })}
              </div>
              <div className="sec-title">The read</div>
              {AI_ORDER.map(([k, label]) => <AiCard key={k} label={label} cell={ai[k]} />)}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
