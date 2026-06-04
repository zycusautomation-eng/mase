"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// NOTE: conversations persist to localStorage for now. Per-user DB storage is
// deferred until user identity/auth is wired (see task #5).
import { useEffect, useRef, useState } from "react";

interface Msg { role: "user" | "assistant"; content: string }
interface Chat { id: string; title: string; ts: number; messages: Msg[] }

const CHATS_KEY = "deal_engine_chats";
const HINTS = [
  { q: "Which are our best deals to go after next quarter? Run the full qualification drill and rank by genuine winnability, not by stated probability or forecast label.", label: "Best deals to go after" },
  { q: "Which deals look strong on the label (Best Case, high probability) but are actually weak on the facts: engagement, champion, access to power, or competition?", label: "Label vs reality" },
  { q: "Where is competition a genuine threat, and what is the specific factor favouring them on each deal?", label: "Competitive threats" },
  { q: "Which deals are won but unsigned, and what is the exact next step to get each over the line?", label: "Won but unsigned" },
];

function loadChats(): Chat[] { try { return JSON.parse(localStorage.getItem(CHATS_KEY) || "[]"); } catch { return []; } }
function saveChats(a: Chat[]) { try { localStorage.setItem(CHATS_KEY, JSON.stringify(a)); } catch {} }
function dateLabel(ts: number) { try { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

// Render **bold** spans like the original fmtMsg.
function Bubble({ text }: { text: string }) {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return <div className="bubble">{parts.map((p, i) => p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)}</div>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setChats(loadChats()); }, []);
  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  function persist(msgs: Msg[], id: string | null): string {
    const cid = id || "c" + Date.now();
    const title = ((msgs[0] && msgs[0].content) || "New chat").replace(/\s+/g, " ").slice(0, 52);
    const rec: Chat = { id: cid, title, ts: Date.now(), messages: msgs.slice() };
    const list = loadChats();
    const ex = list.find((c) => c.id === cid);
    if (ex) Object.assign(ex, rec); else list.unshift(rec);
    saveChats(list);
    setChats(list.slice());
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
      const r = await fetch("/api/deal-engine/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
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
  function openChat(id: string) { const c = loadChats().find((x) => x.id === id); if (!c) return; setCurrentId(id); setMessages(c.messages.slice()); setError(null); }
  function deleteChat(id: string) { const list = loadChats().filter((c) => c.id !== id); saveChats(list); setChats(list); if (currentId === id) newChat(); }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = input; setInput(""); send(v); }
  }

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
        <div className="msgs" ref={msgsRef}>
          {messages.length === 0 ? (
            <div className="hint">
              Ask the strategist about the book. Best-deal questions run the full qualification drill (engagement, champion, access to power, competition, product fit, risk), tested against the facts, not just the stated probability or forecast label.
              <div>
                {HINTS.map((hn) => (<span className="chip" key={hn.label} onClick={() => send(hn.q)}>{hn.label}</span>))}
              </div>
            </div>
          ) : messages.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <div className="who">{m.role === "user" ? "You" : "Engine"}</div>
              <Bubble text={m.content} />
            </div>
          ))}
          {busy ? <div className="msg assistant"><div className="who">Engine</div><div className="bubble">…</div></div> : null}
          {error ? <div className="msg assistant"><div className="who">Engine</div><div className="bubble"><span className="err">{error}</span></div></div> : null}
        </div>
        <div className="chatbar">
          <div className="inner">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1} placeholder="Ask the strategist about the book… (Enter to send, Shift+Enter for newline)" />
            <button onClick={() => { const v = input; setInput(""); send(v); }} disabled={busy}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
