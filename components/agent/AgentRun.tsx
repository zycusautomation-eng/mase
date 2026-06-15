"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// "Run with AI" — a right-side panel that watches the deep agent complete a
// single to-do live. We reuse VIBE's exact machinery: POST the to-do (as a user
// prompt) to /api/agent/async, the backend agent works it and writes its
// thinking / tool calls / final draft to Supabase `chat_messages` in real-time,
// and this panel subscribes to that chat_id over Supabase realtime and renders
// the stream. The agent's `final` message is the drafted email (draft only — a
// human reviews & sends).
// ---------------------------------------------------------------------------

// The Tactical Fulfillment Agent's behaviour (drafting mode). Passed as the
// agent's system prompt for this run. The GATE is the safety model: it refuses
// anything that needs a human and never invents a customer/reference/price.
const DRAFTING_SYSTEM_PROMPT = `You are MASE's Tactical Fulfillment Agent. You complete ONE tactical sales to-do on behalf of a Zycus rep by DRAFTING a single outbound email to the prospect.

GATE FIRST: You only handle to-dos that are (a) outbound to the prospect, (b) answerable with factual content you can retrieve, and (c) require NO internal collaboration. If the to-do needs the rep's manager or an executive, legal, security/infosec, the pricing desk, a sales engineer, product, or a partner — STOP. Draft nothing. Reply with exactly one line: "NEEDS HUMAN: <who and why>".

RETRIEVE: Gather the facts with your tools — Showpad for case studies/collateral, Salesforce for REAL named customer references (closed-won, by industry), and the knowledge base for product capabilities/integrations/pricing. Cite every concrete claim to its source. NEVER invent a customer name, reference, integration, certification, or price. If you cannot find a real source for a required fact, STOP and reply "NEEDS HUMAN: missing source for <fact>".

DRAFT: Write ONE email to the named prospect contact, in the rep's voice, concise and specific, that fulfills the ask. Reference the call/commitment it answers. End with a clear next step.

OUTPUT: Your final message is the email draft only (a Subject line and the body). Do NOT send it — a human reviews and sends. Do NOT take any external action.`;

function buildSeedPrompt(t: any): string {
  const ctx = [
    t.account_name && `Account: ${t.account_name}`,
    t.opp_name && `Opportunity: ${t.opp_name}`,
    t.owner_name && `Deal owner (the rep you draft for): ${t.owner_name}`,
    t.opp_id && `Opportunity ID: ${t.opp_id}`,
  ].filter(Boolean).join("\n");
  const meta = [
    t.said_by && `Asked by: ${t.said_by}`,
    t.who && `Owner of the commitment: ${t.who}`,
    (t.due || t.act_by || t.trigger_date || t.date) && `Date: ${t.due || t.act_by || t.trigger_date || t.date}`,
    t.trigger && `Evidence / trigger: ${t.trigger}`,
  ].filter(Boolean).join("\n");
  return `Complete this sales to-do by drafting ONE outbound email to the prospect.\n\n${ctx}\n\nTO-DO (${t.category}): ${t.text}\n${meta}\n\nFollow your rules: retrieve real facts and cite them, refuse with "NEEDS HUMAN" if this needs another person or you lack a source, otherwise produce the email draft (Subject + body) as your final answer.`;
}

type ActiveRun = { todo: any; ownerName?: string; chatId: string };

interface AgentRunState {
  start: (todo: any, ownerName?: string) => void;
  close: () => void;
  active: ActiveRun | null;
}
const Ctx = createContext<AgentRunState | null>(null);

export function useAgentRun(): AgentRunState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAgentRun must be used inside <AgentRunProvider>");
  return c;
}

export function AgentRunProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveRun | null>(null);
  const start = useCallback((todo: any, ownerName?: string) => {
    setActive({ todo, ownerName, chatId: crypto.randomUUID() });
  }, []);
  const close = useCallback(() => setActive(null), []);
  const value = useMemo(() => ({ start, close, active }), [start, close, active]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {active ? <AgentRunPanel key={active.chatId} run={active} onClose={close} /> : null}
    </Ctx.Provider>
  );
}

interface Msg { id: string; role: string; type: string; content: string; sequence: number; metadata: any }

// Which message types are "process" (collapsible noise) vs the headline output.
const TYPE_LABEL: Record<string, string> = {
  thinking: "Thinking", tool_call: "Tool", tool_result: "Result",
  status: "Status", write_todos: "Plan", error: "Error",
};

function toolName(m: Msg): string {
  return m.metadata?.tool || m.metadata?.name || m.metadata?.tool_name || "tool";
}

