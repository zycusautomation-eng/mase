"use client";
// Per-deal AI panel for Espresso — brings the /chat experience to a single deal.
// On open it asks the strategist to scan which of the deal's open to-dos the Todo
// Runner can do; the agent streams its trace (thinking / tool calls / nested Todo
// Runner sub-runs) exactly like the chat. Self-contained COPY of the chat's
// render + streaming (the chat page is left untouched) — wrapped in
// .mase-chat-root so the shadcn tokens/resets apply on the Espresso route.
//
// NOTE: this is stage 1 (chat brought to the deal). The interactive MCQ dock +
// durable run history are layered on next.
import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, X, Sparkles, ArrowUp, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setRunning, clearRunning } from "@/lib/engine/dealAiBus";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Monogram } from "@/components/ui/Monogram";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface DealForAgent { oid: string; accountName: string; oppName?: string; ownerName?: string }

interface Step { type: "thinking" | "tool_call" | "tool_result"; tool?: string; args?: string; content?: string; group?: "todo" }
interface Msg { role: "user" | "assistant"; content: string; thinkingSteps?: Step[]; isProcessing?: boolean; chatId?: string }

function parseMeta(meta: any): any {
  if (!meta) return {};
  if (typeof meta === "string") { try { return JSON.parse(meta) || {}; } catch { return {}; } }
  return meta;
}

const STATUS_BADGE: Record<string, string> = {
  weak: "bg-red-100 text-red-700", failing: "bg-red-100 text-red-700", fail: "bg-red-100 text-red-700",
  missing: "bg-red-100 text-red-700", none: "bg-red-100 text-red-700", high: "bg-red-100 text-red-700",
  "high risk": "bg-red-100 text-red-700", critical: "bg-red-100 text-red-700", blocked: "bg-red-100 text-red-700",
  "at risk": "bg-amber-100 text-amber-700", "off track": "bg-amber-100 text-amber-700", medium: "bg-amber-100 text-amber-700",
  moderate: "bg-amber-100 text-amber-700", partial: "bg-amber-100 text-amber-700", "medium risk": "bg-amber-100 text-amber-700",
  strong: "bg-emerald-100 text-emerald-700", healthy: "bg-emerald-100 text-emerald-700", good: "bg-emerald-100 text-emerald-700",
  low: "bg-emerald-100 text-emerald-700", "low risk": "bg-emerald-100 text-emerald-700", pass: "bg-emerald-100 text-emerald-700",
  yes: "bg-emerald-100 text-emerald-700", "on track": "bg-emerald-100 text-emerald-700", confirmed: "bg-emerald-100 text-emerald-700",
};
function nodeText(node: React.ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in (node as any)) return nodeText((node as any).props?.children);
  return "";
}

