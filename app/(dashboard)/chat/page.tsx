"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Conversations are stored PER USER in Supabase (table public.mase_chats, RLS
// scoped to auth.uid()) — so each user's chats are private and sync across
// devices. The browser Supabase client carries the signed-in user's session.
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "@/lib/engine/DashboardContext";
import {
  vpsList, teamOwners, scopeRecords, scopeLabel,
  EMPTY_SCOPE, type ChatScope, type ChatScopeMode,
} from "@/lib/engine/helpers";
import MultiSelect, { type Opt } from "@/components/MultiSelect";

interface Msg { role: "user" | "assistant"; content: string }
interface Chat { id: string; title: string; ts: number; messages: Msg[] }

const HINTS = [
  { q: "Which are our best deals to go after next quarter? Run the full qualification drill and rank by genuine winnability, not by stated probability or forecast label.", label: "Best deals to go after" },
  { q: "Which deals look strong on the label (Best Case, high probability) but are actually weak on the facts: engagement, champion, access to power, or competition?", label: "Label vs reality" },
  { q: "Where is competition a genuine threat, and what is the specific factor favouring them on each deal?", label: "Competitive threats" },
  { q: "Which deals are won but unsigned, and what is the exact next step to get each over the line?", label: "Won but unsigned" },
];

const MODES: { key: ChatScopeMode; label: string }[] = [
  { key: "generic", label: "Generic" },
  { key: "vp", label: "VP" },
  { key: "rsd", label: "RSD" },
  { key: "deal", label: "Deal" },
];

