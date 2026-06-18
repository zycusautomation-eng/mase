"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Conversations are stored PER USER in Supabase (table public.mase_chats, RLS
// scoped to auth.uid()) — so each user's chats are private and sync across
// devices. The browser Supabase client carries the signed-in user's session.
//
// STREAMING: a message is sent to POST /api/deal-engine/chat/async which returns
// {chat_id} fast; the backend then runs the agent and writes each step
// (status/thinking/tool_call/tool_result/final/error) as a row to the SHARED
// chat_messages table. This page subscribes to chat_messages over Supabase
// realtime (with a polling fallback + watchdog) and renders the agent's live
// thinking + tool trace, ending in the final answer. Ported from VIBE's
// ChatInterface realtime architecture.
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

// A tool step in the live "agent working" trace.
interface Step { type: "thinking" | "tool_call" | "tool_result"; tool?: string; args?: string; content?: string }
// A chat message. `thinkingSteps`/`isProcessing` are present only on a live
// assistant turn; persisted chats keep just {role, content}.
interface Msg { role: "user" | "assistant"; content: string; thinkingSteps?: Step[]; isProcessing?: boolean }
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

// Parse a chat_messages.metadata field that may be a JSON string or an object.
function parseMeta(meta: any): any {
  if (!meta) return {};
  if (typeof meta === "string") { try { return JSON.parse(meta) || {}; } catch { return {}; } }
  return meta;
}

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

