"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// "24h Summary" drawer tab. Reads the deal_daily_summaries table directly via the
// browser Supabase client (anon SELECT, same deal DB as deal_records) — no backend
// endpoint required. Renders inside the .ddw scope and is built entirely from the
// drawer's shared design language (card / ic-title / ai-hero + the .sum-* row/badge
// classes defined in DealDrawerView), so the tab reads identically to the rest of
// the drawer — no bespoke inline styling.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State = "loading" | "ok" | "none" | "err";

function fmt(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(iso); }
}
const KIND_ICON: Record<string, string> = { email: "✉", call: "📞", meeting: "📅", task: "✓" };
// Activity kinds we have a themed badge for; anything else falls back to the neutral badge.
const KNOWN_KINDS = new Set(["email", "call", "meeting", "task"]);
const kindClass = (k: any) => (KNOWN_KINDS.has(String(k)) ? String(k) : "neu");

// A count "stat" tag — same tinted-badge language as the drawer's pills/flags.
// Omit the count (n) for boolean facts like "next step updated".
function Stat({ n, label, tone = "neu", plural = true }: { n?: number; label: string; tone?: string; plural?: boolean }) {
  if (n != null && !n) return null;
  return (
    <span className={`sum-stat k-${tone}`}>
      <span className="dot" />
      {n != null ? `${n} ` : ""}{label}{plural && n != null && n !== 1 ? "s" : ""}
    </span>
  );
}

export function DealDaySummary({ oppId }: { oppId: string }) {
  const [row, setRow] = useState<any | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!oppId) { setState("none"); return; }
    const oid = String(oppId).slice(0, 15); // table keys on 15-char SF ids
    let off = false;
    (async () => {
      try {
        const sb = createClient();
        const { data, error } = await sb
          .from("deal_daily_summaries")
          .select("*")
          .eq("opp_id", oid)
          .order("summary_date", { ascending: false })
          .limit(1);
        if (off) return;
        if (error) { setState("err"); return; }
        if (!data || !data.length) { setState("none"); return; }
        setRow(data[0]); setState("ok");
      } catch { if (!off) setState("err"); }
    })();
    return () => { off = true; };
  }, [oppId]);

  if (state === "loading") return <div className="card card-pad ic-body">Loading the 24-hour summary…</div>;
  if (state === "err") return <div className="card card-pad ic-body">Couldn&apos;t load the 24-hour summary.</div>;
  if (state === "none") return <div className="card card-pad ic-body">No 24-hour summary has been generated for this deal yet.</div>;

  const r = row;
  const c = r.counts || {};
  const acts: any[] = r.activities || [];
  const moves: any[] = r.movements || [];
  const avoma: any[] = r.meetings_avoma || [];
  const isClaude = r.summary_source === "claude";

  return (
    <>
      {/* headline narrative */}
      <div className="ai-hero mb14">
        <div className="spine" />
        <div className="ai-head">
          <div className="ai-mark">🕐</div>
          <div className="ai-title">What happened in the last 24 hours</div>
          <span className={`sum-tag ${isClaude ? "t-ai" : ""}`} style={{ marginLeft: "auto" }}>{isClaude ? "AI summary" : "Auto"}</span>
        </div>
        <div className="ai-lede" style={{ whiteSpace: "pre-wrap" }}>{r.summary}</div>
        <div className="ai-body">
          As of {fmt(r.window_end)} · window {fmt(r.window_start)} → {fmt(r.window_end)}
          {r.owner_name ? ` · ${r.owner_name}` : ""}
        </div>
      </div>

      {/* counts */}
      {r.has_activity ? (
        <div className="sum-counts">
          <Stat n={c.emails} label="email" tone="email" />
          <Stat n={c.calls} label="call" tone="call" />
          <Stat n={c.meetings} label="meeting" tone="meeting" />
          <Stat n={c.meetings_scheduled} label="scheduled" tone="sched" plural={false} />
          <Stat n={c.tasks} label="task" tone="task" />
          <Stat n={c.movements} label="movement" tone="move" />
          {c.next_step_changed ? <Stat label="next step updated" tone="ns" /> : null}
        </div>
      ) : null}

      {/* movements */}
      {moves.length ? (
        <div className="card card-pad mb14">
          <div className="ic-title" style={{ marginBottom: 4 }}>Movements</div>
          {moves.map((m: any, i: number) => (
            <div className="sum-row" key={i}>
              <div className="sum-ic k-move">⇅</div>
              <div className="sum-main">
                <div className="sum-t"><b>{m.label}</b></div>
                <div className="sum-move">
                  <span className="from">{m.old || "—"}</span>
                  <span className="arrow">→</span>
                  <span className="to">{m.new || "—"}</span>
                </div>
                <div className="sum-meta">{m.by ? `${m.by} · ` : ""}{fmt(m.at)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* next step */}
      {r.next_step_changed_at && r.next_step_text ? (
        <div className="card card-pad mb14">
          <div className="ic-title" style={{ marginBottom: 6 }}>Next Step</div>
          <div className="ic-body" style={{ color: "var(--ink-soft)" }}>{r.next_step_text}</div>
        </div>
      ) : null}

      {/* activity list */}
      {acts.length ? (
        <div className="card card-pad mb14">
          <div className="ic-title" style={{ marginBottom: 4 }}>Activity ({acts.length})</div>
          {acts.map((a: any, i: number) => (
            <div className="sum-row" key={i}>
              <div className={`sum-ic k-${kindClass(a.kind)}`}>{KIND_ICON[a.kind] || "•"}</div>
              <div className="sum-main">
                <div className="sum-t">
                  {a.subject || "(no subject)"}
                  {a.upcoming ? <span className="sum-tag">Upcoming</span> : null}
                </div>
                <div className="sum-meta">
                  {a.kind}{a.direction ? ` · ${a.direction === "in" ? "inbound" : "outbound"}` : ""} · {fmt(a.at)}{a.owner ? ` · ${a.owner}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* avoma calls */}
      {avoma.length ? (
        <div className="card card-pad mb14">
          <div className="ic-title" style={{ marginBottom: 4 }}>Avoma calls</div>
          {avoma.map((m: any, i: number) => (
            <div className="sum-row" key={i}>
              <div className="sum-ic k-call">📞</div>
              <div className="sum-main">
                <div className="sum-t">
                  {m.subject || "(untitled call)"}
                  {m.transcript_ready ? <span className="sum-tag t-pos">Transcript</span> : null}
                </div>
                <div className="sum-meta">{fmt(m.start_at)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