function Bubble({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-neutral max-w-none text-[14px] leading-relaxed text-foreground [&_table]:my-0 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-[13px] [&_tr]:border-b [&_tr]:border-border [&_tbody_tr:last-child]:border-0 [&_tbody_tr:nth-child(even)]:bg-muted/30 [&_a]:text-indigo-600 [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[12.5px] [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-300 [&_blockquote]:pl-3 [&_blockquote]:not-italic [&_blockquote]:text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          table: ({ ...props }) => (
            <div className="my-3 overflow-hidden rounded-xl border border-border"><div className="overflow-x-auto"><table {...props} /></div></div>
          ),
          td: ({ children, ...props }) => {
            const t = nodeText(children).trim();
            const tone = STATUS_BADGE[t.toLowerCase()];
            if (tone && t.length <= 16) {
              return <td {...props}><span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{t}</span></td>;
            }
            return <td {...props}>{children}</td>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="size-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-indigo-400" />
    </span>
  );
}

function StepRow({ step: s }: { step: Step }) {
  if (s.type === "thinking") return <div className="text-[13px] italic leading-relaxed text-muted-foreground">{s.content}</div>;
  if (s.type === "tool_call") {
    return (
      <div className="text-[13px]">
        <div className="font-mono text-indigo-600">→ {s.tool || "tool"}</div>
        {s.args && s.args !== "{}" ? <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[12px] text-muted-foreground">{s.args}</pre> : null}
      </div>
    );
  }
  const txt = (s.content || "").slice(0, 800);
  return <pre className="overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[12px] text-muted-foreground">{txt}{(s.content || "").length > 800 ? "…" : ""}</pre>;
}

function TodoSubTrace({ steps, processing }: { steps: Step[]; processing: boolean }) {
  const [open, setOpen] = useState(true);
  const toolCount = steps.filter((s) => s.type === "tool_call").length;
  const summary = processing ? "Todo Runner working…" : `Todo Runner${toolCount ? ` · ${toolCount} tool call${toolCount === 1 ? "" : "s"}` : ""}`;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="ml-2 rounded-lg border-l-2 border-indigo-300 bg-indigo-50/40 pl-3">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", open ? "" : "-rotate-90")} />
        <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">Todo Runner</Badge>
        {processing ? <Dots /> : null}
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent><div className="space-y-2 pb-2">{steps.map((s, i) => <StepRow key={i} step={s} />)}</div></CollapsibleContent>
    </Collapsible>
  );
}

function AgentTrace({ steps, processing }: { steps: Step[]; processing: boolean }) {
  const [open, setOpen] = useState(processing);
  const wasProcessing = useRef(processing);
  useEffect(() => { if (processing && !wasProcessing.current) setOpen(true); wasProcessing.current = processing; }, [processing]);
  if (!steps || steps.length === 0) {
    return processing ? <div className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground"><Dots /><span>Working…</span></div> : null;
  }
  const toolCount = steps.filter((s) => s.type === "tool_call" && s.group !== "todo").length;
  const summary = processing ? "Agent working…" : `Agent steps${toolCount ? ` · ${toolCount} tool call${toolCount === 1 ? "" : "s"}` : ""}`;
  const blocks: React.ReactNode[] = [];
  let todoRun: Step[] = []; let todoKey = 0;
  const flushTodo = () => { if (!todoRun.length) return; blocks.push(<TodoSubTrace key={`todo-${todoKey++}`} steps={todoRun} processing={processing} />); todoRun = []; };
  steps.forEach((s, i) => { if (s.group === "todo") { todoRun.push(s); return; } flushTodo(); blocks.push(<StepRow key={i} step={s} />); });
  flushTodo();
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1 mb-1 rounded-lg border border-border bg-muted/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", open ? "" : "-rotate-90")} />
        {processing ? <Dots /> : null}
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent><div className="space-y-2 px-3 pb-3">{blocks}</div></CollapsibleContent>
    </Collapsible>
  );
}

// Build the assistant turn(s) from ALL of a chat's chat_messages rows (same
// reconcile contract as the chat). Pure — caller applies the result.
function buildAssistantTurn(rows: any[]): { content: string; steps: Step[]; terminal: boolean; errText: string } {
  const steps: Step[] = [];
  let finalContent = ""; let terminal = false; let errText = "";
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const type = (row.type || "message") as string;
    const meta = parseMeta(row.metadata);
    const grp = meta.group === "todo" ? ("todo" as const) : undefined;
    if (type === "thinking") steps.push({ type: "thinking", content: row.content, group: grp });
    else if (type === "tool_call") {
      const rawArgs = meta.args ?? {}; let args = "";
      try { args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs, null, 2); } catch { args = String(rawArgs); }
      steps.push({ type: "tool_call", tool: meta.tool || meta.name || "tool", args, group: grp });
    } else if (type === "tool_result") steps.push({ type: "tool_result", content: row.content, group: grp });
    else if (type === "final" || type === "message") { finalContent = row.content || ""; terminal = true; }
    else if (type === "error") { errText = row.content || "The agent run failed."; terminal = true; }
    else if (type === "status" && (meta.status === "cancelled" || (row.content || "").toLowerCase().includes("stopped"))) { terminal = true; }
  }
  return { content: errText ? "" : finalContent, steps, terminal, errText };
}

