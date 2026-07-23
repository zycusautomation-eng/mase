"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// "What to focus on" — a rep-facing insights band that sits above the deal list and reads
// the WHOLE book (already scoped to the signed-in rep) to answer the only question that
// matters at 9am: what do I do today, and which deals first.
//
// Deterministic on purpose. MASE already computes the hard signals per deal (close date,
// north-star verdict, last activity, recommended moves); this panel just ranks them so the
// rep doesn't have to scan 400 rows. No LLM call — instant, free, always accurate. (An
// LLM-written narrative can be layered on later without changing this surface.)
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useDealAi } from "@/components/deals/DealAiProvider";
import { prefetchDeal } from "@/lib/engine/dealCache";
import { isDeadDeal, verdictTone, daysSince } from "@/lib/engine/helpers";
import { repInsights, normAccount } from "@/lib/repInsights";
import { Sparkles, CalendarClock, AlertTriangle, Moon, ArrowRight } from "lucide-react";

function fmtM(n: number): string {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n || 0);
}

const amt = (r: any) => Number(r.hard?.amount) || 0;
// Scores come from ai.deal_scores.headline — the ONE canonical source the deals table + drawer
// read. (The per-factor sub-objects like win_position.score aren't reliably on list records.)
const winOf = (r: any) => Number(r.ai?.deal_scores?.headline?.win_position) || 0;   // 0–100
const momOf = (r: any) => Number(r.ai?.deal_scores?.headline?.deal_momentum) || 0;  // 0–100

// Days until close (positive = future). Prefer the precomputed hard field, else derive.
function daysToClose(r: any): number | null {
  const d = r.hard?.close_date;                      // compute fresh from the date (precomputed field goes stale)
  if (d) {
    const t = new Date(String(d).slice(0, 10) + "T00:00:00").getTime();
    if (!isNaN(t)) return Math.ceil((t - Date.now()) / 86_400_000);
  }
  return r.hard?.days_to_close != null ? Number(r.hard.days_to_close) : null;
}

const isAtRisk = (r: any) => {
  const v = verdictTone(r.ai?.north_star_verdict?.verdict);
  return v === "v-slow" || v === "v-off";
};
const quietDays = (r: any) => daysSince(r.hard?.last_activity_date);

function closeLabel(d: number | null): string {
  if (d == null) return "no close date";
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "closes today";
  if (d === 1) return "closes tomorrow";
  return `closes in ${d}d`;
}

// One-line reason a deal is a focus — why it's worth the rep's time: how close, how winnable.
function reasonFor(r: any): string {
  const d = daysToClose(r);
  const w = winOf(r), m = momOf(r);
  const bits: string[] = [];
  if (d != null && d >= -7 && d <= 45) bits.push(closeLabel(d));
  if (w) bits.push(`win ${Math.round(w)}`);
  if (m) bits.push(`momentum ${Math.round(m)}`);
  if (!bits.length) bits.push(isAtRisk(r) ? "needs attention" : "advancing");
  return bits.slice(0, 3).join(" · ");
}