// Collapsible "Agent working…" accordion — the live trace of thinking + tool
// steps. Expands to show each step (reasoning lines + tool call/result pairs).
function AgentTrace({ steps, processing }: { steps: Step[]; processing: boolean }) {
  const [open, setOpen] = useState(processing);
  // Keep it open while the agent is still working; collapse once done unless the
  // user has explicitly toggled it (we only auto-open on the processing edge).
  const wasProcessing = useRef(processing);
  useEffect(() => {
    if (processing && !wasProcessing.current) setOpen(true);
    wasProcessing.current = processing;
  }, [processing]);

  if (!steps || steps.length === 0) {
    return processing ? (
      <div className="chat-working">
        <span className="typing"><span /><span /><span /></span>
        <span className="cw-label">Working…</span>
      </div>
    ) : null;
  }

  const toolCount = steps.filter((s) => s.type === "tool_call").length;
  const summary = processing
    ? "Agent working…"
    : `Agent steps${toolCount ? ` · ${toolCount} tool call${toolCount === 1 ? "" : "s"}` : ""}`;

  return (
    <div className={`chat-trace ${open ? "open" : ""}`}>
      <button className="ct-head" onClick={() => setOpen((o) => !o)}>
        <span className="ct-caret">{open ? "▾" : "▸"}</span>
        {processing ? <span className="typing"><span /><span /><span /></span> : null}
        <span className="ct-summary">{summary}</span>
      </button>
      {open ? (
        <div className="ct-steps">
          {steps.map((s, i) => {
            if (s.type === "thinking") {
              return <div className="ct-step ct-thinking" key={i}>{s.content}</div>;
            }
            if (s.type === "tool_call") {
              return (
                <div className="ct-step ct-call" key={i}>
                  <div className="ct-tool">→ {s.tool || "tool"}</div>
                  {s.args && s.args !== "{}" ? <pre className="ct-args">{s.args}</pre> : null}
                </div>
              );
            }
            // tool_result
            const txt = (s.content || "").slice(0, 800);
            return (
              <div className="ct-step ct-result" key={i}>
                <pre className="ct-args">{txt}{(s.content || "").length > 800 ? "…" : ""}</pre>
              </div>
            );
          })}
        </div>
      ) : null}
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
      const r = await fetch("/api/deal-engine/chat/prompt", { cache: "no-store" });
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

  // Fetch the prompt as soon as the panel mounts (admins only), so it's ready
  // and never blank — independent of when the panel is first expanded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

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
  const { records: allRecords, scoped: scopedRecords, locked, blocked, scopeName, isAdminView } = useDashboard();
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
  // The chat_id of the in-flight (or last) realtime turn. Drives the realtime
  // subscription + polling fallback. Distinct from currentId (the saved-chat id).
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "error" | "disconnected">("connecting");
  const msgsRef = useRef<HTMLDivElement>(null);

  // Stable browser Supabase client (used for realtime + the polling fallback).
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Mirror state into refs so effects can read the latest values without
  // re-subscribing / re-arming on every message.
  const messagesRef = useRef<Msg[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  // The saved-chat id the current turn belongs to, for persisting the final answer.
  const persistIdRef = useRef<string | null>(null);
  // Tracks whether the optimistic assistant placeholder for the current turn has
  // already been resolved (final/error) so duplicate terminal rows are ignored.
  const turnDoneRef = useRef(false);

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

  // Persist the conversation. Strip live-only fields (thinkingSteps/isProcessing)
  // so saved chats keep the clean {role, content} shape they always had.
  function persist(msgs: Msg[], id: string | null): string {
    const cid = id || crypto.randomUUID();
    const clean: Msg[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    const title = ((clean[0] && clean[0].content) || "New chat").replace(/\s+/g, " ").slice(0, 52);
    const rec: Chat = { id: cid, title, ts: Date.now(), messages: clean };
    // Optimistic local update (touched chat to the top), then persist to the DB
    // in the background.
    setChats((prev) => [rec, ...prev.filter((c) => c.id !== cid)]);
    void saveChatDb(rec).catch((e) => console.warn("[chat] save failed", e));
    return cid;
  }

  // Apply ONE chat_messages row to the live timeline. Mirrors VIBE's realtime
  // reducer, simplified to the row types this agent emits.
  function applyRow(row: any) {
    if (!row || row.role !== "assistant") return; // user rows are added optimistically
    const type = (row.type || "message") as string;
    const meta = parseMeta(row.metadata);

    if (type === "thinking" || type === "tool_call" || type === "tool_result") {
      // This agent writes each tool_call/tool_result once (source 'sync_handler'),
      // so there's no numbered-step duplicate to filter out here.
      let step: Step | null = null;
      if (type === "thinking") {
        step = { type: "thinking", content: row.content };
      } else if (type === "tool_call") {
        const rawArgs = meta.args ?? {};
        let args = "";
        try { args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs, null, 2); }
        catch { args = String(rawArgs); }
        step = { type: "tool_call", tool: meta.tool || meta.name || "tool", args };
      } else {
        step = { type: "tool_result", content: row.content };
      }
      setMessages((prev) => {
        const next = [...prev];
        // Find the last assistant message (the in-flight placeholder).
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) if (next[i].role === "assistant") { idx = i; break; }
        if (idx === -1) {
          next.push({ role: "assistant", content: "", thinkingSteps: step ? [step] : [], isProcessing: true });
        } else {
          const m = next[idx];
          next[idx] = { ...m, thinkingSteps: [...(m.thinkingSteps || []), step!], isProcessing: true };
        }
        return next;
      });
      return;
    }

    if (type === "final" || type === "message") {
      if (turnDoneRef.current) return;
      turnDoneRef.current = true;
      setBusy(false);
      setMessages((prev) => {
        const next = [...prev];
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) if (next[i].role === "assistant") { idx = i; break; }
        if (idx === -1) {
          next.push({ role: "assistant", content: row.content || "", isProcessing: false });
        } else {
          next[idx] = { ...next[idx], content: row.content || "", isProcessing: false };
        }
        // Persist the resolved conversation against the saved-chat id.
        persist(next, persistIdRef.current);
        return next;
      });
      return;
    }

    if (type === "error") {
      if (turnDoneRef.current) return;
      turnDoneRef.current = true;
      setBusy(false);
      setError(row.content || "The agent run failed.");
      setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.isProcessing ? { ...m, isProcessing: false } : m)));
      return;
    }

    // status / other: just keep the spinner; nothing to render.
  }

  // Realtime subscription — listen to chat_messages for the active turn and apply
  // each row live. Ported from VIBE's ChatInterface.
  useEffect(() => {
    if (!activeChatId) return;
    setRealtimeStatus("connecting");

    const connectTimeout = setTimeout(() => {
      setRealtimeStatus((prev) => (prev === "connecting" ? "error" : prev));
    }, 10_000);

    const channel = supabase
      .channel(`mase-chat:${activeChatId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `chat_id=eq.${activeChatId}` },
        (payload: any) => { if (payload.new) applyRow(payload.new); }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(connectTimeout); setRealtimeStatus("connected"); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(connectTimeout); setRealtimeStatus("error"); }
        else if (status === "CLOSED") { clearTimeout(connectTimeout); setRealtimeStatus("disconnected"); }
      });

    return () => { clearTimeout(connectTimeout); supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, supabase]);

  // Polling fallback — when realtime isn't connected, rebuild the live trace from
  // the DB every 3s while a turn is in flight. Mirrors VIBE's fallback.
  useEffect(() => {
    if (!activeChatId) return;
    if (realtimeStatus === "connected") return;

    let stopped = false;
    const poll = async () => {
      if (!busyRef.current && turnDoneRef.current) return;
      const { data, error: dberr } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: true })
        .order("sequence", { ascending: true });
      if (stopped || dberr || !data || data.length === 0) return;

      // Rebuild the live assistant turn from scratch: collapse all assistant rows
      // since the last user row into one trace + final.
      const steps: Step[] = [];
      let finalContent = "";
      let terminal = false;
      let errText = "";
      for (const row of data) {
        if (row.role !== "assistant") continue;
        const type = (row.type || "message") as string;
        const meta = parseMeta(row.metadata);
        if (type === "thinking") steps.push({ type: "thinking", content: row.content });
        else if (type === "tool_call") {
          const rawArgs = meta.args ?? {};
          let args = "";
          try { args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs, null, 2); } catch { args = String(rawArgs); }
          steps.push({ type: "tool_call", tool: meta.tool || meta.name || "tool", args });
        } else if (type === "tool_result") steps.push({ type: "tool_result", content: row.content });
        else if (type === "final" || type === "message") { finalContent = row.content || ""; terminal = true; }
        else if (type === "error") { errText = row.content || "The agent run failed."; terminal = true; }
      }

      setMessages((prev) => {
        const next = [...prev];
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) if (next[i].role === "assistant") { idx = i; break; }
        const live: Msg = {
          role: "assistant",
          content: errText ? "" : finalContent,
          thinkingSteps: steps,
          isProcessing: !terminal,
        };
        if (idx === -1) next.push(live);
        else next[idx] = live;
        if (terminal && !turnDoneRef.current) {
          turnDoneRef.current = true;
          setBusy(false);
          if (errText) setError(errText);
          else persist(next, persistIdRef.current);
        }
        return next;
      });
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, realtimeStatus, supabase]);

  // Watchdog — if a run goes silent (no terminal row), stop the spinner after
  // ~180s so the UI never hangs on "Working…". Resets on every message change
  // (any new row is activity).
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      setBusy(false);
      setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.isProcessing ? { ...m, isProcessing: false } : m)));
    }, 180_000);
    return () => clearTimeout(timer);
  }, [busy, messages]);

  async function send(text: string) {
    if (busy || !text.trim()) return;
    setError(null);
    // Optimistic UI: append the user message + an in-flight assistant placeholder.
    const userMsgs: Msg[] = [...messages, { role: "user", content: text }];
    const withPlaceholder: Msg[] = [...userMsgs, { role: "assistant", content: "", thinkingSteps: [], isProcessing: true }];
    setMessages(withPlaceholder);
    setBusy(true);

    // Persist the user turn now (so it's saved even if the reply never lands).
    const cid = persist(userMsgs, currentId);
    setCurrentId(cid);
    persistIdRef.current = cid;

    // Fresh realtime turn.
    const chatId = crypto.randomUUID();
    turnDoneRef.current = false;
    setActiveChatId(chatId);

    try {
      // Hermetic scoping (unchanged): send the exact in-scope opportunity IDs and
      // let the backend build context from only those deals. Generic = whole book.
      // Locked users always send their scoped opp ids so the backend can never
      // answer over deals outside their scope.
      const ids = locked
        ? records.map((r) => r.opp_id).filter(Boolean)
        : scope.mode === "generic" ? [] : scopeRecords(records, scope).map((r) => r.opp_id).filter(Boolean);
      const body: any = { chat_id: chatId, messages: userMsgs.map((m) => ({ role: m.role, content: m.content })) };
      if (ids.length) body.opp_ids = ids;

      const r = await fetch("/api/deal-engine/chat/async", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setError(j.error || `Error ${r.status}`);
        setBusy(false);
        turnDoneRef.current = true;
        setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.isProcessing ? { ...m, isProcessing: false } : m)));
        return;
      }
      // The backend may have generated its own chat_id (it shouldn't, we sent one,
      // but honour the response). Re-point the subscription if so.
      if (j.chat_id && j.chat_id !== chatId) setActiveChatId(j.chat_id);
      // From here the realtime subscription (or polling) drives the UI.
    } catch (e: any) {
      setError(e?.message || String(e));
      setBusy(false);
      turnDoneRef.current = true;
      setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.isProcessing ? { ...m, isProcessing: false } : m)));
    }
  }

  function newChat() { setCurrentId(null); setMessages([]); setError(null); setActiveChatId(null); turnDoneRef.current = true; }
  function openChat(id: string) {
    const c = chats.find((x) => x.id === id); if (!c) return;
    setCurrentId(id); setMessages(c.messages.slice()); setError(null);
    setActiveChatId(null); turnDoneRef.current = true; setBusy(false);
  }
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
        {isAdminView && !locked && <AdminPromptPanel />}
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
              {m.role === "assistant" ? (
                <>
                  {(m.thinkingSteps && m.thinkingSteps.length > 0) || m.isProcessing ? (
                    <AgentTrace steps={m.thinkingSteps || []} processing={!!m.isProcessing} />
                  ) : null}
                  {m.content ? <Bubble text={m.content} /> : null}
                </>
              ) : (
                <Bubble text={m.content} />
              )}
            </div>
          ))}
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
