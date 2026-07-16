"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin -> Database Backup. Mirror the main Supabase into the dedicated mase-backup project.
// "Sync now" fires POST /api/deal-engine/backup/sync (incremental by default); a GitHub Actions
// cron runs the same routine every 5 hours. Status polls /api/deal-engine/backup/status.
import { useCallback, useEffect, useRef, useState } from "react";

type Last = {
  started_at?: string | null; finished_at?: string | null; mode?: string | null;
  tables_synced?: number | null; rows_copied?: number | null; status?: string | null;
};
type Status = {
  running: boolean; started_at: string | null; mode: string | null;
  last_run: Last | null; configured?: boolean; error?: string;
};

function ago(iso?: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function BackupSection() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 6000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/deal-engine/backup/status", { cache: "no-store" });
      const j = await r.json();
      if (r.ok) setSt(j);
    } catch { /* keep last-known */ }
  }, []);

  // Poll fast while a backup runs, slow when idle.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      await load();
      if (!active) return;
      timer.current = setTimeout(tick, st?.running ? 5000 : 30000);
    };
    tick();
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, st?.running]);

  async function syncNow(mode: "incremental" | "full") {
    if (mode === "full" && !confirm(
      "Full re-seed copies EVERY row of all tables (~2.8 GB). Use this only for the first seed "
      + "or after a schema change. Continue?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/deal-engine/backup/sync${mode === "full" ? "?mode=full" : ""}`,
        { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      flash("ok", j.status === "already_running"
        ? "A backup is already running."
        : `Backup started (${j.mode}). Progress updates below.`);
      await load();
    } catch (e: any) { flash("err", e?.message || "Couldn't start the backup"); }
    setBusy(false);
  }

  const last = st?.last_run || null;
  const running = !!st?.running;
  const notConfigured = !!st && st.configured === false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="admin-card">
        <h3>Database Backup</h3>
        <p className="admin-desc">
          Mirrors the main database into a dedicated <b>mase-backup</b> Supabase project. It runs
          automatically <b>every 5 hours</b> (incremental — only rows that changed), and you can
          trigger a sync right now. Read-only against production; it never writes to Salesforce or
          the live app.
        </p>
        {notConfigured && (
          <div className="admin-meta" style={{ color: "var(--red-ink)" }}>
            Backup credentials aren’t configured on the server yet (BACKUP_URL / BACKUP_SERVICE_KEY
            in mase/app-env). Ask an infra admin to add them, then Sync now.
          </div>
        )}
        <div className="dq-sync" style={{ flexWrap: "wrap" }}>
          <div className="dq-stat">
            <b style={{ color: running ? "var(--green-ink)" : undefined }}>{running ? "running…" : "idle"}</b>
            <span>state</span>
          </div>
          <div className="dq-stat"><b>{ago(last?.finished_at)}</b><span>last synced</span></div>
          <div className="dq-stat"><b>{last?.mode || "—"}</b><span>last mode</span></div>
          <div className="dq-stat"><b>{last?.tables_synced ?? "—"}</b><span>tables</span></div>
          <div className="dq-stat">
            <b>{last?.rows_copied != null ? Number(last.rows_copied).toLocaleString() : "—"}</b>
            <span>rows copied</span>
          </div>
          <div className="dq-stat">
            <b style={last?.status && last.status !== "ok" ? { color: "var(--red-ink)" } : undefined}>
              {last?.status || "—"}
            </b>
            <span>result</span>
          </div>
        </div>
        <div className="admin-actions" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          <button className="admin-btn primary" disabled={busy || running || notConfigured}
            onClick={() => syncNow("incremental")}>
            {running ? "Syncing…" : "⟳ Sync now"}
          </button>
          <button className="admin-btn" disabled={busy || running || notConfigured}
            onClick={() => syncNow("full")} title="Complete re-copy of every table (~2.8 GB)">
            Full re-seed
          </button>
          {running && st?.started_at && <span className="admin-meta">started {ago(st.started_at)}</span>}
        </div>
        {msg && (
          <div className="admin-meta" style={{ marginTop: 8, color: msg.kind === "err" ? "var(--red-ink)" : "var(--green-ink)" }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
