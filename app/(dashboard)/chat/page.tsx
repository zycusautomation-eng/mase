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
//
// ── UI ─────────────────────────────────────────────────────────────────────
// The presentation is a 3-column Notion/Claude/Linear-style workspace built on
// Tailwind v4 + shadcn/ui (see app/tailwind.css + components/ui/*). The
// streaming/applyRow/AgentTrace/persist/scoping/lock logic below is UNCHANGED
// from the original custom-CSS page — only the JSX/skin was rebuilt. The new
// sidebar binds to the same saved-chats state; the new composer calls send();
// the center column renders the same live assistant content + AgentTrace; the
// right "Deal context" panel binds to the active DashboardContext record.
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles, PencilLine, Search, Plus, Handshake, Bot,
  ListChecks, GraduationCap, ChevronDown, Clock,
  Paperclip, ArrowUp, Square, X, BadgeCheck, Crosshair,
  PanelRight, Coffee, Leaf, MessageSquare, RefreshCw, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "@/lib/engine/DashboardContext";
import {
  vpsList, teamOwners, scopeRecords, scopeLabel,
  EMPTY_SCOPE, type ChatScope, type ChatScopeMode,
} from "@/lib/engine/helpers";
import AuthButton from "@/components/AuthButton";
import MultiSelect, { type Opt } from "@/components/MultiSelect";
import { track } from "@/lib/tracking/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandShortcut,
} from "@/components/ui/command";

// A tool step in the live "agent working" trace. `group:"todo"` marks a step
// emitted by the nested Todo Runner sub-agent (rendered in its own sub-accordion).
interface Step { type: "thinking" | "tool_call" | "tool_result"; tool?: string; args?: string; content?: string; group?: "todo" }
// A chat message. `thinkingSteps`/`isProcessing` are present only on a live
// assistant turn; persisted chats keep just {role, content}.
interface Msg { role: "user" | "assistant"; content: string; thinkingSteps?: Step[]; isProcessing?: boolean; ts?: number }
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

// Left-nav sections → the real dashboard tabs (same routes as the global header).
// Chat is this surface (rendered active).
const NAV: { key: string; label: string; icon: LucideIcon; href: string; adminOnly?: boolean }[] = [
  { key: "deals", label: "Deals", icon: Handshake, href: "/deals" },
  { key: "espresso", label: "Espresso", icon: Coffee, href: "/espresso" },
  { key: "matcha", label: "Matcha", icon: Leaf, href: "/matcha" },
  { key: "chat", label: "Chat", icon: MessageSquare, href: "/chat" },
  { key: "sync", label: "Sync Quality", icon: RefreshCw, href: "/sync-quality", adminOnly: true },
  { key: "runs", label: "Runs", icon: ListChecks, href: "/runs", adminOnly: true },
  { key: "learning", label: "Learning", icon: GraduationCap, href: "/learnings", adminOnly: true },
  { key: "admin", label: "Admin", icon: Bot, href: "/admin", adminOnly: true },
];

// ---- per-user DB persistence (Supabase, RLS-scoped to the signed-in user) ----
async function fetchChats(): Promise<Chat[]> {
  const supabase = createClient();
  // List the sidebar with ONLY id/title/updated_at — never the (potentially large)
  // messages JSON. Messages are loaded on demand when a chat is opened. Capped so
  // the sidebar stays fast no matter how many chats accrue.
  const { data, error } = await supabase
    .from("mase_chats")
    .select("id,title,updated_at")
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    // Strip the "[deal:<oid>]" marker so deal AI chats read cleanly in the sidebar.
    title: String(r.title || "New chat").replace(/^\[deal:[^\]]+\]\s*/, ""),
    ts: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
    messages: [], // lazy — fetched in openChat()
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
function timeLabel(ts: number) { try { return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

// A compact, copyable chat identifier — the chat analog of a deal's opp_id. mase_chats
// rows are keyed by a UUID (the only stable id; also the /chat/<id> URL slug). We surface
// its first 8 chars as a "#xxxxxxxx" chip; clicking copies the FULL id to the clipboard.
function IdChip({ id, dark = false }: { id: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        try { void navigator.clipboard?.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked — no-op */ }
      }}
      title={`Chat id: ${id} — click to copy`}
      className={cn(
        "rounded px-1 font-mono text-[10px] leading-none tracking-wide transition",
        dark ? "text-white/55 hover:bg-white/15 hover:text-white" : "text-muted-foreground/60 hover:bg-muted hover:text-indigo-600",
      )}
    >
      {copied ? "copied ✓" : `#${id.slice(0, 8)}`}
    </button>
  );
}

