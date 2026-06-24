"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin -> Run Sweep. Build reusable lists of deals (from the filter bar, or by
// searching + adding single opps), save them shared in public.sweep_lists, then run
// the sweep for a whole list and watch each deal go live. Live status is derived by
// polling /sweep/status (queue header) + /trigger-logs (latest run row per opp) every
// 4s, with an optimistic "running" the moment we fire a rerun. Running = one
// /sweep/rerun {opp_id} per deal; the worker autoscaler sizes the fleet.
import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties,
} from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import type { Rec } from "@/lib/engine/helpers";
import ScopeFilterBar from "@/components/ScopeFilterBar";

type SweepList = {
  id: string; name: string; opp_ids: string[];
  created_by: string | null; created_at: string; updated_at: string;
};
type RunState = { status: string; at: string | null };

const k15 = (s: string) => String(s || "").slice(0, 15);
const FIELD: CSSProperties = {
  font: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--surface2)", color: "var(--ink)",
};
const TH: CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const TD: CSSProperties = { padding: "6px 8px", verticalAlign: "top" };

function dealName(r: Rec): string {
  const h = r?.hard || {};
  return h.opp_name || h.account_name || r?.opp_id || "—";
}
function ownerOf(r: Rec): string { return (r?.hard || {}).owner_name || "—"; }

function pillStyle(kind: "run" | "ok" | "err"): CSSProperties {
  const c = kind === "ok"
    ? { fg: "var(--green-ink, #1a7f37)", bg: "rgba(26,127,55,.12)" }
    : kind === "err"
      ? { fg: "var(--red-ink, #c0341d)", bg: "rgba(192,52,29,.12)" }
      : { fg: "#2563eb", bg: "rgba(37,99,235,.12)" };
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px",
    borderRadius: 999, fontSize: 12, color: c.fg, background: c.bg,
  };
}
function Pill({ s }: { s: RunState }) {
  const st = s.status;
  if (st === "running" || st === "working")
    return <span style={pillStyle("run")}><span style={{ width: 7, height: 7, borderRadius: 999, background: "#2563eb", display: "inline-block" }} />running</span>;
  if (["completed", "done", "success", "ok"].includes(st)) return <span style={pillStyle("ok")}>done</span>;
  if (!st) return <span style={{ color: "var(--muted)", fontSize: 12 }}>idle</span>;
  return <span style={pillStyle("err")}>{st}</span>;
}