// ---- per-user DB persistence (Supabase, RLS-scoped to the signed-in user) ----
async function fetchChats(): Promise<Chat[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("mase_chats")
    .select("id,title,messages,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    title: r.title || "New chat",
    ts: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
    messages: Array.isArray(r.messages) ? r.messages : [],
  }));
}
// Upsert one conversation. user_id is filled by the column default (auth.uid())
// on insert and left untouched on update; RLS guarantees you only ever touch
// your own rows.
async function saveChatDb(rec: Chat): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("mase_chats")
    .upsert(
      { id: rec.id, title: rec.title, messages: rec.messages, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw error;
}
async function deleteChatDb(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("mase_chats").delete().eq("id", id);
  if (error) throw error;
}
function dateLabel(ts: number) { try { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

// Full markdown rendering (GFM: tables, task lists, strikethrough, autolinks)
// so the strategist's structured answers render properly instead of raw pipes.
// `.md` carries the bubble's typographic styling; links open in a new tab.
function Bubble({ text }: { text: string }) {
  return (
    <div className="bubble md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          table: ({ ...props }) => <div className="md-tablewrap"><table {...props} /></div>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Admin-only block to edit the chat agent's system prompt (its behaviour). Reads
// /api/deal-engine/chat/prompt (the active override + the built-in default) and
// writes edits back. The proxy enforces admin on this path; this UI is also only
// rendered for admins. Saved edits apply to everyone's chat on the next message.
function AdminPromptPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [serverPrompt, setServerPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [isOverride, setIsOverride] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    setLoading(true); setNote(null);
    try {
      const r = await fetch("/api/deal-engine/chat/prompt");
      const j = await r.json();
      if (!r.ok || j.error) { setNote(j.error || `Error ${r.status}`); }
      else {
        const p = j.is_override ? (j.prompt || "") : (j.default || "");
        setPrompt(p); setServerPrompt(p);
        setDefaultPrompt(j.default || "");
        setIsOverride(!!j.is_override);
        setLoaded(true);
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setLoading(false);
  }

  function toggle() {
    const o = !open; setOpen(o);
    if (o && !loaded && !loading) load();
  }

  async function save(value: string) {
    setSaving(true); setNote(null);
    try {
      const r = await fetch("/api/deal-engine/chat/prompt", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setNote(j.error || `Error ${r.status}`); }
      else {
        const applied = value.trim() ? value : defaultPrompt;
        setServerPrompt(applied); setPrompt(applied);
        setIsOverride(!!j.is_override);
        setNote(value.trim() ? "Saved — applies on the next message." : "Reset to the default.");
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setSaving(false);
  }

  const dirty = prompt !== serverPrompt;
  return (
    <div className="adminprompt">
      <button className="ap-toggle" onClick={toggle}>
        <span className="ap-caret">{open ? "▾" : "▸"}</span>
        Agent behavior <span className="ap-tag">admin</span>
        {isOverride && <span className="ap-tag ap-custom">custom</span>}
      </button>
      {open && (
        <div className="ap-body">
          <p className="ap-desc">
            Edit the chat agent&apos;s system prompt. Saved changes apply to <b>everyone&apos;s</b> chat
            on the next message — no redeploy. Clear the box &amp; save to restore the default.
          </p>
          {loading ? (
            <div className="ap-status">Loading…</div>
          ) : (
            <>
              <textarea
                className="ap-text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
                placeholder="(agent system prompt)"
              />
              <div className="ap-actions">
                {dirty && <span className="ap-dirty">Unsaved changes</span>}
                <button className="ap-btn" onClick={load} disabled={loading || saving}>
                  ↻ Reload
                </button>
                <button className="ap-btn" onClick={() => setPrompt(defaultPrompt)} disabled={saving || prompt === defaultPrompt || !defaultPrompt}>
                  Load default
                </button>
                <button className="ap-btn" onClick={() => save("")} disabled={saving || !isOverride}>
                  Reset to default
                </button>
                <button className="ap-btn ap-save" onClick={() => save(prompt)} disabled={saving || !dirty || !prompt.trim()}>
                  Save
                </button>
              </div>
              {note && <div className="ap-status">{note}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { records: allRecords, scoped: scopedRecords, locked, blocked, scopeName, realIsAdmin } = useDashboard();
  // When the user is locked to their own scope, the strategist may only ever see
  // their deals — use the scoped set as the entire book for chat.
  const records = locked ? scopedRecords : allRecords;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ChatScope>(EMPTY_SCOPE);
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchChats().then(setChats).catch((e) => console.warn("[chat] load failed", e)); }, []);
  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const vpOpts: Opt[] = useMemo(() => vpsList(records).map((v) => ({ value: v, label: v })), [records]);
  const ownerOpts: Opt[] = useMemo(() => teamOwners(records, []).map((o) => ({ value: o, label: o })), [records]);
  const dealOpts: Opt[] = useMemo(() =>
    [...records]
      .sort((a, b) => `${(a.hard || {}).account_name}`.localeCompare(`${(b.hard || {}).account_name}`))
      .map((r) => ({ value: r.opp_id, label: `${(r.hard || {}).account_name} — ${(r.hard || {}).opp_name}` })),
  [records]);

  const inScope = useMemo(() => scopeRecords(records, scope), [records, scope]);
  const scopeText = scopeLabel(scope, inScope);

  function persist(msgs: Msg[], id: string | null): string {
    const cid = id || crypto.randomUUID();
    const title = ((msgs[0] && msgs[0].content) || "New chat").replace(/\s+/g, " ").slice(0, 52);
    const rec: Chat = { id: cid, title, ts: Date.now(), messages: msgs.slice() };
    // Optimistic local update (touched chat to the top), then persist to the DB
    // in the background. The agent round-trip between the user-message save and
    // the reply save keeps the two writes for a chat ordered.
    setChats((prev) => [rec, ...prev.filter((c) => c.id !== cid)]);
    void saveChatDb(rec).catch((e) => console.warn("[chat] save failed", e));
    return cid;
  }

  async function send(text: string) {
    if (busy || !text.trim()) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    const cid = persist(next, currentId);
    setCurrentId(cid);
    try {
      // Hermetic scoping: send the exact in-scope opportunity IDs and let the
      // backend build context from only those deals (Path B). Generic = whole
      // book (no ids). This honours our custom VP→owner remap and stage fixes
      // because we send the precise records the UI already computed.
      // Locked users always send their scoped opp ids (even in "generic" mode),
      // so the backend can never answer over deals outside their scope.
      const ids = locked
        ? records.map((r) => r.opp_id).filter(Boolean)
        : scope.mode === "generic" ? [] : scopeRecords(records, scope).map((r) => r.opp_id).filter(Boolean);
      const body: any = { messages: next };
      if (ids.length) body.opp_ids = ids;
      const r = await fetch("/api/deal-engine/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j.error) { setError(j.error || `Error ${r.status}`); }
      else {
        const withReply: Msg[] = [...next, { role: "assistant", content: j.answer }];
        setMessages(withReply);
        persist(withReply, cid);
      }
    } catch (e: any) { setError(e?.message || String(e)); }
    setBusy(false);
  }

  function newChat() { setCurrentId(null); setMessages([]); setError(null); }
  function openChat(id: string) { const c = chats.find((x) => x.id === id); if (!c) return; setCurrentId(id); setMessages(c.messages.slice()); setError(null); }
  function deleteChat(id: string) {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (currentId === id) newChat();
    void deleteChatDb(id).catch((e) => console.warn("[chat] delete failed", e));
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = input; setInput(""); send(v); }
  }

  const setMode = (mode: ChatScopeMode) => setScope({ ...EMPTY_SCOPE, mode });
  const scoped = scope.mode !== "generic" && inScope.length !== records.length;

  return (
    <div className="chatwrap">
      <div className="chat-side">
        <button className="newchat" onClick={newChat}>+ New chat</button>
        <div className="chat-list">
          {chats.length === 0 ? (
            <div className="chat-empty">No saved chats yet. Start asking and your conversations are saved here.</div>
          ) : [...chats].sort((a, b) => b.ts - a.ts).map((c) => (
            <div key={c.id} className={`citem ${c.id === currentId ? "active" : ""}`} onClick={() => openChat(c.id)}>
              <div className="ct">{c.title}</div>
              <div className="cd"><span>{dateLabel(c.ts)}</span><span className="del" onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }} title="Delete">✕</span></div>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-main">
        {/* Admin editor — only when the EFFECTIVE viewer is an admin. `locked` is
            simulation-aware (true when simulating a scoped VP/rep), so the panel
            correctly disappears while previewing a non-admin's view. */}
        {realIsAdmin && !locked && <AdminPromptPanel />}
        <div className="chatscope">
          {locked ? (
            <span className="scopelock" title="The strategist only sees your deals">
              {blocked ? "No deals assigned to your account" : <>Scoped to: <b>{scopeName}</b> · {records.length} deal{records.length === 1 ? "" : "s"}</>}
            </span>
          ) : (
          <>
          <div className="cs-modes">
            {MODES.map((m) => (
              <button key={m.key} className={`cs-mode ${scope.mode === m.key ? "active" : ""}`} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          {scope.mode === "vp" ? (
            <MultiSelect allLabel="All VPs" options={vpOpts} selected={scope.vps} onChange={(vps) => setScope({ ...scope, vps })} />
          ) : null}
          {scope.mode === "rsd" ? (
            <MultiSelect allLabel="All RSDs" options={ownerOpts} selected={scope.owners} onChange={(owners) => setScope({ ...scope, owners })} />
          ) : null}
          {scope.mode === "deal" ? (
            <MultiSelect single allLabel="Pick a deal" options={dealOpts} selected={scope.oppId ? [scope.oppId] : []} onChange={(v) => setScope({ ...scope, oppId: v[0] || "" })} />
          ) : null}
          <span className={`cs-pill ${scoped ? "on" : ""}`}>
            {scope.mode === "generic"
              ? `Whole book · ${records.length} deals`
              : scope.mode === "deal" && !scope.oppId
                ? "No deal selected"
                : `${scopeText} · ${inScope.length} deal${inScope.length === 1 ? "" : "s"}`}
          </span>
          {(scope.vps.length || scope.owners.length || scope.oppId) ? (
            <button className="cs-clear" title="Clear selection" onClick={() => setScope({ ...EMPTY_SCOPE, mode: scope.mode })}>✕ Clear</button>
          ) : null}
          </>
          )}
        </div>

        <div className="msgs" ref={msgsRef}>
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">✦</div>
              <h3 className="welcome-h">Ask the strategist about your book</h3>
              <p className="welcome-p">
                Best-deal questions run the full qualification drill — engagement, champion, access to
                power, competition, product fit, risk — tested against the facts, not the forecast label.
              </p>
              <div className="welcome-chips">
                {HINTS.map((hn) => (
                  <button className="welcome-chip" key={hn.label} onClick={() => send(hn.q)}>{hn.label}</button>
                ))}
              </div>
            </div>
          ) : messages.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <div className="who">{m.role === "user" ? "You" : "Strategist"}</div>
              <Bubble text={m.content} />
            </div>
          ))}
          {busy ? (
            <div className="msg assistant">
              <div className="who">Strategist</div>
              <div className="bubble"><span className="typing"><span /><span /><span /></span></div>
            </div>
          ) : null}
          {error ? (
            <div className="msg assistant">
              <div className="who">Strategist</div>
              <div className="bubble"><span className="err">{error}</span></div>
            </div>
          ) : null}
        </div>
        <div className="chatbar">
          <div className="inner">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1} disabled={blocked} placeholder={blocked ? "You don't have access to any deals." : `Ask about ${locked ? scopeName : scope.mode === "generic" ? "the book" : scopeText}… (Enter to send, Shift+Enter for newline)`} />
            <button onClick={() => { const v = input; setInput(""); send(v); }} disabled={busy || blocked}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
