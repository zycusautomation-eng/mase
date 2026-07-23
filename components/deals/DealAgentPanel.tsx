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
import { ChevronDown, ChevronUp, X, Sparkles, ArrowUp, ArrowLeft, Mic, Plus, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setRunning, clearRunning } from "@/lib/engine/dealAiBus";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useDictation } from "@/lib/engine/useDictation";
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
interface Msg { role: "user" | "assistant"; content: string; thinkingSteps?: Step[]; isProcessing?: boolean; chatId?: string; attachmentNames?: string[] }

// One staged (not yet sent) composer attachment. Images arrive via paste or the
// picker; documents via the picker. Sent as base64 in the POST body — the backend
// turns images into vision parts and text-extracts documents. NOT persisted to
// mase_chats (only the names are), so history rows stay small.
type StagedFile = { id: string; name: string; mime: string; size: number; dataUrl: string };
const ATT_MAX_FILES = 6;
const ATT_MAX_BYTES = 5_000_000; // per file (raw) — backend caps ~7.5MB base64
const ATT_ACCEPT = "image/*,.pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.md,.csv,.json";

// MASE 4-point sparkle star — the agent mark. Uses currentColor so it inherits the
// avatar/header text color (white on the blue gradient).
function MaseStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 144 164" fill="none" aria-hidden className={className}>
      <path d="M72,20 Q72,82 126,80 Q72,82 72,144 Q72,82 18,80 Q72,82 72,20 Z" fill="currentColor" />
      <path d="M120,30 Q120,48 138,48 Q120,48 120,66 Q120,48 102,48 Q120,48 120,30 Z" fill="currentColor" />
    </svg>
  );
}

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
  // Closed by default even while processing — the user expands to see the actions.
  const [open, setOpen] = useState(false);
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
// The agent appends one or more hidden markers, ONE PER QUESTION:
//   <!--mase-choice {"question":"...","options":[...],"multi":bool}-->
// Each renders as an MCQ card. The marker is an HTML comment, so it's invisible in any
// client that doesn't parse it (graceful for the live UI).
interface Choice { title?: string; question?: string; options: string[]; multi: boolean }
const CHOICE_RE = /<!--\s*mase-choice\s*(\{[\s\S]*?\})\s*-->/gi;
function parseChoices(text: string): { text: string; choices: Choice[] } {
  const src = text || "";
  const choices: Choice[] = [];
  const re = new RegExp(CHOICE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && Array.isArray(obj.options) && obj.options.length) {
        choices.push({
          title: typeof obj.title === "string" ? obj.title.trim() : undefined,
          question: typeof obj.question === "string" ? obj.question.trim() : undefined,
          options: obj.options.map((o: unknown) => String(o)).filter(Boolean),
          multi: !!obj.multi,
        });
      }
    } catch { /* malformed marker → skip it */ }
  }
  return { text: src.replace(new RegExp(CHOICE_RE.source, "gi"), "").trim(), choices };
}

