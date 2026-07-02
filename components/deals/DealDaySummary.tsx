"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// "24h Summary" drawer tab. Reads the deal_daily_summaries table directly via the
// browser Supabase client (anon SELECT, same deal DB as deal_records) — no backend
// endpoint required. Renders inside the .ddw scope, so it reuses the drawer's
// card / ic-title / ai-hero / pill styles; summary-specific bits are inline-styled.
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

function Chip({ n, label, tone = "neu" }: { n: number; label: string; tone?: string }) {
  if (!n) return null;
  const tones: Record<string, [string, string]> = {
    email: ["#e4f1fb", "#2b8fd6"], call: ["#e7f6ec", "#1f9d57"],
    meeting: ["#eceafe", "#6b5bf0"], sched: ["#f4f4fa", "#7c8198"],
    move: ["#fbf0df", "#b26a12"], ns: ["#fdebef", "#d23b54"], neu: ["#eef0f6", "#6b6f86"],
  };
  const [bg, fg] = tones[tone] || tones.neu;
  return (
    <span className="pill" style={{ background: bg, color: fg }}>
      {n} {label}{n !== 1 ? "s" : ""}
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
      <div className="ai-hero" style={{ marginBottom: 14 }}>
        <div className="spine" />
        <div className="ai-head">
          <div className="ai-mark">🕐</div>
          <div className="ai-title">What happened in the last 24 hours</div>
          <span className="pill" style={{
            marginLeft: "auto",
            background: isClaude ? "#eceafe" : "#eef0f6",
            color: isClaude ? "#6b5bf0" : "#6b6f86",
          }}>{isClaude ? "AI summary" : "auto"}</span>
        </div>
        <div className="ai-lede" style={{ whiteSpace: "pre-wrap" }}>{r.summary}</div>
        <div className="ai-body">
          As of {fmt(r.window_end)} · window {fmt(r.window_start)} → {fmt(r.window_end)}
          {r.owner_name ? ` · ${r.owner_name}` : ""}
        </div>
      </div>

      {/* counts */}
      {r.has_activity ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <Chip n={c.emails} label="email" tone="email" />
          <Chip n={c.calls} label="call" tone="call" />
          <Chip n={c.meetings} label="meeting" tone="meeting" />
          {c.meetings_scheduled ? <span className="pill" style={{ background: "#f4f4fa", color: "#7c8198" }}>{c.meetings_scheduled} scheduled</span> : null}
          <Chip n={c.tasks} label="task" tone="neu" />
          <Chip n={c.movements} label="movement" tone="move" />
          {c.next_step_changed ? <span className="pill" style={{ background: "#fdebef", color: "#d23b54" }}>next step updated</span> : null}
        </div>
      ) : null}

      {/* movements */}
      {moves.length ? (
        <div className="card card-pad mb14">
          <div className="ic-title" style={{ marginBottom: 10 }}>Movements</div>
          {moves.map((m: any, i: number) => (
            <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line-soft)" : "none", fontSize: 13 }}>
              <b style={{ color: "var(--ink)" }}>{m.label}</b>{" "}
              <span style={{ color: "var(--ink-soft)" }}>{m.old || "—"}</span>
              <span style={{ color: "var(--ink-faint)" }}> → </span>
              <b style={{ color: "var(--ink)" }}>{m.new || "—"}</b>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 3 }}>
                {m.by ? `${m.by} · ` : ""}{fmt(m.at)}
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
          <div className="ic-title" style={{ marginBottom: 8 }}>Activity ({acts.length})</div>
          {acts.map((a: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 11, padding: "9px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
              <span style={{ fontSize: 14, width: 18, textAlign: "center", flex: "none" }}>{KIND_ICON[a.kind] || "•"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.4 }}>
                  {a.subject || "(no subject)"}
                  {a.upcoming ? <span className="pill" style={{ marginLeft: 7, background: "#f4f4fa", color: "#7c8198" }}>upcoming</span> : null}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 3 }}>
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
          <div className="ic-title" style={{ marginBottom: 8 }}>Avoma calls</div>
          {avoma.map((m: any, i: number) => (
            <div key={i} style={{ padding: "7px 0", borderTop: i ? "1px solid var(--line-soft)" : "none", fontSize: 13, color: "var(--ink)" }}>
              📞 {m.subject || "(untitled call)"}
              <span style={{ fontSize: 11, color: "var(--ink-faint)", marginLeft: 8 }}>
                {fmt(m.start_at)}{m.transcript_ready ? " · transcript ready" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