// ── Interactive MCQ ─────────────────────────────────────────────────────────
// The agent appends a hidden marker `<!--mase-choice {"options":[...],"multi":bool}-->`
// when it wants the user to pick. It's an HTML comment → invisible in any client that
// doesn't parse it (graceful for the live UI), and here we render clickable buttons.
interface Choice { options: string[]; multi: boolean }
const CHOICE_RE = /<!--\s*mase-choice\s*(\{[\s\S]*?\})\s*-->/i;
function parseChoices(text: string): { text: string; choice: Choice | null } {
  const m = CHOICE_RE.exec(text || "");
  if (!m) return { text: text || "", choice: null };
  let choice: Choice | null = null;
  try {
    const obj = JSON.parse(m[1]);
    if (obj && Array.isArray(obj.options) && obj.options.length) {
      choice = { options: obj.options.map((o: unknown) => String(o)).filter(Boolean), multi: !!obj.multi };
    }
  } catch { /* malformed → no buttons, just the text */ }
  return { text: (text || "").replace(CHOICE_RE, "").trim(), choice };
}

function ChoiceBlock({ choice, onAnswer, disabled }: { choice: Choice; onAnswer: (t: string) => void; disabled: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  if (choice.multi) {
    const toggle = (o: string) => setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
    return (
      <div className="mt-2.5 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {choice.options.map((o) => (
            <button key={o} type="button" disabled={disabled} onClick={() => toggle(o)}
              className={cn("rounded-full border px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-50",
                sel.includes(o) ? "border-[#5277F0] bg-[#5277F0] text-white" : "border-border bg-card text-foreground hover:border-[#5277F0]")}>
              {o}
            </button>
          ))}
        </div>
        <Button size="sm" className="self-start bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white hover:opacity-95" disabled={disabled || !sel.length} onClick={() => onAnswer(sel.join("; "))}>
          Send{sel.length ? ` (${sel.length})` : ""}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {choice.options.map((o) => (
        <button key={o} type="button" disabled={disabled} onClick={() => onAnswer(o)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:border-[#5277F0] disabled:opacity-50">
          {o}
        </button>
      ))}
    </div>
  );
}

const SEED = "Which of this deal's open to-dos can the Todo Runner do for me, and which need a human? Group them and explain why.";

// Empty-state for a fresh deal chat — invites the user to let the agent DO the work.
function DealChatWelcome({ deal, onPick }: { deal: DealForAgent; onPick: (p: string) => void }) {
  const QUICK = [
    { t: "Complete my to-dos", s: SEED, hot: true },
    { t: "Summarize this deal", s: "Summarize this deal: current status, the single biggest risk, and the most important next move. Keep it tight." },
    { t: "Draft a follow-up email", s: "Draft a short follow-up email to the key stakeholder on this deal. Never use em-dashes or double-dashes." },
    { t: "Surface the blocker", s: "What is the single biggest blocker on this deal right now, and exactly how do we clear it?" },
  ];
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-lg"><Sparkles className="size-6" /></div>
      <h3 className="text-[17px] font-bold text-foreground">Complete tasks with AI</h3>
      <p className="mt-1.5 max-w-[360px] text-[13px] leading-relaxed text-muted-foreground">
        Let the agent do the legwork on {deal.accountName} — draft the emails, build the docs, line up references. Pick one to start, or just ask anything below.
      </p>
      <div className="mt-5 flex w-full max-w-[420px] flex-col gap-2">
        {QUICK.map((q) => (
          <button
            key={q.t}
            type="button"
            onClick={() => onPick(q.s)}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] font-medium transition hover:-translate-y-px",
              q.hot ? "border-transparent bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-md" : "border-border bg-card text-foreground hover:border-[#5277F0]",
            )}
          >
            <Sparkles className={cn("size-4 shrink-0", q.hot ? "text-white" : "text-[#5277F0]")} />
            {q.t}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DealAgentPanel({ deal, onClose, onBack, convoKey, initialMessages, resumeChatId, seed }: { deal: DealForAgent; onClose: () => void; onBack?: () => void; convoKey?: string; initialMessages?: Msg[]; resumeChatId?: string; seed?: string }) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  // Resume target: an explicit running-registry chat_id, OR (durability) the chat_id
  // saved on the last in-progress assistant message — so reopening a conversation you
  // quit mid-run re-attaches to its chat_messages and pulls the completed reply.
  const lastInit = initialMessages && initialMessages.length ? initialMessages[initialMessages.length - 1] : null;
  const persistedResume = lastInit && lastInit.role === "assistant" && lastInit.isProcessing && lastInit.chatId ? lastInit.chatId : undefined;
  const effResume = resumeChatId || persistedResume;
  const [convo, setConvo] = useState<Msg[]>(() => {
    const base = initialMessages && initialMessages.length ? initialMessages : [];
    // Registry resume with no saved messages → add a placeholder to reconcile into.
    return effResume && !base.length ? [{ role: "assistant", content: "", thinkingSteps: [], isProcessing: true, chatId: effResume }] : base;
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(!!effResume);
  const [error, setError] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(effResume || null);
  const [hasNew, setHasNew] = useState(false);
  const doneRef = useRef(false);
  const sawDataRef = useRef(false); // did the backend ever write a row for the active run?
  const startedRef = useRef(false);
  const convoRef = useRef<Msg[]>(convo);
  useEffect(() => { convoRef.current = convo; }, [convo]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  // Auto-stick to the bottom only when the user is already there; otherwise raise the
  // "new messages" pill instead of yanking the scroll position down.
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    else setHasNew(true);
  }, [convo]);
  const onScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    if (near) setHasNew(false);
  }, []);
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true; setHasNew(false);
  }, []);
  // Stable mase_chats id for THIS conversation (durable history). Reopen passes
  // the existing key; a new conversation mints one.
  const keyRef = useRef<string>("");
  if (!keyRef.current) keyRef.current = convoKey || crypto.randomUUID();

  // Persist to mase_chats so the conversation shows in the deal-chats list. We tag
  // the title with a "[deal:<oid>]" marker (mase_chats has no metadata column); the
  // /chat sidebar filters these out so deal chats don't mix with the strategist chat.
  const persist = useCallback((msgs: Msg[]) => {
    const clean = msgs.map((m) => {
      const base: { role: string; content: string; thinkingSteps?: Step[]; isProcessing?: boolean; chatId?: string } = { role: m.role, content: m.content };
      if (m.thinkingSteps && m.thinkingSteps.length) base.thinkingSteps = m.thinkingSteps;
      if (m.isProcessing) base.isProcessing = true; // unfinished turn — kept so reopen can resume
      if (m.chatId) base.chatId = m.chatId;          // its live chat_id → re-attach on reopen
      return base;
    });
    void supabase.from("mase_chats").upsert(
      { id: keyRef.current, title: `[deal:${deal.oid}] ${deal.accountName}`, messages: clean, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    ).then(() => {}, () => {});
  }, [supabase, deal]);

  // Stop showing "Working…" on the last assistant turn and persist that resolution.
  // Used when a run fails to dispatch, produces no rows (orphaned), or times out — so a
  // turn can never get permanently stuck spinning with no backend run behind it.
  const failLastTurn = useCallback((note?: string) => {
    doneRef.current = true;
    setBusy(false);
    const next = [...convoRef.current];
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === "assistant") { next[i] = { ...next[i], isProcessing: false, chatId: undefined }; break; }
    }
    convoRef.current = next; setConvo(next); persist(next);
    if (note) setError(note);
  }, [persist]);

  // Mirror this conversation's busy state into the global running registry so the
  // DealChatsDock "Running" view reflects live agent activity across the page.
  useEffect(() => {
    if (busy) setRunning({ convoKey: keyRef.current, oid: deal.oid, accountName: deal.accountName, startedAt: Date.now(), streamChatId: activeChatId || undefined });
    else clearRunning(keyRef.current);
  }, [busy, activeChatId, deal]);
  useEffect(() => () => clearRunning(keyRef.current), []);

  // Rebuild the CURRENT (last) assistant turn from its chat_messages rows.
  const reconcile = useCallback(async (chatId: string) => {
    const { data, error: dberr } = await supabase
      .from("chat_messages").select("*").eq("chat_id", chatId)
      .order("created_at", { ascending: true }).order("sequence", { ascending: true });
    if (dberr || !data || data.length === 0) return;
    sawDataRef.current = true; // the backend run is alive — cancels the orphan give-up
    const { content, steps, terminal, errText } = buildAssistantTurn(data);
    const next = [...convoRef.current];
    let idx = -1; for (let i = next.length - 1; i >= 0; i--) if (next[i].role === "assistant") { idx = i; break; }
    const turn: Msg = { role: "assistant", content, thinkingSteps: steps, isProcessing: !terminal, chatId: terminal ? undefined : chatId };
    if (idx >= 0) next[idx] = turn; else next.push(turn);
    convoRef.current = next;
    setConvo(next);
    persist(next); // persist EVERY reconcile so the latest trace + live chat_id survive a quit
    if (terminal) { doneRef.current = true; setBusy(false); if (errText) setError(errText); }
  }, [supabase, persist]);

  // Send a turn: append the user message + an assistant placeholder, mint a fresh
  // streaming chat_id, and POST the full conversation scoped to this deal's opp.
  const send = useCallback((text: string) => {
    const t = text.trim(); if (!t || busy) return;
    setError(null);
    const history = [...convoRef.current.filter((m) => m.content), { role: "user" as const, content: t }];
    const chatId = crypto.randomUUID();
    const newConvo: Msg[] = [...convoRef.current, { role: "user", content: t }, { role: "assistant", content: "", thinkingSteps: [], isProcessing: true, chatId }];
    convoRef.current = newConvo;
    setConvo(newConvo);
    atBottomRef.current = true; setHasNew(false); // a user send always jumps to the bottom
    persist(newConvo); // save the user turn + live chat_id NOW (survives a mid-run quit)
    setBusy(true); doneRef.current = false;
    setActiveChatId(chatId);
    (async () => {
      try {
        const r = await fetch("/api/deal-engine/chat/async", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, opp_ids: [deal.oid], owner: deal.ownerName, messages: history.map((m) => ({ role: m.role, content: m.content })) }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) { failLastTurn(j.error || `Error ${r.status}`); }
        else if (j.chat_id && j.chat_id !== chatId) setActiveChatId(j.chat_id);
      } catch (e: any) { failLastTurn(e?.message || String(e)); }
    })();
  }, [busy, deal, persist, failLastTurn]);

  // New conversation → auto-run the todo scan once. Reopened conversation (initial
  // messages supplied) → just show the saved history, no auto-run.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (resumeChatId || (initialMessages && initialMessages.length)) return;
    // Auto-run ONLY when an explicit prompt is given (a copilot suggestion). Otherwise
    // open empty and show the "Complete tasks with AI" welcome so the user picks.
    if (seed && seed.trim()) send(seed);
  }, [send]);

  // Stream the active turn (realtime + 2s poll). This is a SEPARATE effect keyed
  // on activeChatId so it re-arms cleanly on every turn AND on StrictMode remount
  // (the previous version tore this down and never recreated it → stuck "Working").
  useEffect(() => {
    if (!activeChatId) return;
    sawDataRef.current = false; // re-arm: this run hasn't produced a row yet
    const channel = supabase
      .channel(`mase-deal:${activeChatId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `chat_id=eq.${activeChatId}` }, () => { void reconcile(activeChatId); })
      .subscribe((s) => { if (s === "SUBSCRIBED") void reconcile(activeChatId); });
    const interval = setInterval(() => { if (!doneRef.current) void reconcile(activeChatId); }, 2000);
    // Orphan give-up: if NO row ever lands (the dispatch never reached the backend — e.g.
    // a failed POST or a reopened turn whose run never ran), stop spinning so the user can
    // resend instead of staring at "Working…" forever.
    const orphan = setTimeout(() => { if (!doneRef.current && !sawDataRef.current) failLastTurn("That run didn't reach the backend — please resend."); }, 25_000);
    // Backstop for a run that started but never produced a terminal row.
    const watchdog = setTimeout(() => { if (!doneRef.current) failLastTurn(); }, 300_000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); clearTimeout(orphan); clearTimeout(watchdog); };
  }, [activeChatId, supabase, reconcile, failLastTurn]);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = input; setInput(""); send(v); }
  }

  // Right-side drawer — espresso stays visible behind it (no full-screen blackout).
  return (
    <div className="mase-chat-root fixed right-0 top-0 bottom-0 z-[100] flex w-full max-w-[640px] flex-col border-l border-border bg-background shadow-2xl" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {onBack ? (
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onBack} title="Back to conversations" aria-label="Back to conversations"><ArrowLeft className="size-4" /></Button>
          ) : null}
          <Monogram name={deal.accountName} kind="account" size={28} className="ml-1 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-foreground">{deal.accountName}</div>
            <div className="truncate text-[11px] text-muted-foreground">{deal.oppName || "Deal AI"}</div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose}><X className="size-4" /></Button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-5">
          {convo.length === 0 && !busy ? <DealChatWelcome deal={deal} onPick={(p) => send(p)} /> : null}
          {convo.map((m, i) => (
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-muted px-3.5 py-2 text-[14px] leading-relaxed text-foreground">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <Avatar className="size-7 shrink-0 bg-gradient-to-br from-[#6E8BFF] to-[#5277F0]">
                  <AvatarFallback className="bg-transparent text-white"><Sparkles className="size-3.5" /></AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 text-[12px] font-semibold text-indigo-700">Strategist</div>
                  {(m.thinkingSteps && m.thinkingSteps.length > 0) || m.isProcessing ? (
                    <AgentTrace steps={m.thinkingSteps || []} processing={!!m.isProcessing} />
                  ) : null}
                  {(() => {
                    const { text, choice } = parseChoices(m.content);
                    return (
                      <>
                        {text ? <Bubble text={text} /> : null}
                        {choice && i === convo.length - 1 && !busy ? (
                          <ChoiceBlock choice={choice} disabled={busy} onAnswer={(t) => send(t)} />
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            )
          ))}
          {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[14px] text-destructive">{error}</div> : null}
        </div>
      </div>
      {hasNew ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#5277F0] px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-lg transition hover:brightness-110"
        >
          New messages <ChevronDown className="size-3.5" />
        </button>
      ) : null}
      </div>

      {/* Composer — same input as /chat */}
      <div className="px-5 py-4">
        <div className="rounded-2xl border border-border bg-muted/40 transition focus-within:border-indigo-400 focus-within:bg-card focus-within:ring-2 focus-within:ring-indigo-100">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder="Ask about this deal, its to-dos, or next steps…"
            className="min-h-[52px] resize-none border-0 bg-transparent px-4 py-3 text-[14px] shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-end px-3 pb-2.5">
            <Button
              size="icon"
              className="size-9 rounded-full bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white hover:opacity-95 disabled:opacity-40"
              disabled={busy || !input.trim()}
              onClick={() => { const v = input; setInput(""); send(v); }}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
