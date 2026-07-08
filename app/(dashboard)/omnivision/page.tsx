"use client";
// Omnivision — Scoring Version Studio. SUPER-ADMIN ONLY (Aleen + Sam).
// The control plane for the five versioned engine instructions (Signal Extraction,
// Win Position, Deal Momentum, To-Do Generation, 24-Hour Summary), per the
// MASE_Scoring_Studio handoff:
//   · independent semver per engine (minor 10.1 / major 11.0), full changelog trail
//   · edit → a single unlocked DRAFT; while a draft is unlocked the engine is
//     BLOCKED from adopting a new instruction (lock-before-run)
//   · LOCK requires a changelog note; every runtime output stamps the exact locked
//     version(s) it used (provenance)
// Data: backend Supabase `scoring_instructions` via /api/deal-engine/scoring-studio/*
// (the proxy enforces super-admin on every method).
import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Lock, LockOpen, History, RefreshCw, Trash2, Pencil, ShieldCheck } from "lucide-react";

type EngineCard = {
  engine: string; name: string;
  active: { version: string; kind: string; note: string; locked_by: string | null; locked_at: string | null } | null;
  has_draft: boolean; draft_saved_at: string | null; versions: number;
};
type TrailRow = {
  version: string; kind: string; note: string; locked: boolean;
  locked_by: string | null; locked_at: string | null; created_at: string;
};
type Trail = { engine: string; name: string; trail: TrailRow[]; draft: TrailRow | null };

const API = "/api/deal-engine/scoring-studio";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");

export default function OmnivisionPage() {
  const { isSuperAdminView } = useDashboard();
  if (!isSuperAdminView)
    return (
      <div className="dq-lock"><div className="dq-lock-card">
        <div className="dq-lock-ttl">🔒 Super-admin</div>
        <div className="dq-lock-sub">Omnivision — the Scoring Version Studio — is restricted to platform super-admins.</div>
      </div></div>
    );
  return <Studio />;
}

