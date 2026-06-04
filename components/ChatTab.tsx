"use client";
import { useState, useRef, useEffect } from "react";
import { dealEngine } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

export default function ChatTab({ owner }: { owner: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      // Resend the full conversation each turn, scoped to the selected owner.
      const res = await dealEngine.chat(next, owner);
      setMessages([...next, { role: "assistant", content: res.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages(messages); // roll back the optimistic user message
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="card">
      <div className="section-title">
        RevOps strategist
        {owner !== "all" && <span className="count">scoped to {owner}</span>}
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !sending && (
          <div className="muted" style={{ padding: 24, textAlign: "center" }}>
            Ask about the book — &ldquo;what should I focus on this quarter?&rdquo;, &ldquo;which deals are at risk?&rdquo;
          </div>
        )}
        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            {m.content}
          </div>
        ))}
        {sending && <div className="msg assistant muted">Thinking…</div>}
      </div>

      {error && (
        <div className="state-error" style={{ padding: "8px 4px", fontSize: 13 }} role="alert">
          {error}
        </div>
      )}

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message the strategist…  (Enter to send, Shift+Enter for newline)"
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