export default function DealInsights() {
  const { filtered, loading, scopeName, simEmail, realIsAdmin } = useDashboard();
  const { openNewDeal } = useDealAi();
  const router = useRouter();

  const model = useMemo(() => {
    const book = (filtered as any[]).filter((r) => !isDeadDeal(r));
    const closing = book.filter((r) => { const d = daysToClose(r); return d != null && d >= 0 && d <= 7; });
    const atRisk = book.filter(isAtRisk);
    const quiet = book.filter((r) => { const q = quietDays(r); return q != null && q >= 14; });

    // Focus = the deals worth the rep's energy now: strongest WIN position + MOMENTUM,
    // closing SOONEST. Badly-overdue deals (a close date long past = SF hygiene debt, not a
    // live deal) are excluded so they never crowd out winnable business.
    const closeness = (r: any) => {
      const d = daysToClose(r);
      if (d == null || d < -7) return -1;        // no date / badly overdue → not a focus candidate
      if (d < 0) return 60;                       // just slipped — still worth the push
      if (d <= 7) return 100;
      if (d <= 30) return 92 - (d - 7) * 1.6;
      if (d <= 90) return 46 - (d - 30) * 0.5;
      return 8;
    };
    const prio = (r: any) => {
      const c = closeness(r);
      if (c < 0) return -1;
      return winOf(r) * 0.9 + momOf(r) * 0.85 + c * 1.1 + Math.log10(amt(r) + 1) * 2;
    };
    const focus = [...book]
      .map((r) => ({ r, s: prio(r) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map((x) => x.r);

    const needsYou = new Set([...closing, ...atRisk, ...quiet]).size;
    return { book, closing, atRisk, quiet, focus, needsYou };
  }, [filtered]);

  // GATED: test-only. Visible ONLY to a real admin who is SIMULATING a rep. No RSD, no VP,
  // and no admin outside a simulated view sees it yet. Remove this guard to roll it out.
  if (!(realIsAdmin && simEmail)) return null;
  if (loading && !filtered.length) return null;               // hero skeleton already carries the load state
  if (!model.book.length) return null;

  const { closing, atRisk, quiet, focus, needsYou } = model;
  const firstName = (scopeName || "").trim().split(/\s+/)[0] || "";

  const summary = needsYou === 0
    ? "Nothing on fire — your book is in good shape today."
    : `${needsYou} deal${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you` +
      [
        closing.length ? `${closing.length} closing this week` : "",
        atRisk.length ? `${atRisk.length} at risk` : "",
        quiet.length ? `${quiet.length} gone quiet` : "",
      ].filter(Boolean).join(", ").replace(/^/, " — ");

  const chips = [
    { key: "closing", Icon: CalendarClock, label: "Closing this week", n: closing.length, sum: closing.reduce((a, r) => a + amt(r), 0), tone: "amber" },
    { key: "atrisk", Icon: AlertTriangle, label: "At risk", n: atRisk.length, sum: atRisk.reduce((a, r) => a + amt(r), 0), tone: "red" },
    { key: "quiet", Icon: Moon, label: "Gone quiet", n: quiet.length, sum: quiet.reduce((a, r) => a + amt(r), 0), tone: "slate" },
  ];

  // AI focus for this rep (curated for now — see lib/repInsights). Each item is resolved to
  // its LIVE deal so the numbers + click-through stay real; only the narrative is authored.
  // Matched by scope name, or (robustly) when the visible book is dominated by a rep we have
  // an insight for — so it shows whether that rep is signed in OR being simulated.
  let ai = repInsights[(scopeName || "").trim()];
  if (!ai) {
    const ownerCounts = new Map<string, number>();
    for (const r of model.book) { const o = r.hard?.owner_name; if (o) ownerCounts.set(o, (ownerCounts.get(o) || 0) + 1); }
    for (const key of Object.keys(repInsights)) {
      if ((ownerCounts.get(key) || 0) >= Math.max(3, model.book.length * 0.4)) { ai = repInsights[key]; break; }
    }
  }
  const byAccount = new Map<string, any>();
  for (const r of model.book) {
    const k = normAccount(r.hard?.account_name || r.hard?.opp_name);
    if (k && !byAccount.has(k)) byAccount.set(k, r);
  }
  const resolve = (acct: string): any => {
    const k = normAccount(acct);
    if (byAccount.has(k)) return byAccount.get(k);
    for (const [kk, r] of byAccount) if (kk.startsWith(k) || k.startsWith(kk)) return r;
    return null;
  };

  return (
    <section className="book-ai" aria-label="What to focus on">
      <div className="book-ai-head">
        <span className="book-ai-badge"><Sparkles className="size-3.5" /> {ai ? "MASE · AI" : "MASE"}</span>
        <div className="book-ai-htext">
          <div className="book-ai-title">{ai ? ai.headline : (firstName ? `Focus your day, ${firstName}` : "What to focus on")}</div>
          <div className="book-ai-sum">{ai ? ai.summary : summary}</div>
        </div>
      </div>

      <div className="book-ai-chips">
        {chips.map((c) => (
          <div key={c.key} className={`book-ai-chip tone-${c.tone}`}>
            <c.Icon className="size-4" />
            <div className="book-ai-chip-body">
              <div className="book-ai-chip-n">{c.n}<span>{c.n ? ` · ${fmtM(c.sum)}` : ""}</span></div>
              <div className="book-ai-chip-l">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {ai ? (
        <div className="book-ai-focus">
          <div className="book-ai-focus-h"><Sparkles className="size-3.5" /> MASE suggests — start here</div>
          <div className="ai-cards">
            {ai.focus.map((f, i) => {
              const r = resolve(f.account);
              const dtc = r ? daysToClose(r) : null;
              return (
                <div key={f.account} className="ai-card">
                  <div className="ai-card-top">
                    <span className="book-ai-rank">{i + 1}</span>
                    <button type="button" className="ai-card-acct"
                      onClick={() => r?.opp_id && router.push(`/deals?deal=${r.opp_id}`, { scroll: false })}
                      onMouseEnter={() => r?.opp_id && prefetchDeal(r.opp_id)}>
                      {r?.hard?.account_name || f.account}
                    </button>
                    {r ? (
                      <span className="ai-card-meta">
                        {fmtM(amt(r))} · {closeLabel(dtc)} · win {Math.round(winOf(r))} · mom {Math.round(momOf(r))}
                      </span>
                    ) : null}
                  </div>
                  <div className="ai-card-hl">{f.headline}</div>
                  <div className="ai-card-why">{f.why}</div>
                  <div className="ai-card-do"><span className="ai-do-ic">▷</span> {f.doNow}</div>
                  {r ? (
                    <button type="button" className="ai-card-help"
                      onClick={() => openNewDeal(
                        { oid: r.opp_id, accountName: r.hard?.account_name || f.account, oppName: r.hard?.opp_name, ownerName: r.hard?.owner_name },
                        f.seed
                      )}>
                      <Sparkles className="size-3.5" /> {f.aiHelp} <ArrowRight className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {ai.watch ? <div className="ai-watch"><b>Watch</b> · {ai.watch}</div> : null}
        </div>
      ) : focus.length ? (
        <div className="book-ai-focus">
          <div className="book-ai-focus-h">Start here</div>
          <div className="book-ai-list">
            {focus.map((r, i) => (
              <button key={r.opp_id || i} type="button" className="book-ai-item"
                onClick={() => r.opp_id && router.push(`/deals?deal=${r.opp_id}`, { scroll: false })}
                onMouseEnter={() => r.opp_id && prefetchDeal(r.opp_id)}>
                <span className="book-ai-rank">{i + 1}</span>
                <div className="book-ai-item-main">
                  <div className="book-ai-acct">{r.hard?.account_name || r.hard?.opp_name || "—"}</div>
                  <div className="book-ai-why">{reasonFor(r)}</div>
                </div>
                <div className="book-ai-item-meta">
                  <span className="book-ai-amt">{fmtM(amt(r))}</span>
                  <span className="book-ai-close">{closeLabel(daysToClose(r))}</span>
                </div>
                <ArrowRight className="book-ai-go size-4" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="book-ai-clear">You&apos;re caught up — no deal needs urgent action right now.</div>
      )}
    </section>
  );
}
