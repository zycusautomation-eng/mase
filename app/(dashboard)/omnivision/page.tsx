"use client";
// Omnivision — Scoring Version Studio. SUPER-ADMIN ONLY (Aleen + Sam; enforced in the
// sidebar, here, AND the deal-engine proxy on every method).
// Styled with the platform's design tokens (dashboard.css: --surface/--line/--ink/--accent,
// .admin-card) — no Tailwind-slate borders, no glow. Version switching is OPTIMISTIC:
// clicking a version activates it instantly and renders a skeleton while the text loads;
// loaded versions are cached so revisits are instant.
import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { createClient } from "@/lib/supabase/client";
import { Eye, Lock, LockOpen, History, RefreshCw, Trash2, Pencil, ShieldCheck } from "lucide-react";

type EngineCard = {
  engine: string; name: string;
  kind?: "engine" | "reference";           // Studio v2: reference assets (vendor dictionary, playbook)
  ref_token?: string | null;               // e.g. "{{ref:vendor-dictionary}}" — how engines cite it
  active: { version: string; kind: string; note: string; locked_by: string | null; locked_at: string | null } | null;
  has_draft: boolean; draft_saved_at: string | null; versions: number;
};
type TrailRow = {
  version: string; kind: string; note: string; locked: boolean;
  locked_by: string | null; locked_at: string | null; created_at: string;
};
type Trail = { engine: string; name: string; trail: TrailRow[]; draft: TrailRow | null };

const API = "/api/deal-engine/scoring-studio";
const line = "1px solid var(--line)";
const ink2 = { color: "var(--ink2)" } as const;

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

function Skeleton() {
  return (
    <div style={{ display: "grid", gap: 10, padding: 4 }}>
      {[92, 100, 84, 96, 70, 88, 60].map((w, i) => (
        <div key={i} style={{
          height: 12, width: `${w}%`, borderRadius: 6, background: "var(--line)",
          opacity: 0.7, animation: "ovpulse 1.1s ease-in-out infinite", animationDelay: `${i * 90}ms`,
        }} />
      ))}
      <style>{`@keyframes ovpulse{0%,100%{opacity:.35}50%{opacity:.8}}`}</style>
    </div>
  );
}