function AgentRunPanel({ run, onClose }: { run: ActiveRun; onClose: () => void }) {
  const { todo, ownerName, chatId } = run;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<"starting" | "running" | "done" | "error">("starting");
  const [err, setErr] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  const add = useCallback((row: any) => {
    if (!row || seen.current.has(row.id)) return;
    seen.current.add(row.id);
    setMsgs((prev) => [...prev, {
      id: row.id, role: row.role, type: row.type || "message",
      content: row.content || "", sequence: row.sequence ?? prev.length, metadata: row.metadata || {},
    }].sort((a, b) => a.sequence - b.sequence));
    if (row.type === "final") setPhase("done");
    if (row.type === "error") { setPhase("error"); setErr(row.content || "Agent error"); }
  }, []);

  // Subscribe to realtime + backfill any rows that landed before we subscribed.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`agent-run-${chatId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` },
        (payload) => add(payload.new))
      .subscribe();
    const backfill = setInterval(async () => {
      const { data } = await supabase.from("chat_messages").select("*").eq("chat_id", chatId).order("sequence");
      (data || []).forEach(add);
    }, 2500);
    return () => { clearInterval(backfill); supabase.removeChannel(channel); };
  }, [chatId, add]);

  // Kick off the run. We do NOT await the body (the backend streams keepalives
  // until the agent finishes); realtime drives the UI. We only surface a
  // network/HTTP failure here.
  useEffect(() => {
    let cancelled = false;
    setPhase("running");
    fetch("/api/agent/async", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        headless: false,
        system_prompt: DRAFTING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildSeedPrompt({ ...todo, owner_name: todo.owner_name || ownerName }) }],
      }),
    }).then(async (r) => {
      if (!r.ok && !cancelled) {
        const j = await r.json().catch(() => ({}));
        setPhase("error"); setErr(j.error || `Start failed (${r.status})`);
      }
    }).catch((e) => { if (!cancelled) { setPhase("error"); setErr(String(e?.message || e)); } });
    return () => { cancelled = true; };
  }, [chatId, todo, ownerName]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, phase]);

  const stop = useCallback(() => {
    fetch("/api/agent/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId }) }).catch(() => {});
  }, [chatId]);

  const draft = msgs.find((m) => m.type === "final")?.content || "";
  const copy = () => { navigator.clipboard?.writeText(draft).catch(() => {}); };

  return (
    <div className="agentrun-overlay" onClick={onClose}>
      <aside className="agentrun-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ar-head">
          <div className="ar-head-l">
            <span className="ar-dot" data-phase={phase} />
            <div>
              <div className="ar-title">Run with AI</div>
              <div className="ar-sub">{todo.account_name || todo.opp_name || "Tactical to-do"}</div>
            </div>
          </div>
          <button className="ar-x" onClick={() => { stop(); onClose(); }} aria-label="Close">×</button>
        </header>

        <div className="ar-task">{todo.text}</div>

        <div className="ar-body" ref={bodyRef}>
          {phase === "starting" || (phase === "running" && msgs.length === 0) ? (
            <div className="ar-step muted"><span className="ar-spin" /> Starting the agent…</div>
          ) : null}

          {msgs.map((m) => {
            if (m.role === "user" && m.type === "message") {
              return <div key={m.id} className="ar-step user"><div className="ar-step-h">Task sent to agent</div><div className="ar-step-c">{m.content}</div></div>;
            }
            if (m.type === "final") {
              const needsHuman = /^\s*NEEDS HUMAN/i.test(m.content);
              return (
                <div key={m.id} className={`ar-final ${needsHuman ? "needshuman" : ""}`}>
                  <div className="ar-final-h">{needsHuman ? "⚠ Needs a human" : "✓ Draft ready"}</div>
                  <div className="ar-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                </div>
              );
            }
            if (m.type === "error") return <div key={m.id} className="ar-step err"><div className="ar-step-h">Error</div><div className="ar-step-c">{m.content}</div></div>;
            // process steps — compact, content truncated
            const label = m.type === "tool_call" ? `🔧 ${toolName(m)}` : m.type === "tool_result" ? `↳ ${toolName(m)} result` : (TYPE_LABEL[m.type] || m.type);
            const compact = (m.content || "").slice(0, 260);
            return (
              <div key={m.id} className={`ar-step ${m.type}`}>
                <div className="ar-step-h">{label}</div>
                {compact ? <div className="ar-step-c">{compact}{(m.content || "").length > 260 ? "…" : ""}</div> : null}
              </div>
            );
          })}

          {err && phase === "error" ? <div className="ar-step err"><div className="ar-step-c">{err}</div></div> : null}
        </div>

        <footer className="ar-foot">
          {draft && phase === "done" && !/^\s*NEEDS HUMAN/i.test(draft) ? (
            <>
              <span className="ar-foot-note">Draft — review before sending.</span>
              <button className="ar-btn copy" onClick={copy}>Copy draft</button>
            </>
          ) : phase === "running" ? (
            <span className="ar-foot-note"><span className="ar-spin" /> Agent is working…</span>
          ) : (
            <span className="ar-foot-note">Closed runs keep their chat in the agent history.</span>
          )}
        </footer>
      </aside>
    </div>
  );
}
