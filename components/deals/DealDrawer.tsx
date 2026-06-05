"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  buildDealTodos, dealMeddpicc, cleanText, fmtAmount, verdictTone, daysSince, ownerKind,
  dealComps, type Rec, type MeddItem,
} from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";

// Trim prose to ~n chars on a sentence/word boundary — keeps every block "two cents".
function trim(s: any, n = 220): string {
  const t = cleanText(s);
  if (!t || t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (stop > n * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "")) + "…";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Meddpicc({ items }: { items: MeddItem[] }) {
  const gaps = items.filter((m) => m.state !== "have");
  return (
    <div className="medd">
      <div className="medd-row">
        {items.map((m) => (
          <span key={m.dim} className={`medd-chip ${m.state}`} title={m.note}>{m.dim}</span>
        ))}
      </div>
      {gaps.length ? (
        <ul className="medd-gaps">
          {gaps.map((m) => (
            <li key={m.dim}><b>{m.dim}:</b> {m.note}</li>
          ))}
        </ul>
      ) : <div className="body" style={{ marginTop: 6 }}>All MEDDPICC dimensions covered.</div>}
    </div>
  );
}

export default function DealDrawer({
  record, records, playbook, onClose,
}: { record: Rec | null; records: Rec[]; playbook: any; onClose: () => void }) {
  const { done, toggle } = useTodoDone();
  const open = !!record;
  const h = record?.hard || {};
  const ai = record?.ai || {};

  const verdict = ai.north_star_verdict || {};
  const todos = record ? buildDealTodos(record, records || [], playbook) : null;
  const medd = record ? dealMeddpicc(record) : [];
  const champ = ai.champion_strength || {};
  const fit = ai.ai_fit_signal || {};
  const pos = ai.ai_positioning_strength || {};
  const stake = (ai.stakeholder_map || {}).items || [];
  const openVulns = ((ai.vulnerabilities || {}).items || []).filter((v: any) => v.status !== "closed");
  const blocker = openVulns[0];
  const overdue = typeof h.days_to_close === "number" && h.days_to_close < 0;
  const lastDays = daysSince(h.last_activity_date);

  // AI Excitement: SF fields first, topped up by the analyst's AI read.
  const aiCategory = (h.ais_status && h.ais_status !== "—" ? h.ais_status : "") || fit.tier || "";
  const aiScore = h.ais_score != null && h.ais_score !== "" ? `${h.ais_score}/10` : "";
  const aiWhy = (h.ais_why && h.ais_why !== "—") ? h.ais_why : "";

  // Competitors: trust the call evidence over the (often empty) SF field.
  const compSummary = (ai.competitive_position || {}).summary || "";
  const compNames = dealComps(h);

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
                {`${h.stage || ""} · ${h.forecast_category || ""} · ${fmtAmount(h.amount)} · ${h.owner_name || ""}`}
                {h.sf_link ? <> · <a href={h.sf_link} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Salesforce ↗</a></> : null}
              </div>
            </div>

            <div className="dbody">
              {/* Verdict + one-line why */}
              {verdict.verdict ? (
                <Section title="Verdict">
                  <div><span className={`chip ${verdictTone(verdict.verdict)}`}>{verdict.verdict}</span></div>
                  {verdict.math ? <div className="body" style={{ marginTop: 6 }}>{trim(verdict.math, 260)}</div> : null}
                </Section>
              ) : null}

              {/* The one blocker */}
              {blocker ? (
                <Section title="The blocker">
                  <div className="headline">{trim(blocker.detail, 260)}</div>
                  {blocker.category ? <div className="td-meta" style={{ marginTop: 4 }}><span className="duechip heavy">{String(blocker.category).replace(/_/g, " ")}</span>{blocker.first_raised ? <span className="ownerchip">raised {blocker.first_raised}</span> : null}</div> : null}
                </Section>
              ) : null}

              {/* To-dos — IDENTICAL to this deal's Espresso to-dos (shared builder + done state) */}
              <Section title="To-dos">
                {todos ? (
                  <>
                    <div className="td-meta" style={{ marginBottom: 8 }}>
                      <span className="ownerchip vp">{todos.tier.label.split(" —")[0]}</span>
                      <span className="td-meta">{todos.deep ? "Forecast deal — full plan" : "Qualified — focus on discovery & engagement"}</span>
                    </div>
                    <ul className="todo-list">
                      {todos.items.map((it) => {
                        const isDone = done.has(it.id);
                        return (
                          <li className={`todo-item ${isDone ? "done" : ""}`} key={it.id}>
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
                    {todos.deep && todos.plays.length ? (
                      <div className="plays">
                        <div className="plays-h">Winning plays from similar wins</div>
                        {todos.plays.map(({ p, beats }: any, i: number) => (
                          <details className="play" key={i}>
                            <summary>{p.title}{beats.length ? <span className="beats">beats {beats.join(", ")}</span> : null}</summary>
                            <div className="play-g">{p.guidance}</div>
                          </details>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="body">No active to-dos — this deal isn&apos;t in a forecast or qualified-pipeline tier.</div>
                )}
              </Section>

              {/* AI Excitement (SF score/category/why + analyst top-up) */}
              {(aiCategory || aiScore || aiWhy || fit.summary || pos.summary) ? (
                <Section title="AI Excitement">
                  {(aiCategory || aiScore) ? (
                    <div style={{ marginBottom: 6 }}>
                      {aiCategory ? <span className="chip v-on">{aiCategory}</span> : null}
                      {aiScore ? <span className="ownerchip" style={{ marginLeft: 6 }}>{aiScore}</span> : null}
                    </div>
                  ) : null}
                  {aiWhy ? <div className="body">{trim(aiWhy, 240)}</div> : (fit.summary ? <div className="body">{trim(fit.summary, 240)}</div> : null)}
                  {pos.under_positioned && pos.summary ? <div className="td-meta" style={{ marginTop: 6 }}><b>Under-positioned:</b> {trim(pos.summary, 180)}</div> : null}
                </Section>
              ) : null}

              {/* Champion */}
              {(champ.champion || champ.summary) ? (
                <Section title="Champion">
                  <div style={{ marginBottom: 4 }}>
                    {champ.champion ? <span className="ownerchip vp">{champ.champion}</span> : null}
                    {champ.strength ? <span className={`duechip ${champ.at_risk ? "heavy" : ""}`}>{champ.strength}</span> : null}
                  </div>
                  {champ.summary ? <div className="body">{trim(champ.summary, todos?.deep ? 280 : 160)}</div> : null}
                </Section>
              ) : null}

              {/* Stakeholders + MEDDPICC (evidence-based, not just SF flags) */}
              <Section title="Stakeholders & MEDDPICC">
                {stake.length ? (
                  <table className="itab" style={{ marginBottom: 10 }}>
                    <thead><tr><th>Name</th><th>Role</th><th>Read</th></tr></thead>
                    <tbody>
                      {stake.map((s: any, i: number) => (
                        <tr key={i}>
                          <td className="owner">{s.name}{s.title ? <div className="td-meta">{s.title}</div> : null}</td>
                          <td>{s.role || "—"}</td>
                          <td>{trim(s.sentiment, 160)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                <Meddpicc items={medd} />
              </Section>

              {/* Money & dates that are real */}
              <Section title="Money & dates">
                <div className="kvgrid">
                  <div><div className="k">Amount</div><div className="val">{fmtAmount(h.amount)}</div></div>
                  <div><div className="k">Stage / forecast</div><div className="val">{(h.stage || "—") + " · " + (h.forecast_category || "—")}</div></div>
                  <div><div className="k">Close date</div><div className="val">{h.close_date || "—"}{overdue ? <span className="duechip heavy" style={{ marginLeft: 6 }}>{Math.abs(h.days_to_close)}d overdue</span> : null}</div></div>
                  <div><div className="k">Last activity</div><div className="val">{h.last_activity_date || "none"}{h.last_activity_date ? ` · ${lastDays}d ago` : ""}</div></div>
                </div>
              </Section>

              {/* Competitors */}
              <Section title="Competitors">
                {compNames.length ? <div style={{ marginBottom: 6 }}>{compNames.map((c) => <span className="chip" key={c} style={{ marginRight: 6 }}>{c}</span>)}</div> : null}
                {compSummary ? <div className="body">{trim(compSummary, 240)}</div> : (!compNames.length ? <div className="body">None logged.</div> : null)}
              </Section>
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