function Btn({ children, onClick, disabled, kind = "ghost" }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; kind?: "primary" | "ghost" | "danger";
}) {
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, cursor: disabled ? "default" : "pointer",
    padding: "7px 12px", fontSize: 12.5, fontWeight: 600, border: line, opacity: disabled ? 0.55 : 1,
    background: "var(--surface)", color: "var(--ink)",
  };
  if (kind === "primary") Object.assign(base, { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" });
  if (kind === "danger") Object.assign(base, { color: "#b3261e" });
  return <button type="button" style={base} onClick={onClick} disabled={disabled}>{children}</button>;
}

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
  const [trailLoading, setTrailLoading] = useState(false);
  const [viewing, setViewing] = useState<{ version: string; content: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [lockOpen, setLockOpen] = useState(false);
  const [lockKind, setLockKind] = useState<"minor" | "major">("minor");
  const [lockNote, setLockNote] = useState("");
  const [me, setMe] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  // engine:version -> content cache, so switching versions is instant after first load
  const cache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.email || "")).catch(() => {});
  }, []);

  const flash = (msg: string) => { setOk(msg); setTimeout(() => setOk(""), 3500); };

  const loadEngines = useCallback(async () => {
    try {
      const d = await j<{ engines: EngineCard[] }>("/engines");
      setEngines(d.engines);
      setSel((s) => s ?? (d.engines[0]?.engine || null));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  const loadTrail = useCallback(async (engine: string) => {
    setTrailLoading(true);
    try {
      setTrail(await j<Trail>(`/${engine}/trail`));
      setViewing(null); setEditing(false); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setTrailLoading(false);
  }, []);

  useEffect(() => { loadEngines(); }, [loadEngines]);
  useEffect(() => { if (sel) loadTrail(sel); }, [sel, loadTrail]);

  // OPTIMISTIC version open: activate the tab immediately, skeleton the pane, cache the text.
  const openVersion = useCallback((version: string) => {
    if (!sel) return;
    setEditing(false); setErr("");
    const key = `${sel}:${version}`;
    const hit = cache.current.get(key);
    setViewing({ version, content: hit ?? null });
    if (hit !== undefined) return;
    j<{ version: string; content: string }>(`/${sel}/version/${version}`)
      .then((row) => {
        cache.current.set(key, row.content);
        setViewing((v) => (v && v.version === version ? { version, content: row.content } : v));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [sel]);

  const startEdit = async () => {
    if (!sel || !trail) return;
    setBusy(true); setErr("");
    try {
      const from = trail.draft ? "draft" : trail.trail.find((t) => t.locked)?.version;
      const key = `${sel}:${from}`;
      let text = cache.current.get(key);
      if (text === undefined) {
        const src = await j<{ content: string }>(`/${sel}/version/${from}`);
        text = src.content; cache.current.set(key, text);
      }
      setDraftText(text || "");
      setEditing(true); setViewing(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const saveDraft = async () => {
    if (!sel) return;
    setBusy(true); setErr("");
    try {
      await j(`/${sel}/draft`, { method: "POST", body: JSON.stringify({ content: draftText, author: me }) });
      cache.current.set(`${sel}:draft`, draftText);
      flash("Draft saved — the engine keeps running its last LOCKED version until you lock this.");
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
      cache.current.delete(`${sel}:draft`);
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
      flash(`Locked as v${r.version} — the sweep adopts it on the next run.`);
      setLockOpen(false); setLockNote("");
      await loadEngines(); await loadTrail(sel);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const cur = engines.find((e) => e.engine === sel);

  return (
    <div style={{ padding: "22px 26px", maxWidth: 1240, margin: "0 auto", display: "grid", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Eye size={26} style={{ color: "var(--accent)" }} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Omnivision — Scoring Version Studio</h1>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, ...ink2 }}>
            The versioned engine instructions + reference assets (vendor dictionary, deal playbook).
            Edit → draft → <b>lock</b> (changelog note required) — the sweep only ever runs LOCKED
            versions, and every output is stamped with the versions it ran on. The <b>Deal Sweep</b> asset
            IS the sweep&apos;s base system prompt; references are cited by the engines via <code>{"{{ref:…}}"}</code>.
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11.5, fontWeight: 600, ...ink2, border: line, borderRadius: 999, padding: "4px 10px" }}>
            <ShieldCheck size={13} /> super-admin
          </span>
          <Btn onClick={() => { loadEngines(); if (sel) loadTrail(sel); }}><RefreshCw size={14} /></Btn>
        </div>
      </div>

      {err && <div style={{ border: "1px solid #e4b4b0", background: "#fdf3f2", color: "#b3261e", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>{err}</div>}
      {ok && <div style={{ border: "1px solid #b5d4bd", background: "#f1f8f3", color: "#1b6e3a", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>{ok}</div>}

      {/* Asset cards (engines + reference assets) — platform surface, accent border when active, NO glow */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
        {engines.map((e) => {
          const active = sel === e.engine;
          const isRef = e.kind === "reference";
          return (
            <button key={e.engine} type="button" onClick={() => setSel(e.engine)}
              className="admin-card"
              style={{
                textAlign: "left", cursor: "pointer", padding: "12px 14px",
                border: active ? "1.5px solid var(--accent)" : line,
                background: "var(--surface)", borderRadius: 12,
              }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 }}>{e.name}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: "var(--ink)", color: "var(--surface)", borderRadius: 6, padding: "2px 7px" }}>
                  v{e.active?.version ?? "—"}
                </span>
                {e.has_draft
                  ? <span style={{ fontSize: 11, fontWeight: 600, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #ecd9ad", borderRadius: 6, padding: "2px 7px", display: "inline-flex", gap: 4, alignItems: "center" }}><LockOpen size={11} />draft</span>
                  : <span style={{ fontSize: 11, fontWeight: 600, color: "#1b6e3a", background: "#f1f8f3", border: "1px solid #b5d4bd", borderRadius: 6, padding: "2px 7px", display: "inline-flex", gap: 4, alignItems: "center" }}><Lock size={11} />locked</span>}
                {isRef && (
                  <span title={e.ref_token ? `Engines cite this as ${e.ref_token}` : "Reference asset"}
                    style={{ fontSize: 11, fontWeight: 600, color: "#4a4460", background: "#f2f0fa", border: "1px solid #d5cfeb", borderRadius: 6, padding: "2px 7px" }}>
                    reference
                  </span>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, ...ink2 }}>
                {e.versions} versions{isRef && e.ref_token ? ` · cited as ${e.ref_token}` : ""}
              </div>
            </button>
          );
        })}
      </div>

      {cur?.has_draft && (
        <div style={{ border: "1px solid #ecd9ad", background: "#fdf4e3", color: "#6b4a00", borderRadius: 10, padding: "9px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <LockOpen size={15} />
          <span><b>{cur.name}</b> has an UNLOCKED draft — the engine keeps running v{cur.active?.version} until you lock it.</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Btn kind="primary" onClick={() => setLockOpen(true)} disabled={busy}><Lock size={13} />Lock…</Btn>
            <Btn kind="danger" onClick={discardDraft} disabled={busy}><Trash2 size={13} />Discard</Btn>
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14, alignItems: "start" }}>
        {/* Version trail */}
        <div className="admin-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <History size={15} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{trail?.name || "…"} — version trail</span>
            <span style={{ marginLeft: "auto" }}>
              <Btn kind="primary" onClick={startEdit} disabled={busy || trailLoading}>
                <Pencil size={13} />{trail?.draft ? "Edit draft" : "Edit"}
              </Btn>
            </span>
          </div>
          {trailLoading ? <Skeleton /> : (
            <div style={{ display: "grid", gap: 8 }}>
              {trail?.draft && (
                <button type="button" onClick={() => openVersion("draft")}
                  style={{ textAlign: "left", borderRadius: 10, padding: 10, cursor: "pointer", border: viewing?.version === "draft" ? "1.5px solid var(--accent)" : "1px solid #ecd9ad", background: "#fdf4e3" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700, color: "#8a5a00" }}>
                    <LockOpen size={13} /> draft (unlocked)
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8a5a00", marginTop: 3 }}>{fmtDate(trail.draft.created_at)}</div>
                </button>
              )}
              {trail?.trail.map((v) => {
                const active = viewing?.version === v.version;
                return (
                  <button key={v.version} type="button" onClick={() => openVersion(v.version)}
                    style={{
                      textAlign: "left", borderRadius: 10, padding: 10, cursor: "pointer",
                      border: active ? "1.5px solid var(--accent)" : line, background: "var(--surface)",
                    }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13 }}>
                      <b>v{v.version}</b>
                      <span style={{ fontSize: 10.5, fontWeight: 600, border: line, borderRadius: 5, padding: "1px 6px", ...ink2 }}>{v.kind}</span>
                      {v.locked && <Lock size={12} style={{ color: "#1b6e3a" }} />}
                      <span style={{ marginLeft: "auto", fontSize: 11, ...ink2 }}>{fmtDate(v.locked_at || v.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.45, ...ink2, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.note}</div>
                    {v.locked_by && <div style={{ fontSize: 11, marginTop: 3, ...ink2 }}>locked by {v.locked_by}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Viewer / editor */}
        <div className="admin-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            {editing ? "Editing → saves as the unlocked draft"
              : viewing ? `v${viewing.version} — instruction text (read-only)`
              : "Select a version to view, or Edit to draft a change"}
          </div>
          {editing ? (
            <div style={{ display: "grid", gap: 10 }}>
              <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} spellCheck={false}
                style={{ width: "100%", height: 520, border: line, borderRadius: 10, padding: 12, font: "12.5px/1.6 ui-monospace, monospace", background: "var(--surface)", color: "var(--ink)", outline: "none", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Btn kind="primary" onClick={saveDraft} disabled={busy || !draftText.trim()}>Save draft</Btn>
                <Btn onClick={() => setEditing(false)} disabled={busy}>Cancel</Btn>
                <span style={{ fontSize: 11.5, ...ink2 }}>Saving creates/updates the single unlocked draft; lock it to make it live.</span>
              </div>
            </div>
          ) : viewing ? (
            viewing.content === null ? <Skeleton /> : (
              <pre style={{ width: "100%", height: 560, overflow: "auto", borderRadius: 10, border: line, background: "var(--surface)", color: "var(--ink)", padding: 14, font: "12.5px/1.65 ui-monospace, monospace", whiteSpace: "pre-wrap", margin: 0 }}>{viewing.content}</pre>
            )
          ) : (
            <div style={{ height: 280, display: "grid", placeItems: "center", fontSize: 13, ...ink2 }}>
              Pick a version on the left — the full instruction text renders here.
            </div>
          )}
        </div>
      </div>

      {/* Lock modal */}
      {lockOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(15,18,25,.42)", display: "grid", placeItems: "center" }}
          onClick={() => !busy && setLockOpen(false)}>
          <div className="admin-card" style={{ width: 520, maxWidth: "92vw", padding: 20, display: "grid", gap: 14, background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 16, fontWeight: 700 }}><Lock size={17} /> Lock {cur?.name}</div>
            <div style={{ fontSize: 13, ...ink2 }}>
              Locking promotes the draft to the next version — the instruction the sweep runs.
              Current <b>v{cur?.active?.version}</b> → next <b>{lockKind === "minor"
                ? `v${cur?.active ? `${cur.active.version.split(".")[0]}.${Number(cur.active.version.split(".")[1] || 0) + 1}` : "10.0"}`
                : `v${cur?.active ? `${Number(cur.active.version.split(".")[0]) + 1}.0` : "10.0"}`}</b>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {(["minor", "major"] as const).map((k) => (
                <label key={k} style={{ flex: 1, borderRadius: 10, padding: 10, cursor: "pointer", fontSize: 13, border: lockKind === k ? "1.5px solid var(--accent)" : line }}>
                  <input type="radio" style={{ marginRight: 7 }} checked={lockKind === k} onChange={() => setLockKind(k)} />
                  <b style={{ textTransform: "capitalize" }}>{k}</b>
                  <div style={{ fontSize: 11.5, marginTop: 4, ...ink2 }}>{k === "minor" ? "tweak / added rule (10.1 → 10.2)" : "changed behaviour (10.x → 11.0)"}</div>
                </label>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Changelog note <span style={{ color: "#b3261e" }}>*</span></div>
              <textarea value={lockNote} onChange={(e) => setLockNote(e.target.value)} rows={3}
                placeholder="What changed and why — this is the audit trail every score traces back to."
                style={{ width: "100%", border: line, borderRadius: 10, padding: 10, fontSize: 13, background: "var(--surface)", color: "var(--ink)", outline: "none" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn onClick={() => setLockOpen(false)} disabled={busy}>Cancel</Btn>
              <Btn kind="primary" onClick={doLock} disabled={busy || !lockNote.trim()}><Lock size={13} />Lock version</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