function Studio() {
  const [engines, setEngines] = useState<EngineCard[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);
  const [viewing, setViewing] = useState<{ version: string; content: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [lockOpen, setLockOpen] = useState(false);
  const [lockKind, setLockKind] = useState<"minor" | "major">("minor");
  const [lockNote, setLockNote] = useState("");
  const [me, setMe] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.email || "")).catch(() => {});
  }, []);

  const flash = (msg: string) => { setOk(msg); setTimeout(() => setOk(""), 3500); };

  const loadEngines = useCallback(async () => {
    try {
      const d = await j<{ engines: EngineCard[] }>("/engines");
      setEngines(d.engines);
      if (!sel && d.engines.length) setSel(d.engines[0].engine);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [sel]);

  const loadTrail = useCallback(async (engine: string) => {
    try {
      setTrail(await j<Trail>(`/${engine}/trail`));
      setViewing(null); setEditing(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { loadEngines(); }, [loadEngines]);
  useEffect(() => { if (sel) loadTrail(sel); }, [sel, loadTrail]);

  const openVersion = async (version: string) => {
    if (!sel) return;
    setBusy(true); setErr("");
    try {
      const row = await j<{ version: string; content: string }>(`/${sel}/version/${version}`);
      setViewing({ version: row.version, content: row.content });
      setEditing(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const startEdit = async () => {
    if (!sel || !trail) return;
    setBusy(true); setErr("");
    try {
      // Prefill: the existing draft if there is one, else the latest locked text.
      const src = trail.draft
        ? await j<{ content: string }>(`/${sel}/version/draft`)
        : await j<{ content: string }>(`/${sel}/version/${trail.trail.find(t => t.locked)?.version}`);
      setDraftText(src.content);
      setEditing(true); setViewing(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const saveDraft = async () => {
    if (!sel) return;
    setBusy(true); setErr("");
    try {
      await j(`/${sel}/draft`, { method: "POST", body: JSON.stringify({ content: draftText, author: me }) });
      flash("Draft saved — the engine is BLOCKED from adopting a new instruction until you lock.");
      await loadEngines(); await loadTrail(sel);
      setEditing(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const discardDraft = async () => {
    if (!sel) return;
    if (!confirm("Discard the unlocked draft? The latest locked version stays active.")) return;
    setBusy(true); setErr("");
    try {
      await j(`/${sel}/draft`, { method: "DELETE" });
      flash("Draft discarded.");
      await loadEngines(); await loadTrail(sel);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const doLock = async () => {
    if (!sel || !lockNote.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await j<{ version: string }>(`/${sel}/lock`, {
        method: "POST",
        body: JSON.stringify({ kind: lockKind, note: lockNote.trim(), locked_by: me }),
      });
      flash(`Locked as v${r.version} — the engine adopts it on the next run.`);
      setLockOpen(false); setLockNote("");
      await loadEngines(); await loadTrail(sel);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const cur = engines.find((e) => e.engine === sel);

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Eye className="h-7 w-7 text-indigo-600" />
        <div>
          <h1 className="text-2xl font-semibold">Omnivision — Scoring Version Studio</h1>
          <p className="text-sm text-slate-500">
            The five versioned engine instructions. Edit → draft → <b>lock</b> (with a changelog note) — nothing
            sweeps, scores, or generates on an unlocked draft, and every output is stamped with the versions it ran on.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> super-admin</Badge>
          <Button variant="outline" size="sm" onClick={() => { loadEngines(); if (sel) loadTrail(sel); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {err && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm">{err}</div>}
      {ok && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 text-sm">{ok}</div>}

      {/* Engine cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {engines.map((e) => (
          <button key={e.engine} onClick={() => setSel(e.engine)}
            className={`text-left rounded-lg border p-3 transition-shadow hover:shadow ${sel === e.engine ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200"}`}>
            <div className="text-[13px] font-medium leading-tight">{e.name}</div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <Badge className="bg-slate-900 text-white">v{e.active?.version ?? "—"}</Badge>
              {e.has_draft
                ? <Badge className="bg-amber-100 text-amber-800 gap-1"><LockOpen className="h-3 w-3" />draft</Badge>
                : <Badge className="bg-emerald-100 text-emerald-700 gap-1"><Lock className="h-3 w-3" />locked</Badge>}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">{e.versions} versions</div>
          </button>
        ))}
      </div>

      {cur?.has_draft && (
        <div className="rounded-md bg-amber-50 border border-amber-300 text-amber-800 px-3 py-2 text-sm flex items-center gap-2">
          <LockOpen className="h-4 w-4 shrink-0" />
          <span><b>{cur.name}</b> has an UNLOCKED draft — the engine keeps running its last locked version
            (v{cur.active?.version}) and will not adopt the edit until it is locked.</span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setLockOpen(true)} disabled={busy}><Lock className="h-4 w-4 mr-1" />Lock…</Button>
            <Button size="sm" variant="outline" onClick={discardDraft} disabled={busy}><Trash2 className="h-4 w-4 mr-1" />Discard</Button>
          </span>
        </div>
      )}

      {trail && (
        <div className="grid md:grid-cols-[380px_1fr] gap-4">
          {/* Version trail */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" /> {trail.name} — version trail
                <span className="ml-auto">
                  <Button size="sm" onClick={startEdit} disabled={busy}>
                    <Pencil className="h-4 w-4 mr-1" />{trail.draft ? "Edit draft" : "Edit"}
                  </Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {trail.draft && (
                <button onClick={() => openVersion("draft")}
                  className="w-full text-left rounded-md border border-amber-300 bg-amber-50 p-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                    <LockOpen className="h-3.5 w-3.5" /> draft (unlocked)
                  </div>
                  <div className="text-xs text-amber-700 mt-0.5">{trail.draft.note} · {fmtDate(trail.draft.created_at)}</div>
                </button>
              )}
              {trail.trail.map((v) => (
                <button key={v.version} onClick={() => openVersion(v.version)}
                  className={`w-full text-left rounded-md border p-2 hover:bg-slate-50 ${viewing?.version === v.version ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200"}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">v{v.version}</span>
                    <Badge variant="outline" className="text-[10px]">{v.kind}</Badge>
                    {v.locked && <Lock className="h-3 w-3 text-emerald-600" />}
                    <span className="ml-auto text-[11px] text-slate-400">{fmtDate(v.locked_at || v.created_at)}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1 line-clamp-3">{v.note}</div>
                  {v.locked_by && <div className="text-[11px] text-slate-400 mt-0.5">locked by {v.locked_by}</div>}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Viewer / editor */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {editing ? "Editing → saves as the unlocked draft"
                  : viewing ? `v${viewing.version} — instruction text (read-only)`
                  : "Select a version to view, or Edit to draft a change"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-2">
                  <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)}
                    className="w-full h-[520px] rounded-md border border-slate-300 p-3 font-mono text-[12.5px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    spellCheck={false} />
                  <div className="flex gap-2">
                    <Button onClick={saveDraft} disabled={busy || !draftText.trim()}>Save draft</Button>
                    <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                    <span className="text-xs text-slate-500 self-center">
                      Saving creates/updates the single unlocked draft; lock it to make it live.
                    </span>
                  </div>
                </div>
              ) : viewing ? (
                <pre className="w-full h-[560px] overflow-auto rounded-md bg-slate-950 text-slate-100 p-4 text-[12.5px] leading-relaxed whitespace-pre-wrap">{viewing.content}</pre>
              ) : (
                <div className="h-[300px] grid place-items-center text-sm text-slate-400">
                  Pick a version on the left — the full instruction text renders here.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Lock modal */}
      {lockOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onClick={() => !busy && setLockOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-[92vw] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5" /> Lock {cur?.name}</div>
            <div className="text-sm text-slate-600">
              Locking promotes the draft to the next version and makes it the instruction the engine runs.
              Current: <b>v{cur?.active?.version}</b> → next: <b>{lockKind === "minor"
                ? `v${cur?.active ? `${cur.active.version.split(".")[0]}.${Number(cur.active.version.split(".")[1] || 0) + 1}` : "10.0"}`
                : `v${cur?.active ? `${Number(cur.active.version.split(".")[0]) + 1}.0` : "10.0"}`}</b>
            </div>
            <div className="flex gap-3">
              {(["minor", "major"] as const).map((k) => (
                <label key={k} className={`flex-1 rounded-md border p-2 cursor-pointer text-sm ${lockKind === k ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}>
                  <input type="radio" className="mr-2" checked={lockKind === k} onChange={() => setLockKind(k)} />
                  <b className="capitalize">{k}</b>
                  <div className="text-xs text-slate-500 mt-1">{k === "minor" ? "tweak / added rule (10.1 → 10.2)" : "changed behaviour (10.x → 11.0)"}</div>
                </label>
              ))}
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Changelog note <span className="text-rose-600">*</span></div>
              <textarea value={lockNote} onChange={(e) => setLockNote(e.target.value)} rows={3}
                placeholder="What changed and why — this is the audit trail every score traces back to."
                className="w-full rounded-md border border-slate-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLockOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={doLock} disabled={busy || !lockNote.trim()}><Lock className="h-4 w-4 mr-1" />Lock version</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
