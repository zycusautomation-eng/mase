"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared deal-detail UI — the SAME hero + tabs + AI summary + action plan + copilot
// rail rendered by BOTH the /deals/[id] full page and the slide-in DealDrawer, so the
// two are identical. `variant` only changes the top bar (page: ← Deals; drawer: ← Close
// + Full page →) and collapses the grid to one column in the narrower drawer. Todos come
// from the same backend GET /todo arrays (bucketsForOpp) as Espresso + the page.
import { useState } from "react";
import Link from "next/link";
import {
  fmtAmount, verdictTone, dealTier, dealMeddpicc, cleanText, daysSince,
  dealComps, type Rec, type MeddItem,
} from "@/lib/engine/helpers";
import { useTodoDone } from "@/lib/engine/useTodoDone";
import { useTodoSync } from "@/lib/engine/useTodoSync";
import { useBackendTodos } from "@/lib/engine/useBackendTodos";
import { DealTodoBuckets, bucketsForOpp } from "@/components/deals/DealTodos";
import { BulkPushBar } from "@/components/deals/BulkPushBar";
import { Monogram } from "@/components/ui/Monogram";
import { useDealAi } from "@/components/deals/DealAiProvider";
import { pulseChip, type PulseLike } from "@/lib/engine/pulse";

const words = (s: any, n: number) => cleanText(s).split(/\s+/).filter(Boolean).slice(0, n).join(" ");

// Log a new update on the opportunity, to ONE of three destinations: a completed
// Salesforce Task (default, original behaviour), an OPEN to-do (MASE row + open SF
// Task), or an append on the Next Step trail. The rep picks the destination + a date;
// persists via /todo/update (the picker merged in from the GitHub functional change).
const UPDATE_DESTS = {
  completed: { label: "Completed task", dateLabel: "Date done",
    placeholder: "What happened on this deal? (logged as a completed Salesforce task)",
    cta: "Log completed", ok: "Logged as a completed update + Salesforce task." },
  todo: { label: "To-do (open)", dateLabel: "Due date",
    placeholder: "What needs doing next? (creates a MASE to-do + an open Salesforce task)",
    cta: "Create to-do", ok: "Created a to-do + open Salesforce task." },
  next_step: { label: "Next step", dateLabel: "Due date",
    placeholder: "Latest next step, appended on top of the existing Next Step trail",
    cta: "Add to Next Step", ok: "Appended to Next Step (newest on top)." },
} as const;
type UpdateDest = keyof typeof UPDATE_DESTS;