// Inline markdown for the MCQ card's question + option labels (same renderer as the
// chat, but stripped to inline: no <p> block margins, so it sits cleanly inside a
// span/button). Without this the card showed raw markdown (e.g. **bold**, `code`).
function InlineMd({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (props) => <>{props.children}</>,
        a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-indigo-600 underline" />,
        code: (props) => <code className="rounded bg-[var(--accent-soft)] px-1 text-[12px]" {...props} />,
        strong: (props) => <strong className="font-semibold" {...props} />,
        ul: (props) => <ul className="my-0 list-disc pl-4" {...props} />,
        ol: (props) => <ol className="my-0 list-decimal pl-4" {...props} />,
        li: (props) => <li className="my-0" {...props} />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

// One self-contained MCQ card: header (optional muted title + bold question +
// collapse chevron), radio/checkbox option rows, and a Skip / Send response footer.
// Light + compact, themed off the dashboard CSS vars (--accent/--surface/--line)
// so it blends with the deal-AI panel and follows the active tab accent.
function ChoiceCard({ choice, onAnswer, disabled }: {
  choice: Choice; onAnswer: (t: string) => void; disabled: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [done, setDone] = useState<null | "sent" | "skipped">(null);
  const [collapsed, setCollapsed] = useState(false);
  const locked = disabled || done !== null;
  const toggle = (o: string) => {
    if (locked) return;
    if (choice.multi) setSelected((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
    else setSelected([o]);
  };
  const sendResponse = () => { if (locked || !selected.length) return; setDone("sent"); onAnswer(selected.join(choice.multi ? ", " : "; ")); };
  const skip = () => { if (locked) return; setDone("skipped"); };
  return (
    <div className="my-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left shadow-sm">
      <div className="flex items-start justify-between gap-2.5">
        <div className="text-[13.5px] leading-snug">
          {choice.title ? <span className="font-medium text-[var(--muted)]">{choice.title} : </span> : null}
          <span className="font-semibold text-[var(--ink)]">
            <InlineMd>{choice.question || (choice.multi ? "Select all that apply" : "Pick one")}</InlineMd>
          </span>
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand" : "Collapse"}
          className="-mr-0.5 mt-0.5 shrink-0 rounded p-0.5 text-[var(--muted)] transition hover:text-[var(--ink)]">
          {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>
      {!collapsed && (
        <>
          {done === "skipped" ? (
            <div className="mt-2 text-[12.5px] text-[var(--muted)]">Skipped</div>
          ) : (
            <div className="mt-2.5 flex flex-col gap-0.5">
              {choice.options.map((o) => {
                const active = selected.includes(o);
                return (
                  <button key={o} type="button" disabled={locked} onClick={() => toggle(o)}
                    className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition",
                      locked ? "cursor-default" : "hover:bg-[var(--accent-soft)]",
                      done === "sent" && !active ? "opacity-40" : "")}>
                    <span className={cn("grid h-[17px] w-[17px] shrink-0 place-items-center border-2 transition",
                      choice.multi ? "rounded-[5px]" : "rounded-full")}
                      style={{ borderColor: active ? "var(--accent)" : "#c3cbd9" }}>
                      {active ? <span className={choice.multi ? "h-2 w-2 rounded-[1px]" : "h-2 w-2 rounded-full"} style={{ background: "var(--accent)" }} /> : null}
                    </span>
                    <span className="text-[13px] text-[var(--ink2)]"><InlineMd>{o}</InlineMd></span>
                  </button>
                );
              })}
            </div>
          )}
          {done === null ? (
            <div className="mt-3 flex items-center justify-end gap-1">
              <button type="button" disabled={disabled} onClick={skip}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-40">
                Skip
              </button>
              <button type="button" disabled={disabled || !selected.length} onClick={sendResponse}
                className="rounded-lg px-4 py-1.5 text-[13px] font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "var(--accent)" }}>
                Send response
              </button>
            </div>
          ) : done === "sent" ? (
            <div className="mt-2 text-[12.5px] text-[var(--muted)]">Response sent</div>
          ) : null}
        </>
      )}
    </div>
  );
}

// Renders every MCQ card in a message, stacked. Each card is self-contained
// (its own selection + Skip + Send response).
function ChoiceGroup({ choices, onAnswer, disabled }: { choices: Choice[]; onAnswer: (t: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col">
      {choices.map((c, i) => <ChoiceCard key={i} choice={c} onAnswer={onAnswer} disabled={disabled} />)}
    </div>
  );
}

const SEED = "Which of this deal's open to-dos can the Todo Runner do for me, and which need a human? Group them and explain why.";

// Empty-state for a fresh chat — invites the user to let the agent DO the work.
// deal = per-deal quick actions; null = the generic whole-book strategist set.
function DealChatWelcome({ deal, onPick }: { deal?: DealForAgent | null; onPick: (p: string) => void }) {
  const QUICK = deal ? [
    { t: "Complete my to-dos", s: SEED, hot: true },
    { t: "Summarize this deal", s: "Summarize this deal: current status, the single biggest risk, and the most important next move. Keep it tight." },
    { t: "Draft a follow-up email", s: "Draft a short follow-up email to the key stakeholder on this deal. Never use em-dashes or double-dashes." },
    { t: "Surface the blocker", s: "What is the single biggest blocker on this deal right now, and exactly how do we clear it?" },
  ] : [
    { t: "What needs my attention today?", s: "Across my book, what needs my attention most urgently today? Rank the top 5 with a one-line reason each.", hot: true },
    { t: "Forecast risk check", s: "Which committed or best-case deals look at risk this quarter, and why? Be specific and dated." },
    { t: "Where did buyers go quiet?", s: "Which deals have had no two-way buyer engagement in the last 30 days? List them with days since last buyer touch." },
    { t: "Biggest moves this week", s: "What are the 3 highest-impact moves I should make this week across my book? Name the deal, the move, and who should be in the room." },
  ];
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-lg"><MaseStar className="size-6" /></div>
      <h3 className="text-[17px] font-bold text-foreground">{deal ? "Complete tasks with AI" : "Ask Mase about your book"}</h3>
      <p className="mt-1.5 max-w-[360px] text-[13px] leading-relaxed text-muted-foreground">
        {deal
          ? <>Let the agent do the legwork on {deal.accountName} — draft the emails, build the docs, line up references. Pick one to start, or just ask anything below.</>
          : <>The strategist reasons over your whole book — deals, risks, priorities, next moves. Pick one to start, or just ask anything below.</>}
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

export default function DealAgentPanel({ deal, onClose, onBack, onNewChat, convoKey, initialMessages, resumeChatId, seed, variant = "panel", genericScopeIds }: {
  // deal: the scoped opportunity — or null/undefined for a GENERIC (whole-book)
  // strategist chat, which is how the /chat page mounts this same component.
  deal?: DealForAgent | null;
  onClose?: () => void; onBack?: () => void; onNewChat?: () => void;
  convoKey?: string; initialMessages?: Msg[]; resumeChatId?: string; seed?: string;
  // "panel" = the fixed right-side drawer (default). "page" = fills its parent —
  // the /chat page embeds the SAME component/logic so both surfaces stay identical.
  variant?: "panel" | "page";
  // Generic mode only: locked users must always send their scoped opp ids so the
  // backend can never answer over deals outside their scope (hermetic scoping).
  genericScopeIds?: string[];
}) {
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
  const { isAdminView } = useDashboard();
  // Ask-Mase spend cap (Claude-style): while `limited`, the composer is disabled until
  // the window resets. `resetsAt` is the ISO reset time from the proxy's 429 body.
  const [limited, setLimited] = useState(false);
  const [resetsAt, setResetsAt] = useState<string | null>(null);
  // Approaching-limit soft notice (non-blocking, dismissable). Admins never see it.
  const [approaching, setApproaching] = useState(false);
  const [approachingResetsAt, setApproachingResetsAt] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // Voice dictation: each finalised speech chunk is appended into the composer. The
  // user still reviews the text and presses Enter to send — the send path is unchanged.
  const dictation = useDictation({
    onFinal: (t) => setInput((prev) => { const b = prev.replace(/\s+$/, ""); return (b ? b + " " : "") + t; }),
  });
  const stopDictation = dictation.stop;
  // Any send flips busy → stop listening so the mic never keeps running mid-turn.
  useEffect(() => { if (busy) stopDictation(); }, [busy, stopDictation]);
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
  // Generic-chat title: first user message, frozen once set (so the row's name is
  // stable across later persists). Deal chats keep the "[deal:<oid>]" marker.
  const titleRef = useRef<string>("");

  // Persist to mase_chats so the conversation shows in the deal-chats list. We tag
  // deal chats' title with a "[deal:<oid>]" marker (mase_chats has no metadata
  // column); generic strategist chats get a plain title from the first user turn.
  const persist = useCallback((msgs: Msg[]) => {
    const clean = msgs.map((m) => {
      const base: { role: string; content: string; thinkingSteps?: Step[]; isProcessing?: boolean; chatId?: string; attachmentNames?: string[] } = { role: m.role, content: m.content };
      if (m.thinkingSteps && m.thinkingSteps.length) base.thinkingSteps = m.thinkingSteps;
      if (m.isProcessing) base.isProcessing = true; // unfinished turn — kept so reopen can resume
      if (m.chatId) base.chatId = m.chatId;          // its live chat_id → re-attach on reopen
      if (m.attachmentNames && m.attachmentNames.length) base.attachmentNames = m.attachmentNames;
      return base;
    });
    if (!titleRef.current) {
      const firstUser = msgs.find((m) => m.role === "user" && m.content);
      titleRef.current = (firstUser?.content || "").replace(/\s+/g, " ").slice(0, 60) || "Strategist chat";
    }
    const title = deal ? `[deal:${deal.oid}] ${deal.accountName}` : titleRef.current;
    void supabase.from("mase_chats").upsert(
      { id: keyRef.current, title, messages: clean, updated_at: new Date().toISOString() },
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
    if (busy) setRunning({ convoKey: keyRef.current, oid: deal?.oid || "", accountName: deal?.accountName || titleRef.current || "Strategist chat", startedAt: Date.now(), streamChatId: activeChatId || undefined });
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

  // Staged composer attachments (paste a screenshot / pick files). Cleared on send.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    for (const f of arr) {
      if (f.size > ATT_MAX_BYTES) { setError(`"${f.name}" is too large (max ${Math.round(ATT_MAX_BYTES / 1_000_000)} MB)`); continue; }
      const fr = new FileReader();
      fr.onload = () => setStaged((s) => (s.length >= ATT_MAX_FILES ? s : [...s, {
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
        name: f.name || "pasted-image.png", mime: f.type || "application/octet-stream",
        size: f.size, dataUrl: String(fr.result || ""),
      }]));
      fr.readAsDataURL(f);
    }
  }, []);
  // Paste-to-attach: a clipboard image (screenshot) staged straight from Ctrl+V.
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  }, [addFiles]);

  // Send a turn: append the user message + an assistant placeholder, mint a fresh
  // streaming chat_id, and POST the full conversation — scoped to the deal's opp,
  // or (generic mode) to genericScopeIds / the whole book.
  const send = useCallback((text: string) => {
    const t = text.trim();
    const atts = staged;
    if ((!t && !atts.length) || busy || limited) return;
    setError(null);
    const content = t || "Please review the attached file(s).";
    const history = [...convoRef.current.filter((m) => m.content), { role: "user" as const, content }];
    const chatId = crypto.randomUUID();
    const userMsg: Msg = { role: "user", content, ...(atts.length ? { attachmentNames: atts.map((a) => a.name) } : {}) };
    const newConvo: Msg[] = [...convoRef.current, userMsg, { role: "assistant", content: "", thinkingSteps: [], isProcessing: true, chatId }];
    convoRef.current = newConvo;
    setConvo(newConvo);
    setStaged([]);
    atBottomRef.current = true; setHasNew(false); // a user send always jumps to the bottom
    persist(newConvo); // save the user turn + live chat_id NOW (survives a mid-run quit)
    setBusy(true); doneRef.current = false;
    setActiveChatId(chatId);
    (async () => {
      try {
        // Attachments ride on the FINAL user message only (base64; backend turns
        // images into vision parts and text-extracts documents).
        const msgs: any[] = history.map((m) => ({ role: m.role, content: m.content }));
        if (atts.length) {
          msgs[msgs.length - 1] = {
            ...msgs[msgs.length - 1],
            attachments: atts.map((a) => ({ name: a.name, mime: a.mime, data_b64: a.dataUrl.slice(a.dataUrl.indexOf(",") + 1) })),
          };
        }
        const body: any = { chat_id: chatId, messages: msgs };
        if (deal) { body.opp_ids = [deal.oid]; body.owner = deal.ownerName; }
        else if (genericScopeIds && genericScopeIds.length) body.opp_ids = genericScopeIds;
        const r = await fetch("/api/deal-engine/chat/async", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 429) {
          // Over the Ask-Mase spend cap. Claude-style: lock the composer until reset and
          // show a friendly, dollar-free banner with the exact reset time.
          const reset = typeof j.resets_at === "string" ? j.resets_at : null;
          setResetsAt(reset); setLimited(true);
          const when = reset ? new Date(reset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
          failLastTurn("You've reached your Ask Mase usage limit." + (when ? " Your access resets at " + when + "." : ""));
        }
        else if (!r.ok || j.error) { failLastTurn(j.error || `Error ${r.status}`); }
        else if (j.chat_id && j.chat_id !== chatId) setActiveChatId(j.chat_id);
      } catch (e: any) { failLastTurn(e?.message || String(e)); }
    })();
  }, [busy, limited, deal, genericScopeIds, staged, persist, failLastTurn]);

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

  // Auto-clear the cap lock exactly at reset so the composer re-enables on its own (a
  // retry before reset just 429s again and re-shows the banner). NEVER wedge: a missing
  // or unparseable resetsAt clears the lock immediately rather than disabling the composer
  // forever — the proxy always sends a valid resets_at, so this is a defensive fallback.
  useEffect(() => {
    if (!limited) return;
    const t = resetsAt ? new Date(resetsAt).getTime() : NaN;
    const ms = Number.isFinite(t) ? t - Date.now() : 0;
    if (ms <= 0) { setLimited(false); return; }
    const id = setTimeout(() => setLimited(false), ms);
    return () => clearTimeout(id);
  }, [limited, resetsAt]);

  // Approaching-limit soft notice: on mount and after each completed turn, ask the proxy
  // where this user stands. Admins are exempt (never fetch/show). Fail-open on any error.
  const checkCap = useCallback(async () => {
    if (isAdminView || limited) return;
    try {
      const r = await fetch("/api/deal-engine/usage/cap-check");
      if (!r.ok) return;
      const j = await r.json().catch(() => ({}));
      if (j.exempt) return;
      if (typeof j.spend === "number" && typeof j.cap === "number" && j.cap > 0 && j.spend >= j.cap * 0.8) {
        setApproaching(true);
        setApproachingResetsAt(typeof j.resets_at === "string" ? j.resets_at : null);
      } else {
        setApproaching(false);
      }
    } catch { /* metering hiccup → stay silent */ }
  }, [isAdminView, limited]);
  useEffect(() => { if (!busy) void checkCap(); }, [busy, checkCap]);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (busy || limited) return; const v = input; setInput(""); send(v); }
  }

  // "panel" = right-side drawer (espresso stays visible behind it, no blackout);
  // "page" = fills its parent — the /chat page embeds this same component.
  return (
    <div
      className={cn(
        "mase-chat-root flex flex-col bg-background",
        variant === "page"
          ? "relative h-full w-full"
          : "fixed right-0 top-0 bottom-0 z-[100] w-full max-w-[640px] border-l border-border shadow-2xl",
      )}
      style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {onBack ? (
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onBack} title="Back to conversations" aria-label="Back to conversations"><ArrowLeft className="size-4" /></Button>
          ) : null}
          {deal ? (
            <Monogram name={deal.accountName} kind="account" size={28} className="ml-1 shrink-0" />
          ) : (
            <span className="ml-1 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white"><MaseStar className="size-3.5" /></span>
          )}
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-foreground">{deal ? deal.accountName : "Mase Strategist"}</div>
            <div className="truncate text-[11px] text-muted-foreground">{deal ? (deal.oppName || "Deal AI") : "your whole book"}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onNewChat ? (
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-[12.5px] font-medium text-[#5277F0] hover:bg-[#5277F0]/10" onClick={onNewChat} title="Start a new chat for this deal" aria-label="New chat">
              <Plus className="size-3.5" /> New chat
            </Button>
          ) : null}
          {onClose ? <Button variant="ghost" size="icon" className="size-8" onClick={onClose}><X className="size-4" /></Button> : null}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-5">
          {convo.length === 0 && !busy ? <DealChatWelcome deal={deal} onPick={(p) => send(p)} /> : null}
          {convo.map((m, i) => (
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-muted px-3.5 py-2 text-[14px] leading-relaxed text-foreground">
                  {m.content}
                  {m.attachmentNames && m.attachmentNames.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.attachmentNames.map((n, ai2) => (
                        <span key={ai2} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11.5px] text-muted-foreground">
                          <Paperclip className="size-3" />{n}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <Avatar className="size-7 shrink-0 bg-gradient-to-br from-[#6E8BFF] to-[#5277F0]">
                  <AvatarFallback className="bg-transparent text-white"><MaseStar className="size-3.5" /></AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 text-[12px] font-semibold text-indigo-700">Jarvis</div>
                  {(m.thinkingSteps && m.thinkingSteps.length > 0) || m.isProcessing ? (
                    <AgentTrace steps={m.thinkingSteps || []} processing={!!m.isProcessing} />
                  ) : null}
                  {(() => {
                    const parsed = parseChoices(m.content);
                    let bubbleText = parsed.text;
                    let effChoices = parsed.choices;
                    // If a single question has no explicit "question" field, lift the
                    // lead-in prose's last line into the card as its question (so it shows
                    // INSIDE the card, not as loose prose above it).
                    if (effChoices.length === 1 && !effChoices[0].question && bubbleText.trim()) {
                      const lines = bubbleText.trim().split(/\n+/);
                      const q = lines.pop() || "";
                      effChoices = [{ ...effChoices[0], question: q }];
                      bubbleText = lines.join("\n").trim();
                    }
                    return (
                      <>
                        {bubbleText ? <Bubble text={bubbleText} /> : null}
                        {effChoices.length > 0 && i === convo.length - 1 && !busy ? (
                          <ChoiceGroup choices={effChoices} disabled={busy} onAnswer={(t) => send(t)} />
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

      {/* Approaching-limit soft notice — non-blocking, dismissable. Never for admins/limited. */}
      {approaching && !noticeDismissed && !isAdminView && !limited ? (
        <div className="mx-5 mb-1 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          <span className="flex-1">
            You&apos;re approaching your Ask Mase limit{approachingResetsAt ? " — it resets at " + new Date(approachingResetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}.
          </span>
          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-amber-700 transition hover:text-amber-900"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {/* Composer — same input as /chat, plus voice dictation (mic) */}
      <div className="px-5 py-4">
        <div className="rounded-2xl border border-border bg-muted/40 transition focus-within:border-indigo-400 focus-within:bg-card focus-within:ring-2 focus-within:ring-indigo-100">
          {staged.length ? (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {staged.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-[12px] text-foreground">
                  {s.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.dataUrl} alt={s.name} className="size-6 rounded object-cover" />
                  ) : (
                    <Paperclip className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="max-w-[160px] truncate">{s.name}</span>
                  <button type="button" aria-label={`Remove ${s.name}`} onClick={() => setStaged((prev) => prev.filter((x) => x.id !== s.id))}
                    className="rounded p-0.5 text-muted-foreground transition hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            disabled={limited}
            rows={2}
            placeholder={limited ? "Ask Mase usage limit reached" : dictation.listening ? "Listening… speak now" : deal ? "Ask about this deal, its to-dos, or next steps… (paste a screenshot to attach)" : "Ask about your book — deals, risks, priorities… (paste a screenshot to attach)"}
            className="min-h-[52px] resize-none border-0 bg-transparent px-4 py-3 text-[14px] shadow-none focus-visible:ring-0"
          />
          {dictation.listening ? (
            <div className="flex items-center gap-1.5 px-4 pb-1 text-[12px] text-muted-foreground">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-medium text-red-500">Listening…</span>
              {dictation.interim
                ? <span className="truncate italic opacity-80">{dictation.interim}</span>
                : <span className="opacity-60">speak, then tap the mic to stop</span>}
            </div>
          ) : null}
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1.5">
              <input ref={fileInputRef} type="file" accept={ATT_ACCEPT} multiple hidden
                onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={limited || staged.length >= ATT_MAX_FILES}
                title="Attach files or images"
                aria-label="Attach files or images"
                className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-indigo-300 hover:text-foreground disabled:opacity-40"
              >
                <Paperclip className="size-4" />
              </button>
              {dictation.supported ? (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-pressed={dictation.listening}
                  title={dictation.listening ? "Stop dictation" : "Dictate (voice to text)"}
                  aria-label={dictation.listening ? "Stop dictation" : "Dictate with voice"}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border transition",
                    dictation.listening
                      ? "animate-pulse border-red-200 bg-red-50 text-red-600 ring-2 ring-red-100"
                      : "border-border bg-card text-muted-foreground hover:border-indigo-300 hover:text-foreground",
                  )}
                >
                  <Mic className="size-4" />
                </button>
              ) : null}
            </div>
            <Button
              size="icon"
              className="size-9 rounded-full bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white hover:opacity-95 disabled:opacity-40"
              disabled={busy || limited || (!input.trim() && !staged.length)}
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