export default function RunSweepSection() {
  const { records, filtered } = useDashboard() as { records: Rec[]; filtered: Rec[] };

  const recByOpp = useMemo(() => {
    const m = new Map<string, Rec>();
    for (const r of records) { const id = k15(r.opp_id); if (id) m.set(id, r); }
    return m;
  }, [records]);

  const [lists, setLists] = useState<SweepList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [targetList, setTargetList] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedListId, setSelectedListId] = useState("");

  const [queue, setQueue] = useState<any>(null);
  const [runByOpp, setRunByOpp] = useState<Map<string, RunState>>(new Map());
  const optimistic = useRef<Record<string, number>>({});

  const flash = useCallback((kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 6000);
  }, []);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    try {
      const r = await fetch("/api/sweep-lists", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && Array.isArray(j.lists)) setLists(j.lists);
      else if (!r.ok) flash("err", j?.error || "Couldn't load lists");
    } catch (e: any) { flash("err", e?.message || "Couldn't load lists"); }
    setLoadingLists(false);
  }, [flash]);
  useEffect(() => { void loadLists(); }, [loadLists]);

  // Live poll: queue status + latest run row per opp.
  useEffect(() => {
    let active = true; let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const [s, logs] = await Promise.all([
          fetch("/api/deal-engine/sweep/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
          fetch("/api/deal-engine/trigger-logs?limit=500", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        ]);
        if (!active) return;
        setQueue(s);
        const rows: any[] = logs?.rows || (Array.isArray(logs) ? logs : []);
        const m = new Map<string, RunState>();
        for (const row of rows) {            // rows are newest-first; keep the first per opp
          const id = k15(row.opp_id_15 || row.opp_id || "");
          if (!id || m.has(id)) continue;
          m.set(id, { status: String(row.status || "").toLowerCase(), at: row.created_at || null });
        }
        setRunByOpp(m);
      } catch { /* keep last-known */ }
      if (active) t = setTimeout(tick, 4000);
    };
    tick();
    return () => { active = false; clearTimeout(t); };
  }, []);

  // Effective live status: an optimistic "running" wins for a grace window, unless
  // the backend already reported a fresh terminal status after we fired.
  const liveStatus = useCallback((opp: string): RunState => {
    const id = k15(opp);
    const base = runByOpp.get(id);
    const fired = optimistic.current[id];
    if (fired && Date.now() - fired < 20000) {
      if (base?.at && new Date(base.at).getTime() > fired && base.status !== "running") return base;
      return { status: "running", at: null };
    }
    return base || { status: "", at: null };
  }, [runByOpp]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as Rec[];
    const out: Rec[] = [];
    for (const r of records) {
      const h = r.hard || {};
      const hay = `${h.opp_name || ""} ${h.account_name || ""} ${h.owner_name || ""} ${r.opp_id || ""}`.toLowerCase();
      if (hay.includes(q)) { out.push(r); if (out.length >= 8) break; }
    }
    return out;
  }, [search, records]);

  async function saveFromFilter() {
    const name = newName.trim();
    if (!name) { flash("err", "Name the list first"); return; }
    const ids = filtered.map((r) => k15(r.opp_id)).filter(Boolean);
    if (!ids.length) { flash("err", "No deals match the current filters"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/sweep-lists", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, opp_ids: ids }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setNewName(""); await loadLists();
      flash("ok", `Saved “${name}” with ${ids.length} deal${ids.length === 1 ? "" : "s"}.`);
    } catch (e: any) { flash("err", e?.message || "Save failed"); }
    setBusy(false);
  }

  const patchList = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const r = await fetch(`/api/sweep-lists/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
    setLists((prev) => prev.map((l) => (l.id === id ? j.list : l)));
  }, []);

  async function addOppToList(listId: string, opp: string) {
    const list = lists.find((l) => l.id === listId);
    if (!list) { flash("err", "Pick a list first"); return; }
    const id = k15(opp);
    if (list.opp_ids.map(k15).includes(id)) { flash("err", "Already in that list"); return; }
    try { await patchList(listId, { opp_ids: [...list.opp_ids, id] }); flash("ok", `Added to “${list.name}”.`); }
    catch (e: any) { flash("err", e?.message || "Add failed"); }
  }
  async function removeOppFromList(listId: string, opp: string) {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const id = k15(opp);
    try { await patchList(listId, { opp_ids: list.opp_ids.filter((x) => k15(x) !== id) }); }
    catch (e: any) { flash("err", e?.message || "Remove failed"); }
  }
  async function renameList(listId: string, name: string) {
    try { await patchList(listId, { name }); }
    catch (e: any) { flash("err", e?.message || "Rename failed"); }
  }
  async function deleteList(listId: string, name: string) {
    if (!confirm(`Delete the list “${name}”? (The deals themselves are not affected.)`)) return;
    try {
      const r = await fetch(`/api/sweep-lists/${listId}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || `Failed (${r.status})`); }
      setLists((prev) => prev.filter((l) => l.id !== listId));
      flash("ok", `Deleted “${name}”.`);
    } catch (e: any) { flash("err", e?.message || "Delete failed"); }
  }

  async function fireRerun(id: string): Promise<boolean> {
    try {
      const r = await fetch("/api/deal-engine/sweep/rerun", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ opp_id: id }),
      });
      return r.ok;
    } catch { return false; }
  }
  function markRunning(ids: string[]) {
    const now = Date.now();
    ids.forEach((id) => { optimistic.current[id] = now; });
    setRunByOpp((prev) => { const m = new Map(prev); ids.forEach((id) => m.set(id, { status: "running", at: null })); return m; });
  }

  async function runList(list: SweepList) {
    const ids = list.opp_ids.map(k15).filter(Boolean);
    if (!ids.length) { flash("err", "That list is empty"); return; }
    if (!confirm(`Run the sweep for all ${ids.length} deal${ids.length === 1 ? "" : "s"} in “${list.name}”? The worker fleet autoscales to the backlog.`)) return;
    setBusy(true);
    markRunning(ids);
    let ok = 0, fail = 0, idx = 0;
    const worker = async () => { while (idx < ids.length) { (await fireRerun(ids[idx++])) ? ok++ : fail++; } };
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
    flash(fail ? "err" : "ok", `Queued ${ok}/${ids.length} in “${list.name}”${fail ? ` (${fail} failed to queue)` : ""} — watch them go live below.`);
    setBusy(false);
  }
  async function runOne(id: string) {
    markRunning([id]);
    if (!(await fireRerun(id))) flash("err", "Couldn't queue that one — try again.");
  }

  const q = queue ? {
    status: queue.status as string | undefined,
    done: queue.done || 0,
    working: queue.working ?? (queue.in_progress || 0),
    waiting: queue.waiting || 0,
    failed: queue.failed || 0,
  } : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="admin-card">
        <h3>Run Sweep</h3>
        <p className="admin-desc">
          Build reusable lists of deals — from a filter, or by adding single opportunities — then run the
          whole list and watch each deal go live. The worker fleet <b>autoscales</b> to the backlog, so you
          never scale workers by hand. Lists are shared across all admins.
        </p>
        {q && (
          <div className="dq-sync" style={{ flexWrap: "wrap" }}>
            <div className="dq-stat"><b style={{ color: q.status === "running" ? "var(--green-ink)" : undefined }}>{q.status || "idle"}</b><span>worker</span></div>
            <div className="dq-stat"><b>{q.done}</b><span>done</span></div>
            <div className="dq-stat"><b>{q.working}</b><span>in flight</span></div>
            <div className="dq-stat"><b>{q.waiting}</b><span>waiting</span></div>
            <div className="dq-stat"><b style={q.failed ? { color: "var(--red-ink)" } : undefined}>{q.failed}</b><span>failed</span></div>
          </div>
        )}
      </div>

      {msg && (
        <div className="admin-meta" style={{ color: msg.kind === "err" ? "var(--red-ink)" : "var(--green-ink)" }}>{msg.text}</div>
      )}

      <div className="admin-card">
        <h3>New list from a filter</h3>
        <p className="admin-desc">Scope the book with the filters, then save the matching deals as a named list.</p>
        <ScopeFilterBar />
        <div className="admin-actions" style={{ marginTop: 12, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="admin-meta"><b>{filtered.length}</b> deal{filtered.length === 1 ? "" : "s"} match</span>
          <input style={{ ...FIELD, minWidth: 220 }} placeholder="New list name…" value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveFromFilter()} />
          <button className="admin-btn primary" disabled={busy} onClick={saveFromFilter}>Save as list</button>
        </div>
      </div>

      <div className="admin-card">
        <h3>Add a single opportunity</h3>
        <div className="admin-actions" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input style={{ ...FIELD, minWidth: 280, flex: 1 }} placeholder="Search by deal / account / owner / id…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <select style={FIELD} value={targetList} onChange={(e) => setTargetList(e.target.value)}>
            <option value="">Add to which list…</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {search.trim() && (
          <div className="admin-doclist" style={{ marginTop: 8 }}>
            {matches.length === 0 ? <div className="admin-meta">No matches.</div> : matches.map((r) => (
              <div key={r.opp_id} className="admin-docrow">
                <span className="admin-docname">{dealName(r)}<span className="admin-meta"> — {ownerOf(r)} · {k15(r.opp_id)}</span></span>
                <button className="admin-btn" disabled={!targetList} title={targetList ? "" : "Pick a list first"}
                  onClick={() => addOppToList(targetList, r.opp_id)}>+ Add</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loadingLists ? (
        <div className="admin-meta">Loading lists…</div>
      ) : lists.length === 0 ? (
        <div className="admin-card"><div className="admin-meta">No saved lists yet — create one above.</div></div>
      ) : (() => {
        // Show ONE list at a time, chosen from a dropdown — not all stacked.
        const selected = lists.find((l) => l.id === selectedListId) || lists[0];
        return (
          <>
            <div className="admin-actions" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="admin-meta">Show list:</span>
              <select style={{ ...FIELD, fontWeight: 600, minWidth: 220 }} value={selected.id} onChange={(e) => setSelectedListId(e.target.value)}>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.opp_ids.length})</option>)}
              </select>
              <span className="admin-meta">{lists.length} saved list{lists.length === 1 ? "" : "s"}</span>
            </div>
            <ListCard
              key={selected.id} list={selected} recByOpp={recByOpp} liveStatus={liveStatus} busy={busy}
              onRun={() => runList(selected)} onRunOne={runOne}
              onRemoveOpp={(opp) => removeOppFromList(selected.id, opp)}
              onRename={(name) => renameList(selected.id, name)}
              onDelete={() => deleteList(selected.id, selected.name)}
            />
          </>
        );
      })()}
    </div>
  );
}