function AddUpdateForm({ oppId, backend }: { oppId: string; backend: ReturnType<typeof useBackendTodos> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [destination, setDestination] = useState<UpdateDest>("completed");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cfg = UPDATE_DESTS[destination];
  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true); setMsg(null);
    // Single date is sent as both done_date and due_date — the backend uses the due
    // date for next_step / todo and the done date for completed.
    const r = await backend.addUpdate(oppId, note.trim(), date, destination, date);
    setBusy(false);
    if (r.ok) { setNote(""); setOpen(false); setMsg(r.sfError ? `Saved. Salesforce write failed: ${r.sfError}` : cfg.ok); }
    else setMsg("Couldn't save the update — try again.");
  };
  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <button type="button" className="sfm-btn confirm" onClick={() => { setOpen(true); setMsg(null); }}>+ Add update</button>
        {msg ? <span className="td-meta" style={{ marginLeft: 8 }}>{msg}</span> : null}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
      <div className="td-meta" style={{ marginBottom: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12 }}>Send to:</span>
        {(Object.keys(UPDATE_DESTS) as UpdateDest[]).map((k) => (
          <button key={k} type="button" className={`sfm-btn ${destination === k ? "confirm" : "cancel"}`}
            style={{ padding: "2px 10px", fontSize: 12 }} aria-pressed={destination === k}
            onClick={() => { setDestination(k); setMsg(null); }}>{UPDATE_DESTS[k].label}</button>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
        placeholder={cfg.placeholder}
        style={{ width: "100%", font: "inherit", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", resize: "vertical" }} />
      <div className="td-meta" style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>{cfg.dateLabel} <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ font: "inherit" }} /></label>
        <button type="button" className="sfm-btn confirm" disabled={busy || !note.trim()} onClick={submit}>{busy ? "Saving…" : cfg.cta}</button>
        <button type="button" className="sfm-btn cancel" disabled={busy} onClick={() => { setOpen(false); setNote(""); }}>Cancel</button>
      </div>
      {msg ? <div className="td-meta" style={{ marginTop: 6 }}>{msg}</div> : null}
    </div>
  );
}

export default function DealDetailView({ rec, variant = "page", onClose }: { rec: Rec; variant?: "page" | "drawer"; onClose?: () => void }) {
  const { done, toggle } = useTodoDone();
  const sync = useTodoSync();
  const backend = useBackendTodos();
  const { openNewDeal } = useDealAi();

  const h = rec.hard || {}, ai = rec.ai || {};
  const dealForAi = { oid: rec.opp_id, accountName: h.account_name || rec.opp_id, oppName: h.opp_name, ownerName: h.owner_name };
  const verdict = ai.north_star_verdict || {};
  const vt = verdictTone(verdict.verdict);
  const healthLabel = vt === "v-on" ? "Healthy" : vt === "v-risk" ? "At Risk" : vt === "v-off" ? "Off track" : "—";
  const healthColor = vt === "v-on" ? "var(--green-ink)" : vt === "v-risk" ? "var(--amber-ink)" : vt === "v-off" ? "var(--red-ink)" : "var(--muted)";
  const tier = dealTier(h);
  const buckets = bucketsForOpp(backend.flat, rec.opp_id);
  const todoCount = buckets.reduce((n, b) => n + b.items.length, 0);
  const vuln = ai.vulnerabilities || {};
  const openVulns = (vuln.items || []).filter((v: any) => v.status !== "closed");
  const riskSummary = words(vuln.summary || openVulns.map((v: any) => cleanText(v.detail)).filter(Boolean).join(" "), 55);
  const topMove = ((ai.recommended_moves || {}).items || []).slice().sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99))[0];
  const stake = (ai.stakeholder_map || {}).items || [];
  const medd: MeddItem[] = dealMeddpicc(rec);
  const champ = ai.champion_strength || {};
  const fit = ai.ai_fit_signal || {};
  const compPos = ai.competitive_position || {};
  const competitors = (Array.isArray(compPos.competitors) ? compPos.competitors : []).slice()
    .sort((a: any, b: any) => ({ high: 0, medium: 1, low: 2, dormant: 3 } as any)[String(a.threat_level)] - ({ high: 0, medium: 1, low: 2, dormant: 3 } as any)[String(b.threat_level)]);
  const overdue = typeof h.days_to_close === "number" && h.days_to_close < 0;
  const lastDays = daysSince(h.last_activity_date);
  // Verdict richness (don't lose it): engagement pulse, forecast-defensibility, risk categories.
  const pulse = (rec.pulse || null) as PulseLike | null;
  const pchip = pulseChip(pulse);
  const recFcRaw = String(verdict.recommended_forecast || "");
  const recFcCat = (recFcRaw.match(/^\s*(Commit|Best Case|Upside|Pipeline|Omitted|Closed)/i)?.[1]) || recFcRaw.split(/[\s(,—-]/)[0] || recFcRaw;
  const riskCats: string[] = Array.from(new Set(openVulns.map((v: any) => String(v.category || "")).filter((c: string) => !!c)));

  const sweptCompleted = (((ai.open_deliverables || {}).items || []) as any[]).filter((d) => String(d.status || "").toLowerCase() === "completed");
  const manualCompleted = (backend.manualForOpp(rec.opp_id) || []).map((m: any) => ({ commitment: m.note, who: m.created_by || "Logged update", date: m.done_date, source: m.sf_task_id ? `Salesforce Task ${m.sf_task_id}` : "Logged in MASE" }));
  const completed = [...manualCompleted, ...sweptCompleted].sort((a: any, b: any) => String(b.date || b.due || "").localeCompare(String(a.date || a.due || "")));

  const aiCategory = (h.ais_status && h.ais_status !== "—" ? h.ais_status : "") || fit.tier || "";
  const aiScore = h.ais_score != null && h.ais_score !== "" ? `${h.ais_score}/10` : "";
  const aiWhy = (h.ais_why && h.ais_why !== "—") ? h.ais_why : (fit.summary || "");

  const SUGGESTIONS = [
    { t: "Summarize deal", s: "Get an AI summary", p: "Summarize this deal: current status, the single biggest risk, and the most important next move. Keep it tight." },
    { t: "Draft follow-up email", s: "To the key stakeholder", p: "Draft a short follow-up email to the key stakeholder on this deal. Never use em-dashes or double-dashes." },
    { t: "Generate next actions", s: "AI recommended plan", p: "Generate the recommended next actions for this deal, prioritized, with who should own each." },
    { t: "Surface the blocker", s: "What's stalling this deal", p: "What is the single biggest blocker on this deal right now, and exactly how do we clear it?" },
  ];

  return (
    <>
      <div className="dp-top">
        {variant === "drawer"
          ? <button type="button" className="dp-back" onClick={onClose}>← Close</button>
          : <Link href="/deals" className="dp-back">← Deals</Link>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {variant === "drawer" ? <Link href={`/deals/${encodeURIComponent(rec.opp_id)}`} className="dp-action">Full page →</Link> : null}
          {h.sf_link ? <a className="dp-action" href={h.sf_link} target="_blank" rel="noreferrer">Salesforce ↗</a> : null}
          <button type="button" className="dp-action primary" onClick={() => openNewDeal(dealForAi)} title="Complete this deal's tasks with AI">✦ Ask AI</button>
        </div>
      </div>

      <div className="dp-hero">
        <div className="dp-hero-main">
          <Monogram name={h.account_name || rec.opp_id} kind="account" size={46} />
          <div className="dp-hero-id">
            <div className="dp-hero-name">
              <span>{h.account_name || rec.opp_id}</span>
              {verdict.verdict ? <span className={`chip ${vt}`}>{verdict.verdict}</span> : null}
              {h.stage ? <span className="chip">{h.stage}</span> : null}
            </div>
            <div className="dp-hero-sub">{h.opp_name || ""}{h.owner_name ? ` · ${h.owner_name}` : ""}{h.close_date ? ` · Close ${h.close_date}` : ""}</div>
          </div>
        </div>
        <div className="dp-metrics">
          <div className="dp-metric"><div className="k">Deal value</div><div className="v">{fmtAmount(h.amount)}</div><div className="s">USD</div></div>
          <div className="dp-metric"><div className="k">Deal health</div><div className="v" style={{ color: healthColor }}>{healthLabel}</div>{verdict.trajectory && verdict.trajectory !== "new" ? <div className="s">{verdict.trajectory}</div> : null}</div>
          <div className="dp-metric"><div className="k">AI confidence</div><div className="v">✦ {rec.analysis_confidence || "—"}</div></div>
          <div className="dp-metric"><div className="k">Owner</div><div className="v dp-owner"><Monogram name={h.owner_name || "?"} kind="person" size={24} /><span>{h.owner_name || "—"}</span></div></div>
        </div>
      </div>

      <div className={`dp-grid ${variant === "drawer" ? "dp-grid-compact" : ""}`}>
        <div className="dp-main">
          {/* Single scroll — every section once, top to bottom. */}
          <div className="card dp-ai">
            <div className="dp-card-h">
              <h3 className="dp-ai-h">✦ AI Summary</h3>
              <div className="dp-ai-chips">
                {verdict.verdict ? <span className={`chip ${vt}`}>{verdict.verdict}</span> : null}
                {pchip ? <span className="dp-pulse" title={pchip.title} style={{ background: pchip.color }}>{pchip.label}</span> : null}
                {verdict.forecast_defensible === false && recFcCat ? <span className="duechip heavy" title={`Recommend ${recFcRaw}`}>Forecast → {recFcCat}</span> : null}
              </div>
            </div>
            {pchip && pulse?.summary ? <div className="dp-pulse-line">Pulse — {pulse.summary}</div> : null}
            {riskSummary ? <div className="dp-ai-alert">⚠ {riskSummary}</div> : null}
            {riskCats.length ? <div className="dp-riskcats">{riskCats.slice(0, 6).map((c) => <span key={c} className="duechip heavy">{c.replace(/_/g, " ")}</span>)}</div> : null}
            {(verdict.headline || verdict.math) ? <div className="body" style={{ margin: "0 0 12px" }}>{cleanText(verdict.headline || verdict.math)}</div> : null}
            {!riskSummary && !verdict.headline && !verdict.math ? <div className="body">No AI summary yet.</div> : null}
            <div className="dp-ai-grid">
              <div><div className="k">Verdict</div><div className="v">{verdict.verdict || "—"}</div></div>
              <div><div className="k">Main blocker</div><div className="v">{openVulns[0] ? words(openVulns[0].category || openVulns[0].detail, 5).replace(/_/g, " ") : "—"}</div></div>
              <div><div className="k">Impact</div><div className="v">{fmtAmount(h.amount)} at stake</div></div>
              <div><div className="k">Recommended next step</div><div className="v">{topMove ? words(topMove.action, 8) : "—"}</div></div>
              <div><div className="k">Confidence</div><div className="v">{rec.analysis_confidence || "—"}</div></div>
            </div>
          </div>

          {/* Action plan — the 4 buckets, ONCE */}
          <div className="card">
            <h3>Action plan{tier ? <span className="dp-sub"> · {tier.label.split(" —")[0]}</span> : null}{todoCount ? <span className="dp-tabc">{todoCount}</span> : null}</h3>
            {backend.loading && !backend.flat.length ? <div className="body">Loading to-dos…</div>
              : buckets.length ? <DealTodoBuckets buckets={buckets} ownerName={h.owner_name} done={done} toggle={toggle} sync={sync} backend={backend} />
                : <div className="body">No open to-dos for this deal.</div>}
          </div>

          {/* Recently completed */}
          <div className="card">
            <h3>Recently completed</h3>
            {completed.length ? (
              <ul className="todo-list">
                {completed.slice(0, 12).map((d: any, i: number) => (
                  <li className="todo-item done" key={i}>
                    <span style={{ color: "#0F9D6B", fontWeight: 700, marginRight: 4 }}>✓</span>
                    <div className="td-body">
                      <div className="td-txt">{cleanText(d.commitment)}</div>
                      <div className="td-meta">{d.who ? <span className="ownerchip">{d.who}</span> : null}{(d.date || d.due) ? <span className="ownerchip">{d.date || d.due}</span> : null}{d.source ? <span className="td-meta">{cleanText(d.source)}</span> : null}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <div className="body">Nothing logged yet.</div>}
            <AddUpdateForm oppId={rec.opp_id} backend={backend} />
          </div>

          {/* Champion */}
          {(champ.champion || champ.summary) ? (
            <div className="card"><h3>Champion</h3>
              <div style={{ marginBottom: 4 }}>
                {champ.champion ? <span className="ownerchip vp">{champ.champion}</span> : null}
                {champ.strength ? <span className={`duechip ${champ.at_risk ? "heavy" : ""}`}>{champ.strength}</span> : null}
                {champ.trajectory ? <span className="ownerchip" title="Relationship trajectory vs the last read">{champ.trajectory === "strengthening" ? "▲ strengthening" : champ.trajectory === "weakening" ? "▼ weakening" : "▬ steady"}</span> : null}
              </div>
              {champ.summary ? <div className="body">{words(champ.summary, 90)}</div> : null}
              {champ.alternate_champion && champ.alternate_champion.name ? (
                <div className="td-meta" style={{ marginTop: 6 }}><b>Develop an alternate:</b> {champ.alternate_champion.name}{champ.alternate_champion.title ? ` (${champ.alternate_champion.title})` : ""}{champ.alternate_champion.why ? ` — ${words(champ.alternate_champion.why, 25)}` : ""}</div>
              ) : null}
            </div>
          ) : null}

          {/* AI Excitement */}
          {(aiCategory || aiWhy) ? (
            <div className="card"><h3>AI Excitement</h3>
              <div style={{ marginBottom: 6 }}>{aiCategory ? <span className="chip v-on">{aiCategory}</span> : null}{aiScore ? <span className="ownerchip" style={{ marginLeft: 6 }}>{aiScore}</span> : null}</div>
              {aiWhy ? <div className="body">{words(aiWhy, 120)}</div> : null}
              {(fit.baseline || fit.latest) ? (
                <div className="td-meta" style={{ marginTop: 6 }}>{fit.baseline ? <span><b>Started:</b> {words(fit.baseline, 30)} </span> : null}{fit.latest ? <span><b>Now:</b> {words(fit.latest, 30)}</span> : null}</div>
              ) : null}
            </div>
          ) : null}

          {/* Stakeholders & MEDDPICC */}
          <div className="card">
            <h3>Stakeholders &amp; MEDDPICC</h3>
            {stake.length ? (
              <table className="itab" style={{ marginBottom: 12 }}>
                <thead><tr><th>Name</th><th>Role</th><th>Read</th></tr></thead>
                <tbody>
                  {stake.map((s: any, i: number) => (
                    <tr key={i}>
                      <td className="owner"><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Monogram name={s.name || "?"} kind="person" size={24} />{s.name}</span>{s.title ? <div className="td-meta">{s.title}</div> : null}</td>
                      <td>{s.role || "—"}</td>
                      <td>{cleanText(s.sentiment)}{s.risk ? <div className="td-meta" style={{ marginTop: 3 }}>⚠ {cleanText(s.risk)}</div> : null}{s.last_contact_date ? <div className="td-meta">last contact {s.last_contact_date}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="body" style={{ marginBottom: 10 }}>No stakeholders mapped yet.</div>}
            <div className="medd">
              <div className="medd-row">{medd.map((m) => <span key={m.dim} className={`medd-chip ${m.state}`} title={m.note}>{m.dim}</span>)}</div>
              <ul className="medd-gaps">{medd.filter((m) => m.state !== "have").map((m) => <li key={m.dim}><b>{m.dim}:</b> {m.note}</li>)}</ul>
            </div>
          </div>

          {/* Competition */}
          <div className="card"><h3>Competition</h3>
            {compPos.summary ? <div className="body" style={{ marginBottom: competitors.length ? 10 : 0 }}>{words(compPos.summary, 120)}</div> : null}
            {competitors.length ? competitors.map((c: any, i: number) => (
              <div key={i} style={{ padding: "7px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <span className="ownerchip vp">{c.name}</span>
                {c.threat_level ? <span className={`chip ${c.threat_level === "high" ? "v-off" : c.threat_level === "medium" ? "v-risk" : ""}`} style={{ marginLeft: 6 }}>{String(c.threat_level)} threat</span> : null}
                {c.how_we_win ? <div className="body" style={{ marginTop: 3 }}><b>How we win:</b> {cleanText(c.how_we_win)}</div> : null}
              </div>
            )) : (dealComps(h).length ? <div>{dealComps(h).map((c) => <span key={c} className="chip" style={{ marginRight: 6 }}>{c}</span>)}</div> : (!compPos.summary ? <div className="body">None logged.</div> : null))}
          </div>

          {/* Open risks */}
          {openVulns.length ? (
            <div className="card"><h3>Open risks</h3>
              <ul className="medd-gaps" style={{ paddingLeft: 18 }}>{openVulns.slice(0, 6).map((v: any, i: number) => <li key={i}><b>{String(v.category || "risk").replace(/_/g, " ")}:</b> {words(v.detail, 30)}</li>)}</ul>
            </div>
          ) : null}
          {/* Bulk push: pushes every ticked-but-unpushed to-do for this deal at once (any tab). */}
          <BulkPushBar items={buckets.flatMap((bk) => bk.items)} done={done} sync={sync} backend={backend} ownerOf={() => h.owner_name} />
        </div>

        <aside className="dp-rail">
          <div className="card dp-copilot">
            <h3 className="dp-ai-h">✦ AI Copilot</h3>
            {SUGGESTIONS.map((s) => (
              <button key={s.t} type="button" className="dp-cop-row" onClick={() => openNewDeal(dealForAi, s.p)}>
                <span className="dp-cop-ic">✦</span>
                <span className="dp-cop-txt"><b>{s.t}</b><span className="s">{s.s}</span></span>
              </button>
            ))}
            <button type="button" className="dp-ask" onClick={() => openNewDeal(dealForAi, "")}>Ask anything about this deal…</button>
          </div>
          <div className="card dp-details">
            <h3>Deal details</h3>
            {[
              ["Opportunity", h.opp_name || "—"],
              ["Stage", h.stage || "—"],
              ["Forecast", h.forecast_category || "—"],
              ["Close date", `${h.close_date || "—"}${overdue ? ` · ${Math.abs(h.days_to_close)}d overdue` : ""}`],
              ["Amount", fmtAmount(h.amount)],
              ["Owner", h.owner_name || "—"],
              ["Last activity", h.last_activity_date ? `${h.last_activity_date} · ${lastDays}d ago` : "none"],
            ].map(([k, v]) => (
              <div className="dp-kv" key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