// Group saved chats by relative day header ("Today" / "Yesterday" / a date).
function dayBucket(ts: number): string {
  const d = new Date(ts); const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  try { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return "Earlier"; }
}

// Parse a chat_messages.metadata field that may be a JSON string or an object.
function parseMeta(meta: any): any {
  if (!meta) return {};
  if (typeof meta === "string") { try { return JSON.parse(meta) || {}; } catch { return {}; } }
  return meta;
}

// Short status words in qualification tables → colored pills, so "Weak" / "High"
// / "Strong" read as badges instead of plain text. Only applied to short single
// tokens, so the long "evidence" prose cells are never badged.
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
// Flatten a React node tree to its plain text (markdown cells can be strings,
// arrays, or wrapped in <strong>/<em>) so we can keyword-match a status cell.
function nodeText(node: React.ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in (node as any)) return nodeText((node as any).props?.children);
  return "";
}

// Full markdown rendering (GFM: tables, task lists, strikethrough, autolinks)
// so the strategist's structured answers render properly instead of raw pipes.
function Bubble({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-neutral max-w-none text-[14px] leading-relaxed text-foreground [&_table]:my-0 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-[13px] [&_tr]:border-b [&_tr]:border-border [&_tbody_tr:last-child]:border-0 [&_tbody_tr:nth-child(even)]:bg-muted/30 [&_a]:text-indigo-600 [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[12.5px] [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-300 [&_blockquote]:pl-3 [&_blockquote]:not-italic [&_blockquote]:text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          table: ({ ...props }) => (
            <div className="my-3 overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto">
                <table {...props} />
              </div>
            </div>
          ),
          td: ({ children, ...props }) => {
            const t = nodeText(children).trim();
            const tone = STATUS_BADGE[t.toLowerCase()];
            if (tone && t.length <= 16) {
              return (
                <td {...props}>
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{t}</span>
                </td>
              );
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
      <div className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Dots />
        <span>Working…</span>
      </div>
    ) : null;
  }

  // Only the chat's OWN steps count toward the headline tool count; the nested
  // Todo Runner steps are summarised separately inside their sub-accordion.
  const toolCount = steps.filter((s) => s.type === "tool_call" && s.group !== "todo").length;
  const summary = processing
    ? "Agent working…"
    : `Agent steps${toolCount ? ` · ${toolCount} tool call${toolCount === 1 ? "" : "s"}` : ""}`;

  // Render the steps in order, but collapse each contiguous run of todo-group
  // steps into ONE nested "Todo Runner working…" sub-accordion.
  const blocks: React.ReactNode[] = [];
  let todoRun: Step[] = [];
  let todoKey = 0;
  const flushTodo = () => {
    if (todoRun.length === 0) return;
    blocks.push(<TodoSubTrace key={`todo-${todoKey++}`} steps={todoRun} processing={processing} />);
    todoRun = [];
  };
  steps.forEach((s, i) => {
    if (s.group === "todo") { todoRun.push(s); return; }
    flushTodo();
    blocks.push(<StepRow key={i} step={s} />);
  });
  flushTodo();

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1 mb-1 rounded-lg border border-border bg-muted/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", open ? "" : "-rotate-90")} />
        {processing ? <Dots /> : null}
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 px-3 pb-3">{blocks}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Three-dot "typing" indicator.
function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="size-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-indigo-400" />
    </span>
  );
}

// One thinking / tool_call / tool_result row (shared by the main trace and the
// nested Todo Runner sub-trace).
function StepRow({ step: s }: { step: Step }) {
  if (s.type === "thinking") {
    return <div className="text-[13px] italic leading-relaxed text-muted-foreground">{s.content}</div>;
  }
  if (s.type === "tool_call") {
    return (
      <div className="text-[13px]">
        <div className="font-mono text-indigo-600">→ {s.tool || "tool"}</div>
        {s.args && s.args !== "{}" ? (
          <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[12px] text-muted-foreground">{s.args}</pre>
        ) : null}
      </div>
    );
  }
  const txt = (s.content || "").slice(0, 800);
  return (
    <pre className="overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[12px] text-muted-foreground">{txt}{(s.content || "").length > 800 ? "…" : ""}</pre>
  );
}

// Nested, indented sub-accordion for the Todo Runner's own live steps.
function TodoSubTrace({ steps, processing }: { steps: Step[]; processing: boolean }) {
  const [open, setOpen] = useState(true);
  const toolCount = steps.filter((s) => s.type === "tool_call").length;
  const summary = processing
    ? "Todo Runner working…"
    : `Todo Runner${toolCount ? ` · ${toolCount} tool call${toolCount === 1 ? "" : "s"}` : ""}`;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="ml-2 rounded-lg border-l-2 border-indigo-300 bg-indigo-50/40 pl-3">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", open ? "" : "-rotate-90")} />
        <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">Todo Runner</Badge>
        {processing ? <Dots /> : null}
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pb-2">
          {steps.map((s, i) => <StepRow key={i} step={s} />)}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Admin-only block to edit the chat agent's system prompt (its behaviour). Reads
// /api/deal-engine/chat/prompt (the active override + the built-in default) and
// writes edits back. The proxy enforces admin on this path; this UI is also only
// rendered for admins. Saved edits apply to everyone's chat on the next message.
// RIGHT PANEL — live editor for the chat agent's SYSTEM PROMPT. Fetches the
// current prompt from /api/deal-engine/chat/prompt, lets an admin edit it, and
// saves it back; saved changes apply to EVERYONE's chat on the next message (no
// redeploy). The whole chat page is admin-gated, so this is admin-only.
function AgentPromptPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [serverPrompt, setServerPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [isOverride, setIsOverride] = useState(false);
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
      }
    } catch (e: any) { setNote(e?.message || String(e)); }
    setLoading(false);
  }

  // Fetch the prompt as soon as the panel mounts so it's ready and never blank.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

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
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">System prompt</span>
          {isOverride
            ? <Badge className="bg-indigo-100 text-indigo-700">custom</Badge>
            : <Badge variant="secondary">default</Badge>}
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          The chat agent&apos;s system prompt. Saving applies to <b>everyone&apos;s</b> chat on the next
          message — no redeploy. Use <b>Reset</b> to restore the default.
        </p>
        {loading ? (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        ) : (
          <>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-xl font-mono text-[12px] leading-relaxed"
              placeholder="(agent system prompt)"
            />
            {note && <div className="text-[12px] text-muted-foreground">{note}</div>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty && <span className="mr-auto text-[12px] font-medium text-amber-600">Unsaved changes</span>}
              <Button variant="outline" size="sm" onClick={load} disabled={loading || saving}>Reload</Button>
              <Button variant="outline" size="sm" onClick={() => setPrompt(defaultPrompt)} disabled={saving || prompt === defaultPrompt || !defaultPrompt}>Load default</Button>
              <Button variant="outline" size="sm" onClick={() => save("")} disabled={saving || !isOverride}>Reset</Button>
              <Button size="sm" className="bg-[#5b8cff] text-white hover:bg-[#5b8cff]/90" onClick={() => save(prompt)} disabled={saving || !dirty || !prompt.trim()}>Save</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The strategist chat is available to admins, and to all users when an admin has
// flipped the "enable chat for users" toggle (admin panel → Access & Config). The
// /api/deal-engine/chat* proxy enforces the same rule server-side; this page-level
// lock is the backstop so a direct /chat URL can't reach a chat that would only 403.
export default function ChatPage() {
  const { isAdminView, chatAllowed } = useDashboard();
  if (!isAdminView && !chatAllowed) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="text-lg font-semibold">🔒 Chat</div>
          <div className="mt-1 text-sm text-muted-foreground">Chat isn&apos;t enabled for your account yet. Ask an admin to turn it on.</div>
        </div>
      </div>
    );
  }
  return <ChatPageInner />;
}

function ChatPageInner() {
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

  // ── UI-only state (presentation; does not affect streaming) ──
  const [cmdOpen, setCmdOpen] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);

  // Stable browser Supabase client (used for realtime + the polling fallback).
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Signed-in identity for the sidebar footer (display name → email fallback).
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => setUserName((data.user?.user_metadata?.name as string) || data.user?.email || null))
      .catch(() => {});
  }, [supabase]);

  // Shareable per-chat URLs (/chat/<id>). Capture the id in the URL on first
  // render, then open that conversation once the saved chats arrive. In-app
  // navigation (openChat/newChat/send) keeps the URL in sync via the History API
  // so the workspace never remounts (state is preserved).
  const pathname = usePathname();
  const urlChatId = useRef<string | null>(pathname?.match(/^\/chat\/([^/?#]+)/)?.[1] ?? null);
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current) return;
    openedFromUrl.current = true;
    const id = urlChatId.current;
    if (id) void openChat(id); // openChat lazy-loads this chat's messages by id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ⌘K / Ctrl-K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((o) => !o); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const vpOpts: Opt[] = useMemo(() => vpsList(records).map((v) => ({ value: v, label: v })), [records]);
  const ownerOpts: Opt[] = useMemo(() => teamOwners(records, []).map((o) => ({ value: o, label: o })), [records]);
  const dealOpts: Opt[] = useMemo(() =>
    [...records]
      .sort((a, b) => `${(a.hard || {}).account_name}`.localeCompare(`${(b.hard || {}).account_name}`))
      .map((r) => ({ value: r.opp_id, label: `${(r.hard || {}).account_name} — ${(r.hard || {}).opp_name}` })),
  [records]);

  const inScope = useMemo(() => scopeRecords(records, scope), [records, scope]);
  const scopeText = scopeLabel(scope, inScope);

  // Persist the conversation. Keep the agent's tool-call trace (thinkingSteps) so
  // reopening a saved chat still shows what the agent did — only the live-only
  // `isProcessing` flag is dropped (so a reopened turn never shows a spinner).
  function persist(msgs: Msg[], id: string | null): string {
    const cid = id || crypto.randomUUID();
    const clean: Msg[] = msgs.map((m) => {
      const base: Msg = { role: m.role, content: m.content };
      if (m.ts) base.ts = m.ts;
      if (m.thinkingSteps && m.thinkingSteps.length) base.thinkingSteps = m.thinkingSteps;
      return base;
    });
    const title = ((clean[0] && clean[0].content) || "New chat").replace(/\s+/g, " ").slice(0, 52);
    const rec: Chat = { id: cid, title, ts: Date.now(), messages: clean };
    // Optimistic local update (touched chat to the top), then persist to the DB
    // in the background.
    setChats((prev) => [rec, ...prev.filter((c) => c.id !== cid)]);
    void saveChatDb(rec).catch((e) => console.warn("[chat] save failed", e));
    return cid;
  }

  // SINGLE SOURCE OF TRUTH for the in-flight turn: rebuild the live assistant
  // message from ALL of its chat_messages rows. Both the realtime change events
  // and the polling fallback call this, so the agent trace is ALWAYS complete —
  // no tool_call/thinking rows are lost to the realtime connect race (the reason
  // the trace went missing in the rebuilt UI), and a full rebuild means there are
  // never duplicate steps.
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function reconcile(chatId: string | null) {
    if (!chatId) return;
    const { data, error: dberr } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .order("sequence", { ascending: true });
    if (dberr || !data || data.length === 0) return;
    const steps: Step[] = [];
    let finalContent = "";
    let terminal = false;
    let errText = "";
    for (const row of data) {
      if (row.role !== "assistant") continue;
      const type = (row.type || "message") as string;
      const meta = parseMeta(row.metadata);
      const grp = meta.group === "todo" ? ("todo" as const) : undefined;
      if (type === "thinking") steps.push({ type: "thinking", content: row.content, group: grp });
      else if (type === "tool_call") {
        const rawArgs = meta.args ?? {};
        let args = "";
        try { args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs, null, 2); } catch { args = String(rawArgs); }
        steps.push({ type: "tool_call", tool: meta.tool || meta.name || "tool", args, group: grp });
      } else if (type === "tool_result") steps.push({ type: "tool_result", content: row.content, group: grp });
      else if (type === "final" || type === "message") { finalContent = row.content || ""; terminal = true; }
      else if (type === "error") { errText = row.content || "The agent run failed."; terminal = true; }
      else if (type === "status" && (meta.status === "cancelled" || (row.content || "").toLowerCase().includes("stopped"))) { terminal = true; }
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
      if (idx === -1) next.push(live); else next[idx] = live;
      if (terminal && !turnDoneRef.current) {
        turnDoneRef.current = true;
        setBusy(false);
        if (errText) setError(errText);
        else persist(next, persistIdRef.current); // saves the FULL trace too
      }
      return next;
    });
  }
  // Realtime fires one change event per inserted row; debounce so a burst of
  // tool steps triggers a single rebuild.
  function scheduleReconcile(chatId: string | null) {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => { void reconcile(chatId); }, 180);
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
        () => { scheduleReconcile(activeChatId); }
      )
      .subscribe((status) => {
        // On connect, immediately reconcile to backfill any rows written during
        // the subscribe handshake (the ones that used to be lost → no trace).
        if (status === "SUBSCRIBED") { clearTimeout(connectTimeout); setRealtimeStatus("connected"); void reconcile(activeChatId); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(connectTimeout); setRealtimeStatus("error"); }
        else if (status === "CLOSED") { clearTimeout(connectTimeout); setRealtimeStatus("disconnected"); }
      });

    return () => { clearTimeout(connectTimeout); supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, supabase]);

  // DB poll — rebuild the live trace from chat_messages every 2s while a turn is
  // in flight. This runs ALWAYS (not only when realtime is down): the MASE chat
  // is async (the endpoint returns {chat_id} and the agent runs in the
  // background — there is NO SSE stream), so the DB is the only source of the
  // tool-call/Todo-Runner trace. Realtime just makes it snappier; the poll is
  // what guarantees the trace shows even if realtime "connects" but misses the
  // early rows. reconcile() is a full rebuild, so poll + realtime never duplicate.
  useEffect(() => {
    if (!activeChatId) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      if (!busyRef.current && turnDoneRef.current) return;
      await reconcile(activeChatId);
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { stopped = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, supabase]);

  // Watchdog — if a run goes silent (no terminal row), stop the spinner after
  // ~300s so the UI never hangs on "Working…". Resets on every `messages` change.
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      setBusy(false);
      setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.isProcessing ? { ...m, isProcessing: false } : m)));
    }, 300_000);
    return () => clearTimeout(timer);
  }, [busy, messages]);

  async function send(text: string) {
    if (busy || !text.trim()) return;
    setError(null);
    track("chat_message", { scope: scope.mode });
    // Optimistic UI: append the user message + an in-flight assistant placeholder.
    const userMsgs: Msg[] = [...messages, { role: "user", content: text, ts: Date.now() }];
    const withPlaceholder: Msg[] = [...userMsgs, { role: "assistant", content: "", thinkingSteps: [], isProcessing: true }];
    setMessages(withPlaceholder);
    setBusy(true);

    // Persist the user turn now (so it's saved even if the reply never lands).
    const cid = persist(userMsgs, currentId);
    setCurrentId(cid);
    persistIdRef.current = cid;
    syncUrl(cid); // first message → the new chat gets a shareable /chat/<id> URL

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

  // Keep the URL in sync with the open chat WITHOUT a Next navigation (the route
  // would remount and wipe state). /chat/<id> when a chat is open, /chat otherwise.
  function syncUrl(id: string | null) {
    try { window.history.replaceState(null, "", id ? `/chat/${id}` : "/chat"); } catch { /* ignore */ }
  }
  function newChat() { setCurrentId(null); setMessages([]); setError(null); setActiveChatId(null); turnDoneRef.current = true; syncUrl(null); }
  // Stop the running agent: optimistically end the turn in the UI (drop the
  // spinner, keep the partial trace + persist it), then tell the backend to
  // cancel the asyncio task so it stops burning tokens.
  async function stopAgent() {
    const cid = activeChatId;
    turnDoneRef.current = true;
    setBusy(false);
    setMessages((prev) => {
      const next = prev.map((m) => (m.role === "assistant" && m.isProcessing ? { ...m, isProcessing: false } : m));
      persist(next, persistIdRef.current);
      return next;
    });
    if (cid) {
      try { await fetch(`/api/deal-engine/chat/stop?chat_id=${encodeURIComponent(cid)}`, { method: "POST" }); }
      catch { /* best-effort — the UI is already stopped */ }
    }
  }
  async function openChat(id: string) {
    setCurrentId(id); setError(null);
    setActiveChatId(null); turnDoneRef.current = true; setBusy(false);
    syncUrl(id);
    // Use cached messages if this chat was already opened/sent this session;
    // otherwise lazy-load just this chat's messages from the DB.
    const cached = chats.find((x) => x.id === id);
    if (cached?.messages?.length) { setMessages(cached.messages.slice()); return; }
    setMessages([]);
    try {
      const { data } = await supabase.from("mase_chats").select("title,messages").eq("id", id).single();
      if (!data) return;
      const msgs: Msg[] = Array.isArray(data.messages) ? data.messages : [];
      setMessages(msgs);
      setChats((prev) => prev.some((x) => x.id === id)
        ? prev.map((x) => (x.id === id ? { ...x, messages: msgs } : x))
        : [{ id, title: data.title || "Chat", ts: Date.now(), messages: msgs }, ...prev]);
    } catch { /* ignore — empty chat */ }
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

  // Run a command-palette action: prefill + (for hints) send immediately.
  function runCommand(text: string, sendNow = false) {
    setCmdOpen(false);
    if (sendNow) { send(text); } else { setInput(text); }
  }

  // Saved chats grouped by day for the sidebar history.
  const grouped = useMemo(() => {
    const sorted = [...chats].sort((a, b) => b.ts - a.ts);
    const buckets: { label: string; items: Chat[] }[] = [];
    for (const c of sorted) {
      const label = dayBucket(c.ts);
      let g = buckets.find((x) => x.label === label);
      if (!g) { g = { label, items: [] }; buckets.push(g); }
      g.items.push(c);
    }
    return buckets;
  }, [chats]);

  return (
    <div className="h-full w-full overflow-hidden bg-background text-foreground">
      {/* ⌘K command palette */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search deals, accounts, conversations…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Quick actions">
            <CommandItem onSelect={() => { setCmdOpen(false); newChat(); }}>
              <PencilLine /> New chat
            </CommandItem>
            <CommandItem onSelect={() => runCommand("Search the book for deals matching: ")}>
              <Handshake /> Search Deals
            </CommandItem>
            <CommandItem onSelect={() => runCommand("Find accounts matching: ")}>
              <Bot /> Search Accounts
            </CommandItem>
            <CommandItem onSelect={() => runCommand("Search my conversations for: ")}>
              <Search /> Search Conversations
            </CommandItem>
            <CommandItem onSelect={() => runCommand(HINTS[0].q, true)}>
              <BadgeCheck /> Run Qualification <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          {grouped.length ? (
            <CommandGroup heading="Recent conversations">
              {grouped.flatMap((g) => g.items).slice(0, 6).map((c) => (
                <CommandItem key={c.id} onSelect={() => { setCmdOpen(false); openChat(c.id); }}>
                  <Clock /> {c.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>

      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* ─────────────── LEFT SIDEBAR ─────────────── */}
        <ResizablePanel defaultSize={20} minSize={14} maxSize={28} className="bg-sidebar">
          <div className="flex h-full flex-col border-r border-border">
            {/* Wordmark — same logo as the global header (/mase-logo.svg) */}
            <div className="flex items-center px-4 pt-4 pb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mase-logo.svg" alt="MASE — Agents that close with you" className="h-9 w-auto" />
            </div>

            {/* New chat */}
            <div className="px-3">
              <Button onClick={newChat} className="h-9 w-full justify-center gap-2 rounded-lg bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-[0_8px_24px_rgba(98,128,240,0.3)] hover:opacity-95">
                <Plus className="size-4" /> New chat
              </Button>
            </div>

            {/* Nav list — admin-only tabs hidden for non-admin chat users */}
            <nav className="mt-3 space-y-0.5 px-2">
              {NAV.filter((n) => !n.adminOnly || isAdminView).map((n) => {
                const Icon = n.icon;
                const active = n.key === "chat";
                return (
                  <Link
                    key={n.key}
                    href={n.href}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition",
                      active
                        ? "bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-[0_8px_24px_rgba(98,128,240,0.3)]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" /> {n.label}
                  </Link>
                );
              })}
            </nav>

            <Separator className="my-3" />

            {/* Chat history grouped by day */}
            <ScrollArea className="min-h-0 flex-1 px-2">
              {grouped.length === 0 ? (
                <div className="px-2 py-4 text-[12px] leading-relaxed text-muted-foreground">
                  No saved chats yet. Start asking and your conversations are saved here.
                </div>
              ) : (
                grouped.map((g) => (
                  <div key={g.label} className="mb-2">
                    <div className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                    {g.items.map((c) => {
                      const active = c.id === currentId;
                      return (
                        <div
                          key={c.id}
                          onClick={() => openChat(c.id)}
                          className={cn(
                            "group relative flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 pr-6 text-[13px] transition",
                            active ? "bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-[0_8px_24px_rgba(98,128,240,0.3)]" : "text-foreground hover:bg-muted"
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block break-words leading-snug" title={c.title}>{c.title}</span>
                            <IdChip id={c.id} dark={active} />
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                            className={cn(
                              "absolute right-1 top-1 hidden rounded p-0.5 group-hover:block",
                              active ? "text-white/70 hover:bg-white/20 hover:text-white" : "text-muted-foreground hover:bg-background hover:text-destructive"
                            )}
                            title="Delete"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              {chats.length > 0 && (
                <button className="mb-2 w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-indigo-600 hover:bg-muted">
                  View all chats
                </button>
              )}
            </ScrollArea>

            <Separator />

            {/* Footer: the real account menu — same <AuthButton/> as the global
                navbar (signed-in identity, simulate view, Salesforce, sign out).
                The .mase-chat-authmenu wrapper flips its dropdown to open UPWARD
                (it's pinned to the bottom of the sidebar). */}
            <div className="mase-chat-authmenu flex min-w-0 items-center gap-2 px-3 py-3">
              <AuthButton />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px] font-medium text-foreground">{userName || scopeName || "Account"}</div>
                <div className="truncate text-[11px] text-muted-foreground">{scopeName ? `Simulating · ${scopeName}` : "Admin"}</div>
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* ─────────────── CENTER ─────────────── */}
        <ResizablePanel defaultSize={showContext ? 56 : 80} minSize={36}>
          <div className="flex h-full flex-col">
            {/* Scope controls (drive the opp_ids sent to the backend) */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {locked ? (
                  <Badge variant="secondary" className="gap-1" title="The strategist only sees your deals">
                    <Crosshair className="size-3" />
                    {blocked ? "No deals assigned" : <>Scoped: {scopeName} · {records.length}</>}
                  </Badge>
                ) : (
                  <>
                    <div className="flex items-center gap-0.5 rounded-full bg-muted/70 p-0.5">
                      {MODES.map((m) => (
                        <button
                          key={m.key}
                          onClick={() => setMode(m.key)}
                          className={cn(
                            "rounded-full px-3 py-1 text-[12px] font-medium transition",
                            scope.mode === m.key
                              ? "bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white shadow-[0_8px_24px_rgba(98,128,240,0.3)]"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {m.label}
                        </button>
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
                    <Badge variant={scoped ? "default" : "secondary"} className={scoped ? "bg-[#5b8cff]" : ""}>
                      {scope.mode === "generic"
                        ? `Whole book · ${records.length}`
                        : scope.mode === "deal" && !scope.oppId
                          ? "No deal selected"
                          : `${scopeText} · ${inScope.length}`}
                    </Badge>
                    {(scope.vps.length || scope.owners.length || scope.oppId) ? (
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => setScope({ ...EMPTY_SCOPE, mode: scope.mode })}>
                        <X className="size-3" /> Clear
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
              {!showContext && isAdminView && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowContext(true)}
                >
                  <PanelRight className="size-3.5" /> System prompt
                </Button>
              )}
            </div>

            {/* Conversation */}
            <div ref={msgsRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="mx-auto mt-10 max-w-2xl text-center">
                  <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#5b8cff] text-white shadow-sm">
                    <Sparkles className="size-6" />
                  </div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight">Ask the strategist about your book</h3>
                  <p className="mx-auto mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
                    Best-deal questions run the full qualification drill — engagement, champion, access to
                    power, competition, product fit, risk — tested against the facts, not the forecast label.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {HINTS.map((hn) => (
                      <button
                        key={hn.label}
                        onClick={() => send(hn.q)}
                        className="rounded-full border border-border/70 bg-muted/40 px-3.5 py-1.5 text-[13px] font-medium text-foreground transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        {hn.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-5">
                  {messages.map((m, i) => (
                    <MessageRow key={i} m={m} />
                  ))}
                  {error ? (
                    <div className="flex gap-3">
                      <Avatar className="size-7 shrink-0 bg-[#5b8cff]">
                        <AvatarFallback className="bg-[#5b8cff] text-white"><Sparkles className="size-3.5" /></AvatarFallback>
                      </Avatar>
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[14px] text-destructive">{error}</div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="px-5 py-4">
              <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-muted/40 transition focus-within:border-indigo-400 focus-within:bg-card focus-within:ring-2 focus-within:ring-indigo-100">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={2}
                  disabled={blocked}
                  placeholder={blocked ? "You don't have access to any deals." : "Ask about risks, qualification, next steps, or deal strategy…"}
                  className="min-h-[52px] resize-none border-0 bg-transparent px-4 py-3 text-[14px] shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center gap-2 px-3 pb-2.5">
                  <div className="flex-1" />
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
                    <Paperclip className="size-4" />
                  </Button>
                  {busy ? (
                    <Button
                      size="icon"
                      className="size-9 rounded-full bg-red-500 text-white hover:bg-red-600"
                      onClick={stopAgent}
                      title="Stop the agent"
                    >
                      <Square className="size-4 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      className="size-9 rounded-full bg-[#5b8cff] text-white hover:bg-[#5b8cff]/90 disabled:opacity-40"
                      disabled={blocked || !input.trim()}
                      onClick={() => { const v = input; setInput(""); send(v); }}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>

        {/* ─────────────── RIGHT PANEL — agent system-prompt editor ─────────────── */}
        {showContext && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={30} minSize={22} maxSize={46} className="bg-sidebar">
              <AgentPromptPanel onClose={() => setShowContext(false)} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

// One message in the conversation: user (right, muted bubble) or assistant
// (left, indigo sparkle avatar + "Strategist" label + AgentTrace + content).
function MessageRow({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="flex max-w-[80%] flex-col items-end">
          <div className="rounded-2xl rounded-tr-sm bg-muted px-3.5 py-2 text-[14px] leading-relaxed text-foreground">
            {m.content}
          </div>
          {m.ts ? <span className="mt-1 text-[11px] text-muted-foreground">{timeLabel(m.ts)}</span> : null}
        </div>
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="bg-foreground text-[11px] font-semibold text-background">A</AvatarFallback>
        </Avatar>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar className="size-7 shrink-0 bg-[#5b8cff]">
        <AvatarFallback className="bg-[#5b8cff] text-white"><Sparkles className="size-3.5" /></AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[12px] font-semibold text-indigo-700">Strategist</div>
        {(m.thinkingSteps && m.thinkingSteps.length > 0) || m.isProcessing ? (
          <AgentTrace steps={m.thinkingSteps || []} processing={!!m.isProcessing} />
        ) : null}
        {m.content ? <Bubble text={m.content} /> : null}
      </div>
    </div>
  );
}