function ListCard({
  list, recByOpp, liveStatus, busy, onRun, onRunOne, onRemoveOpp, onRename, onDelete,
}: {
  list: SweepList;
  recByOpp: Map<string, Rec>;
  liveStatus: (opp: string) => RunState;
  busy: boolean;
  onRun: () => void;
  onRunOne: (id: string) => void;
  onRemoveOpp: (id: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(list.name);
  useEffect(() => { setName(list.name); }, [list.name]);
  const ids = list.opp_ids.map(k15).filter(Boolean);
  const runningCount = ids.filter((id) => liveStatus(id).status === "running").length;

  return (
    <div className="admin-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input
          style={{ ...FIELD, fontWeight: 700, minWidth: 200 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { const n = name.trim(); if (n && n !== list.name) onRename(n); else setName(list.name); }}
        />
        <span className="admin-meta">{ids.length} deal{ids.length === 1 ? "" : "s"}{runningCount ? ` · ${runningCount} running` : ""}</span>
        <span style={{ flex: 1 }} />
        <button className="admin-btn primary" disabled={busy || !ids.length} onClick={onRun}>▶ Run list</button>
        <button className="admin-btn" onClick={onDelete}>Delete</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
              <th style={TH}>Deal</th><th style={TH}>Owner</th><th style={TH}>Status</th><th style={{ ...TH, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {ids.length === 0 && (
              <tr><td colSpan={4} style={{ ...TD, color: "var(--muted)" }}>Empty — add opportunities above.</td></tr>
            )}
            {ids.map((id) => {
              const r = recByOpp.get(id);
              const s = liveStatus(id);
              return (
                <tr key={id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={TD}>{r ? dealName(r) : id}<div className="admin-meta">{id}</div></td>
                  <td style={TD}>{r ? ownerOf(r) : "—"}</td>
                  <td style={TD}><Pill s={s} /></td>
                  <td style={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="admin-btn" style={{ padding: "4px 8px" }} disabled={s.status === "running"} onClick={() => onRunOne(id)}>
                      {s.status === "running" ? "…" : "Run"}
                    </button>
                    <button className="admin-btn" style={{ padding: "4px 8px", marginLeft: 6 }} title="Remove from list" onClick={() => onRemoveOpp(id)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
