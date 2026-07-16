"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Navbar sweep-notifications (ADMIN BETA). Polls the backend for in-flight + just-finished
// sweeps and surfaces them in the top bar: a green pulse + "N sweeping", a dropdown listing
// each deal ("sweeping… · salesforce" / "queued" / "updated"), and a "<deal> updated" toast
// when a sweep finishes. Self-contained + additive: just drop <NavbarSweepNotifications /> into
// your TopNav. Reads /api/deal-engine/sweep/active (backend), maps opp_id -> name via the book.
import { useEffect, useRef, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";

type ActiveRow = { opp_id: string; status: string; origin?: string; run_id?: string; updated_at?: string };

export default function NavbarSweepNotifications() {
  const dash = useDashboard() as any;
  const records = dash?.records || [];
  const isAdmin = Boolean(dash?.realIsAdmin || dash?.isAdminView);
  const [rows, setRows] = useState<ActiveRow[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; name: string }[]>([]);
  const prevWorking = useRef<Set<string>>(new Set());

  const nameOf = (oid: string) => {
    const r = records.find((x: any) => String(x.opp_id) === oid || String(x.opp_id).slice(0, 15) === oid.slice(0, 15));
    return r?.hard?.account_name || r?.hard?.opp_name || oid;
  };

  useEffect(() => {
    if (!isAdmin) return;
    let off = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/deal-engine/sweep/active", { cache: "no-store" });
        if (!res.ok || off) return;
        const j = await res.json();
        const active: ActiveRow[] = j.active || [];
        const working = new Set(active.filter((r) => r.status === "working" || r.status === "waiting").map((r) => r.opp_id));
        // A deal that was in-flight last tick and is now done -> flash an "updated" toast.
        const doneNow = active.filter((r) => r.status === "done" && prevWorking.current.has(r.opp_id));
        if (doneNow.length) {
          setToasts((t) => [...t, ...doneNow.map((r) => ({ id: r.opp_id + ":" + (r.updated_at || ""), name: nameOf(r.opp_id) }))]);
        }
        prevWorking.current = working;
        setRows(active);
      } catch { /* a navbar poll must never throw */ }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { off = true; clearInterval(iv); };
  }, [isAdmin, records]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((x) => x.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  if (!isAdmin) return null;
  const running = rows.filter((r) => r.status === "working" || r.status === "waiting");
  const dot = (s: string) => s === "working" ? "#22c55e" : s === "waiting" ? "#f0b400" : s === "failed" ? "#ef4444" : "#9aa3b2";
  const label = (s: string) => s === "working" ? "sweeping…" : s === "waiting" ? "queued" : s === "done" ? "updated" : "failed";

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} title="Live sweep activity"
        style={{ position: "relative", border: "1px solid var(--line,#e2e2ea)", background: "var(--surface,#fff)", borderRadius: 9, padding: "6px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: running.length ? "#22c55e" : "#c4c4cf", boxShadow: running.length ? "0 0 0 3px rgba(34,197,94,.18)" : "none", transition: "box-shadow .2s" }} />
        {running.length ? `${running.length} sweeping` : "Sweeps"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 320, maxHeight: 360, overflowY: "auto", background: "var(--surface,#fff)", border: "1px solid var(--line,#e2e2ea)", borderRadius: 12, boxShadow: "0 12px 40px -12px rgba(16,30,54,.35)", zIndex: 120, padding: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: "var(--ink-faint,#8a8a99)", padding: "6px 8px" }}>LIVE SWEEP ACTIVITY</div>
          {rows.length === 0 ? (
            <div style={{ padding: "10px 8px", color: "var(--ink-faint,#8a8a99)", fontSize: 13 }}>No sweeps running.</div>
          ) : rows.map((r) => (
            <div key={r.opp_id + r.status + (r.updated_at || "")} style={{ display: "flex", alignItems: "center", gap: 9, padding: 8, borderRadius: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot(r.status), flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(r.opp_id)}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint,#8a8a99)" }}>{label(r.status)} · {r.origin || "sweep"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ position: "fixed", right: 18, bottom: 18, display: "flex", flexDirection: "column", gap: 8, zIndex: 200, pointerEvents: "none" }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background: "#0f1b2e", color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 13, boxShadow: "0 10px 30px -8px rgba(0,0,0,.4)", maxWidth: 300 }}>
            ✓ <b>{t.name}</b> updated
          </div>
        ))}
      </div>
    </div>
  );
}
