"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import {
  dealMeddpicc, cleanText, fmtAmount, verdictTone, daysSince, dealTier,
  dealComps, type Rec, type MeddItem,
} from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { useTodoSync } from "@/lib/engine/useTodoSync";
import { useBackendTodos, type BackendTodoItem } from "@/lib/engine/useBackendTodos";
import { DealTodoBuckets, bucketsForOpp, sfKey } from "@/components/deals/DealTodos";
import { pulseChip, isPulseLive, flagContradictsLivePulse, type PulseLike } from "@/lib/engine/pulse";

// Show the full insight — no truncation. The v2 sweep produces decision-grade prose and
// the CSS wraps it (.card .body is pre-wrap, .itab td is white-space:normal), so we render
// the cleaned text in full. (Signature kept so call sites can pass the old length arg.)
function trim(s: any, _n = 220): string {
  return cleanText(s);
}

// Fit prose to at most n words (no ellipsis) — used for the 60-word combined risk read.
function wordCap(s: any, n: number): string {
  const t = cleanText(s);
  if (!t) return "";
  const w = t.split(/\s+/).filter(Boolean);
  return w.length <= n ? t : w.slice(0, n).join(" ");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// Rich MEDDPICC from the backend ai.meddpicc block: 8 elements, fixed order, each with
// a status badge + a multi-sentence narrative + evidence sources. This is the real read;
// the legacy derived <Meddpicc> below is only a fallback for deals not yet re-swept.
const MEDDPICC_ORDER: [string, string][] = [
  ["metrics", "Metrics"],
  ["economic_buyer", "Economic Buyer"],
  ["decision_criteria", "Decision Criteria"],
  ["decision_process", "Decision Process"],
  ["paper_process", "Paper Process"],
  ["identify_pain", "Identify Pain"],
  ["champion", "Champion"],
  ["competition", "Competition"],
];
// status -> the existing medd-chip tone classes (have=green, weak=amber, gap=red).
const MEDD_BADGE: Record<string, string> = { confirmed: "have", partial: "weak", gap: "gap" };

function MeddpiccRich({ meddpicc }: { meddpicc: any }) {
  return (
    <div className="medd-rich">
      {MEDDPICC_ORDER.map(([key, label]) => {
        const el = meddpicc?.[key];
        if (!el) return null;
        const tone = MEDD_BADGE[el.status] || "gap";
        return (
          <div className="medd-el" key={key}>
            <div className="medd-el-h">
              <span className="medd-el-name">{label}</span>
              <span className={`medd-chip ${tone}`}>{el.status || "gap"}</span>
            </div>
            {el.narrative ? <div className="body">{cleanText(el.narrative)}</div> : null}
            {Array.isArray(el.sources) && el.sources.length ? (
              <details className="medd-src">
                <summary>Sources ({el.sources.length})</summary>
                <ul>{el.sources.map((s: string, i: number) => <li key={i}>{cleanText(s)}</li>)}</ul>
              </details>
            ) : null}
          </div>
        );
      })}
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

// Log a new update on the opportunity as a COMPLETED item: a free-text note + the
// date it was done. Persists via /todo/update (creates a completed Salesforce Task
// and stores it in-app), then shows immediately under "Recently completed".
function AddUpdateForm({ oppId, backend }: { oppId: string; backend: ReturnType<typeof useBackendTodos> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [doneDate, setDoneDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true); setMsg(null);
    const r = await backend.addUpdate(oppId, note.trim(), doneDate);
    setBusy(false);
    if (r.ok) {
      setNote(""); setOpen(false);
      setMsg(r.sfError ? `Saved. Salesforce log failed: ${r.sfError}` : "Logged as a completed update + Salesforce task.");
    } else {
      setMsg("Couldn't save the update — try again.");
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: 8 }}>
        <button type="button" className="sfm-btn confirm" onClick={() => { setOpen(true); setMsg(null); }}>+ Add update</button>
        {msg ? <span className="td-meta" style={{ marginLeft: 8 }}>{msg}</span> : null}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8, padding: 10, border: "1px solid var(--line,#E7ECF3)", borderRadius: 10 }}>
      <textarea
        value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
        placeholder="What happened on this deal? (logged as a completed update)"
        style={{ width: "100%", font: "inherit", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line,#D7DEE8)", resize: "vertical" }}
      />
      <div className="td-meta" style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Date done <input type="date" value={doneDate} onChange={(e) => setDoneDate(e.target.value)} style={{ font: "inherit" }} /></label>
        <button type="button" className="sfm-btn confirm" disabled={busy || !note.trim()} onClick={submit}>{busy ? "Saving…" : "Complete update"}</button>
        <button type="button" className="sfm-btn cancel" disabled={busy} onClick={() => { setOpen(false); setNote(""); }}>Cancel</button>
      </div>
      {msg ? <div className="td-meta" style={{ marginTop: 6 }}>{msg}</div> : null}
    </div>
  );
}

export default function DealDrawer({
  record, records, playbook, onClose,
}: { record: Rec | null; records: Rec[]; playbook: any; onClose: () => void }) {
  const { done, toggle } = useTodoDone();
  const sync = useTodoSync();
  const backend = useBackendTodos();
  const open = !!record;
  const h = record?.hard || {};
  const ai = record?.ai || {};

  const verdict = ai.north_star_verdict || {};
  // recommended_forecast sometimes carries a long rationale ("Pipeline (remove until EB
  // mapped...)"). Show just the clean category in the chip; full text goes in the tooltip.
  const recFcRaw = String(verdict.recommended_forecast || "");
  const recFcCat = (recFcRaw.match(/^\s*(Commit|Best Case|Upside|Pipeline|Omitted|Closed)/i)?.[1])
    || recFcRaw.split(/[\s(,—-]/)[0] || recFcRaw;
  // To-dos come from the SAME backend GET /todo arrays the Espresso tab uses,
  // filtered to this deal's opp_id — so drawer and Espresso are identical.
  const tier = record ? dealTier(h) : null;
  const deep = tier ? !tier.activatable : false;
  // The server-computed engagement pulse is the single authoritative read of how
  // recently/meaningfully this deal is being worked. When it is LIVE, any frozen
  // best-practice or next-move flag that calls the deal a ghost / dark-for-months /
  // future-date problem is categorically wrong (the record was swept before pulse
  // reconciliation existed) — suppress it here so the drawer reflects the pulse,
  // not the stale agent worldview. Mirrors deal_engine_pulse on the backend.
  const pulse = (record?.pulse || null) as PulseLike | null;
  const pulseLive = isPulseLive(pulse);
  const pchip = pulseChip(pulse);

  // Next-moves plan: when the record carries horizon-tagged recommended_moves, source
  // the "Critical / next moves" bucket from the FULL ranked plan (not the capped /todo
  // critical item) so all three rolling horizons render for EVERY deal. Each move is
  // stamped server-side with its todo_key (and edit/delete overrides already applied),
  // so Edit/Delete work here too. SF-push state is overlaid from the /todo critical
  // ledger by todo_key. Deals without horizon tags keep the existing /todo behaviour.
  const aiMoves: any[] = Array.isArray((ai.recommended_moves || {}).items) ? ai.recommended_moves.items : [];
  const useMovesPlan = aiMoves.some((m) => m && m.horizon);
  const todoCritByKey = new Map(
    backend.flat
      .filter((it) => it.category === "critical" && record && sfKey(it.opp_id) === sfKey(record.opp_id))
      .map((it) => [it.todoKey, it]),
  );
  const moveCriticalItems: BackendTodoItem[] = aiMoves.map((m) => {
    const key = String(m.todo_key || "");
    const match = key ? todoCritByKey.get(key) : undefined;
    return {
      ...(match || {}),
      opp_id: record?.opp_id, account_name: h.account_name, opp_name: h.opp_name, owner_name: h.owner_name,
      category: "critical", text: String(m.action || ""), todoKey: key,
      edited: !!m.edited,
      horizon: m.horizon, act_by: m.act_by, intervention_owner: m.owner,
      trigger: m.trigger, trigger_date: m.trigger_date, expected_effect: m.expected_effect,
    } as BackendTodoItem;
  }).filter((it) => it.text && !(pulseLive && flagContradictsLivePulse(it.text, pulse)));

  const otherBuckets = (record ? bucketsForOpp(backend.flat, record.opp_id) : [])
    .filter((bk) => !(useMovesPlan && bk.category === "critical"))
    .map((bk) =>
      pulseLive && (bk.category === "bestPractice" || bk.category === "critical")
        ? { ...bk, items: bk.items.filter((it) => !flagContradictsLivePulse(it.text, pulse)) }
        : bk,
    )
    .filter((bk) => bk.items.length > 0);
  const buckets = [
    ...(useMovesPlan && moveCriticalItems.length ? [{ category: "critical" as const, items: moveCriticalItems }] : []),
    ...otherBuckets,
  ];
  const medd = record ? dealMeddpicc(record) : [];
  const champ = ai.champion_strength || {};
  const fit = ai.ai_fit_signal || {};
  const pos = ai.ai_positioning_strength || {};
  const stake = (ai.stakeholder_map || {}).items || [];
  const meddpicc = ai.meddpicc; // rich backend MEDDPICC (present on re-swept deals)
  const vuln = ai.vulnerabilities || {};
  const openVulns = (vuln.items || []).filter((v: any) => v.status !== "closed");
  // The blocker is ONE combined risk read, capped at 60 words (a seasoned RSD doesn't
  // need stage-tactical filler). Prefer the backend's synthesized vulnerabilities.summary;
  // otherwise stitch the open risks together. Fit to 60 words — no mid-sentence truncation.
  const riskSummaryRaw = wordCap(
    vuln.summary || openVulns.map((v: any) => cleanText(v.detail)).filter(Boolean).join(" "),
    60,
  );
  // Drop the blocker entirely if it's a stale ghost/dark read the live pulse refutes.
  const riskSummary = pulseLive && flagContradictsLivePulse(riskSummaryRaw, pulse) ? "" : riskSummaryRaw;
  const riskCats: string[] = Array.from(new Set(openVulns.map((v: any) => String(v.category || "")).filter((c: string) => !!c)));
  const overdue = typeof h.days_to_close === "number" && h.days_to_close < 0;
  const lastDays = daysSince(h.last_activity_date);

  // Recently completed — what the deal team has already actioned and closed (so the
  // next moves build forward instead of re-issuing done work). Merges the sweep's
  // completed commitments with the user's manually-logged updates, newest first.
  const sweptCompleted = (((ai.open_deliverables || {}).items || []) as any[])
    .filter((d) => String(d.status || "").toLowerCase() === "completed");
  const manualCompleted = (record ? backend.manualForOpp(record.opp_id) : []).map((m) => ({
    commitment: m.note, who: m.created_by || "Logged update", date: m.done_date,
    source: m.sf_task_id ? `Salesforce Task ${m.sf_task_id}` : "Logged in MASE",
    manual: true,
  }));
  const completedItems = [...manualCompleted, ...sweptCompleted]
    .sort((a, b) => String(b.date || b.due || "").localeCompare(String(a.date || a.due || "")));

  // AI Excitement: SF fields first, topped up by the analyst's AI read.
  const aiCategory = (h.ais_status && h.ais_status !== "—" ? h.ais_status : "") || fit.tier || "";
  const aiScore = h.ais_score != null && h.ais_score !== "" ? `${h.ais_score}/10` : "";
  const aiWhy = (h.ais_why && h.ais_why !== "—") ? h.ais_why : "";

  // Competitors: trust the call evidence over the (often empty) SF field. Render the
  // full reconciled field ranked by CURRENT threat (high→dormant), then most-recent
  // date first — so 2026 threats sit above faded 2025 ones.
  const compPos = ai.competitive_position || {};
  const compSummary = compPos.summary || "";
  const THREAT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, dormant: 3 };
  const competitors = (Array.isArray(compPos.competitors) ? compPos.competitors : [])
    .slice()
    .sort((a: any, b: any) =>
      (THREAT_RANK[String(a.threat_level)] ?? 2) - (THREAT_RANK[String(b.threat_level)] ?? 2)
      || String(b.date || "").localeCompare(String(a.date || "")));
  const threatTone = (t: string) => (t === "high" ? "gap" : t === "medium" ? "weak" : "");
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
                  <div>
                    <span className={`chip ${verdictTone(verdict.verdict)}`}>{verdict.verdict}</span>
                    {verdict.trajectory && verdict.trajectory !== "new" ? (
                      <span
                        title={`Verdict ${verdict.trajectory} vs last sweep${verdict.prior_verdict ? ` (was ${verdict.prior_verdict})` : ""}`}
                        style={{
                          marginLeft: 6, fontSize: 12, fontWeight: 700,
                          color: verdict.trajectory === "stronger" ? "#0F9D6B" : verdict.trajectory === "weaker" ? "#D6453B" : "#7E8DA1",
                        }}
                      >
                        {verdict.trajectory === "stronger" ? "↑ stronger" : verdict.trajectory === "weaker" ? "↓ weaker" : "→ steady"}
                      </span>
                    ) : null}
                    {pchip ? (
                      <span
                        title={pchip.title}
                        style={{
                          marginLeft: 6, display: "inline-block", padding: "2px 9px",
                          borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                          color: "#fff", background: pchip.color,
                        }}
                      >
                        {pchip.label}
                      </span>
                    ) : null}
                    {verdict.forecast_defensible === false && recFcCat ? (
                      <span className="duechip heavy" style={{ marginLeft: 6 }}
                        title={`Current forecast is not defensible on the evidence — recommend ${recFcRaw}`}>
                        Forecast → {recFcCat}
                      </span>
                    ) : null}
                  </div>
                  {pchip && pulse?.summary ? (
                    <div className="body" style={{ marginTop: 6, color: "var(--muted,#5A6B82)" }}>
                      Pulse — {pulse.summary}
                    </div>
                  ) : null}
                  {/* The RevOps verdict insight (headline), NOT the SF stage arithmetic (math). */}
                  {(verdict.headline || verdict.math) ? (
                    <div className="body" style={{ marginTop: 6 }}>{trim(verdict.headline || verdict.math)}</div>
                  ) : null}
                </Section>
              ) : null}

              {/* The blocker — one combined risk read, <=60 words, strategic (not stage-tactical) */}
              {riskSummary ? (
                <Section title="The blocker">
                  <div className="headline">{riskSummary}</div>
                  {riskCats.length ? (
                    <div className="td-meta" style={{ marginTop: 4 }}>
                      {riskCats.slice(0, 5).map((c) => <span key={c} className="duechip heavy">{c.replace(/_/g, " ")}</span>)}
                    </div>
                  ) : null}
                </Section>
              ) : null}

              {/* Recently completed — what the RSD has already closed (sweep + manually
                  logged updates), so next moves build forward. Hosts "Add update". */}
              <Section title="Recently completed">
                {completedItems.length ? (
                  <ul className="todo-list">
                    {completedItems.slice(0, 8).map((d, i) => (
                      <li className="todo-item done" key={i}>
                        <span style={{ color: "#0F9D6B", fontWeight: 700, marginRight: 6 }}>✓</span>
                        <div className="td-body">
                          <div className="td-txt">
                            {cleanText(d.commitment)}
                            {(d as any).manual ? <span className="ownerchip" style={{ marginLeft: 6 }}>logged</span> : null}
                          </div>
                          <div className="td-meta">
                            {d.who ? <span className="ownerchip">{d.who}</span> : null}
                            {(d.date || d.due) ? <span className="ownerchip">{d.date || d.due}</span> : null}
                            {d.source ? <span className="td-meta">{cleanText(d.source)}</span> : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="body">Nothing logged yet.</div>
                )}
                <AddUpdateForm oppId={record.opp_id} backend={backend} />
              </Section>

              {/* To-dos — IDENTICAL to this deal's Espresso to-dos: same backend
                  GET /todo arrays, same todo_key, same Salesforce push. */}
              <Section title="To-dos">
                {tier ? (
                  <div className="td-meta" style={{ marginBottom: 8 }}>
                    <span className="ownerchip vp">{tier.label.split(" —")[0]}</span>
                    <span className="td-meta">{deep ? "Forecast deal — full plan" : "Qualified — focus on discovery & engagement"}</span>
                  </div>
                ) : null}
                {backend.loading && !backend.flat.length ? (
                  <div className="body">Loading to-dos…</div>
                ) : buckets.length ? (
                  <DealTodoBuckets buckets={buckets} ownerName={h.owner_name} done={done} toggle={toggle} sync={sync} backend={backend} />
                ) : (
                  <div className="body">No open to-dos for this deal.</div>
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
                  {champ.summary ? <div className="body">{trim(champ.summary, deep ? 280 : 160)}</div> : null}
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
                          <td>{trim(s.sentiment)}{s.risk ? <div className="td-meta" style={{ marginTop: 3 }}>⚠ {cleanText(s.risk)}</div> : null}{s.last_contact_date ? <div className="td-meta">last contact {s.last_contact_date}</div> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {meddpicc ? <MeddpiccRich meddpicc={meddpicc} /> : <Meddpicc items={medd} />}
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

              {/* Competition — reconciled, time-weighted; strongest current threat first */}
              <Section title="Competition">
                {compSummary ? <div className="body" style={{ marginBottom: competitors.length ? 10 : 0 }}>{trim(compSummary, 320)}</div> : null}
                {competitors.length ? (
                  <div>
                    {competitors.map((c: any, i: number) => (
                      <div key={i} style={{ padding: "7px 0", borderTop: i ? "1px solid var(--line,#E7ECF3)" : "none" }}>
                        <div>
                          <span className="ownerchip vp">{c.name}</span>
                          {c.threat_level ? <span className={`chip ${threatTone(String(c.threat_level))}`} style={{ marginLeft: 6 }}>{String(c.threat_level)} threat</span> : null}
                          {c.status ? <span className="duechip" style={{ marginLeft: 6 }}>{String(c.status).replace(/_/g, " ")}</span> : null}
                          {c.change === "new" ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#fff", background: "#0F9D6B", padding: "1px 7px", borderRadius: 999 }}>NEW</span> : null}
                          {c.change === "updated" ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#fff", background: "#6D4AED", padding: "1px 7px", borderRadius: 999 }}>UPDATED</span> : null}
                          {c.first_seen ? <span className="td-meta" style={{ marginLeft: 6 }}>since {c.first_seen}</span> : (c.date ? <span className="td-meta" style={{ marginLeft: 6 }}>{c.date}</span> : null)}
                        </div>
                        {c.quote ? <div className="td-meta" style={{ marginTop: 3 }}>“{cleanText(c.quote)}”</div> : null}
                        {c.how_we_win ? <div className="body" style={{ marginTop: 3 }}><b>How we win:</b> {cleanText(c.how_we_win)}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : compNames.length ? (
                  <div style={{ marginBottom: 6 }}>{compNames.map((c) => <span className="chip" key={c} style={{ marginRight: 6 }}>{c}</span>)}</div>
                ) : (!compSummary ? <div className="body">None logged.</div> : null)}
              </Section>
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
