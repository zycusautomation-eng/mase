"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";

// Read-only view of the `datalake` Supabase project (Avoma call transcripts) so an
// admin can confirm calls are being logged. Uses the PUBLISHABLE/anon key (browser-
// safe, read-only) — NEXT_PUBLIC_DATALAKE_URL / NEXT_PUBLIC_DATALAKE_KEY.
const DL_URL = process.env.NEXT_PUBLIC_DATALAKE_URL || "";
const DL_KEY = process.env.NEXT_PUBLIC_DATALAKE_KEY || "";

type Call = {
  subject: string | null;
  crm_opportunity_id: string | null;
  start_at: string | null;
  synced_at: string | null;
  transcript_ready: boolean | null;
};

async function dlCount(table: string): Promise<number | null> {
  try {
    const r = await fetch(`${DL_URL}/rest/v1/${table}?select=uuid&limit=1`, {
      headers: { apikey: DL_KEY, Authorization: `Bearer ${DL_KEY}`, Prefer: "count=exact" },
      cache: "no-store",
    });
    const cr = r.headers.get("content-range"); // "0-0/1234"
    const total = cr?.split("/")?.[1];
    return total ? parseInt(total, 10) : null;
  } catch {
    return null;
  }
}

export function DatalakeSyncCard() {
  const [meetings, setMeetings] = useState<number | null>(null);
  const [transcripts, setTranscripts] = useState<number | null>(null);
  const [recent, setRecent] = useState<Call[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!DL_URL || !DL_KEY) { setErr("NEXT_PUBLIC_DATALAKE_URL / _KEY not set"); return; }
    setLoading(true); setErr(null);
    try {
      const [m, t] = await Promise.all([dlCount("avoma_meetings"), dlCount("avoma_transcripts")]);
      setMeetings(m); setTranscripts(t);
      const r = await fetch(
        `${DL_URL}/rest/v1/avoma_meetings?select=subject,crm_opportunity_id,start_at,synced_at,transcript_ready&order=synced_at.desc&limit=20`,
        { headers: { apikey: DL_KEY, Authorization: `Bearer ${DL_KEY}` }, cache: "no-store" },
      );
      setRecent(r.ok ? await r.json() : []);
    } catch (e: any) {
      setErr(e?.message || "failed to read datalake");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const fmt = (s: string | null) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

  return (
    <div className="admin-card">
      <h3>Avoma → Datalake sync</h3>
      <p className="admin-desc">
        Live view of the call-transcript datalake. New tracked-opp calls land here within seconds of
        Avoma firing its <code>AINOTE</code> webhook; the 2-year backfill fills the history.
      </p>
      {err && <div className="admin-meta" style={{ color: "var(--red-ink)" }}>⚠ {err}</div>}
      <div className="dq-sync" style={{ flexWrap: "wrap", marginBottom: 12 }}>
        <div className="dq-stat"><b>{meetings ?? "—"}</b><span>calls stored</span></div>
        <div className="dq-stat"><b>{transcripts ?? "—"}</b><span>transcripts</span></div>
        <div className="dq-stat">
          <b style={{ color: recent[0]?.synced_at ? "var(--green-ink)" : undefined }}>{recent[0] ? fmt(recent[0].synced_at) : "—"}</b>
          <span>last synced</span>
        </div>
      </div>
      <div className="admin-actions" style={{ marginBottom: 10 }}>
        <button className="admin-btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh"}</button>
      </div>
      <div className="admin-doclist">
        {recent.length === 0 ? (
          <div className="admin-meta">No calls logged yet.</div>
        ) : (
          recent.map((c, i) => (
            <div key={i} className="admin-docrow">
              <span className="admin-docname">
                {c.transcript_ready ? "📝 " : "▫ "}{c.subject || "(untitled)"}
              </span>
              <span className="admin-meta">
                {c.crm_opportunity_id ? c.crm_opportunity_id.slice(0, 15) : "no-opp"} · synced {fmt(c.synced_at)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
