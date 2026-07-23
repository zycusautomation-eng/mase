"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// /chat — the strategist chat page, REBUILT (2026-07-23) as a thin composition over
// the SAME DealAgentPanel the deal drawer / Espresso side panel uses (one component,
// one send/stream/persist/resume pipeline). What this buys, verbatim from the ask:
//   * attachments (paste a screenshot / upload files) — inherited from the panel;
//   * one chat experience everywhere — same components, same logic;
//   * background-safe runs — the panel persists the live chat_id on the in-flight
//     assistant turn (mase_chats) and registers it in dealAiBus, so switching
//     conversations (or leaving the page) never loses a run: the backend keeps
//     writing chat_messages, and reopening the conversation re-attaches and
//     reconciles the full trace. That machinery replaces the old page's
//     lose-the-run-on-switch behaviour.
// Conversations remain PER USER (public.mase_chats, RLS scoped to auth.uid()), so
// the list below only ever shows the signed-in user's chats. The old page's extras
// (persona tabs, inline prompt editor, command palette) were deliberately dropped in
// the unification — prompt editing lives in Admin → Agent Control; the panel carries
// the spend-cap notice, dictation, MCQ cards, and document downloads.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { getRunning, subscribe, type RunningTask } from "@/lib/engine/dealAiBus";
import { Monogram } from "@/components/ui/Monogram";
import DealAgentPanel, { type DealForAgent } from "@/components/deals/DealAgentPanel";

const TITLE_RE = /^\[deal:([^\]]+)\]\s*(.*)$/;

interface Convo {
  id: string;
  kind: "deal" | "chat";
  oid: string;
  title: string;
  snippet: string;
  updatedAt: string;
  messages: any[];
}

function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

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
  return <ChatWorkspace />;
}

function ChatWorkspace() {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const router = useRouter();
  const params = useParams<{ id?: string | string[] }>();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  // Hermetic scoping (unchanged from the old page): a locked user's strategist may
  // only ever see their own deals — always send their scoped opp ids so the backend
  // can never answer over deals outside their scope. Unlocked → whole book.
  const { records: allRecords, scoped: scopedRecords, locked } = useDashboard();
  const genericScopeIds = useMemo(() => {
    if (!locked) return undefined;
    const ids = (scopedRecords.length ? scopedRecords : allRecords)
      .map((r: any) => String(r.opp_id || r?.hard?.opp_id || "")).filter(Boolean);
    return ids.length ? ids : undefined;
  }, [locked, scopedRecords, allRecords]);

  const [convos, setConvos] = useState<Convo[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [running, setRunningState] = useState<RunningTask[]>([]);
  useEffect(() => {
    setRunningState(getRunning());
    return subscribe(() => setRunningState(getRunning()));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("mase_chats")
      .select("id,title,messages,updated_at")
      .order("updated_at", { ascending: false })
      .limit(150);
    const list: Convo[] = (data || []).map((r: any) => {
      const mm = TITLE_RE.exec(r.title || "");
      const msgs = Array.isArray(r.messages) ? r.messages : [];
      const last = [...msgs].reverse().find((x: any) => x && x.content);
      return {
        id: r.id,
        kind: (mm ? "deal" : "chat") as "deal" | "chat",
        oid: mm?.[1] || "",
        title: (mm?.[2] || r.title || "Untitled chat").trim(),
        snippet: String(last?.content || "").replace(/\s+/g, " ").slice(0, 80),
        updatedAt: r.updated_at,
        messages: msgs,
      };
    });
    setConvos(list);
    setListLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  // Refresh the list whenever a run starts/finishes (it just persisted).
  useEffect(() => { void load(); }, [running.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The active conversation. `nonce` remounts the panel for "New chat".
  const [nonce, setNonce] = useState(0);
  const active = useMemo(() => convos.find((c) => c.id === urlId) || null, [convos, urlId]);
  const runningByKey = useMemo(() => new Map(running.map((r) => [r.convoKey, r])), [running]);

  const openConvo = useCallback((c: Convo) => {
    router.push(`/chat/${c.id}`);
  }, [router]);
  const newChat = useCallback(() => {
    setNonce((n) => n + 1);
    router.push("/chat");
  }, [router]);

  const deleteConvo = useCallback(async (c: Convo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${c.title}"?`)) return;
    await supabase.from("mase_chats").delete().eq("id", c.id);
    if (urlId === c.id) router.push("/chat");
    void load();
  }, [supabase, urlId, router, load]);

  // Deal context for a reopened deal-tagged conversation (oid + account from the
  // title marker — enough for the panel to scope the send to that opportunity).
  const activeDeal: DealForAgent | null = active && active.kind === "deal" && active.oid
    ? { oid: active.oid, accountName: active.title || active.oid }
    : null;

  return (
    // The chat layout wraps this page in a 100vh, headerless shell — fill it.
    <div className="mase-chat-root flex h-full min-h-0">
      {/* ── Conversations rail ── */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageSquare className="h-4 w-4" /> Conversations
          </div>
          <button
            type="button"
            onClick={newChat}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#5277F0] transition hover:bg-[#5277F0]/10"
          >
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : convos.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No conversations yet — start one.</div>
          ) : (
            convos.map((c) => {
              const live = runningByKey.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => openConvo(c)}
                  className={cn(
                    "group flex w-full items-start gap-2.5 border-b border-border/60 px-3.5 py-2.5 text-left transition hover:bg-muted/60",
                    urlId === c.id && "bg-muted/70",
                  )}
                >
                  {c.kind === "deal" ? (
                    <span className="relative mt-0.5 shrink-0">
                      <Monogram name={c.title} kind="account" size={30} />
                      {live ? <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background bg-[#5b8cff]"><Loader2 className="h-2 w-2 animate-spin text-white" /></span> : null}
                    </span>
                  ) : (
                    <span className="relative mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6E8BFF] to-[#5277F0] text-white">
                      <Sparkles className="h-3.5 w-3.5" />
                      {live ? <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background bg-[#5b8cff]"><Loader2 className="h-2 w-2 animate-spin text-white" /></span> : null}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{c.title}</span>
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">{relTime(c.updatedAt)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                      {live ? <span className="font-medium text-[#5b8cff]">● working… </span> : null}
                      {c.snippet || "—"}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => void deleteConvo(c, e)}
                    title="Delete conversation"
                    className="mt-1 hidden shrink-0 rounded p-1 text-muted-foreground transition hover:text-destructive group-hover:block"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── The chat itself: the SAME component the side panel uses ── */}
      <main className="min-w-0 flex-1">
        <DealAgentPanel
          key={active ? active.id : `new-${nonce}`}
          variant="page"
          deal={activeDeal}
          convoKey={active?.id}
          initialMessages={active?.messages as any}
          resumeChatId={active ? runningByKey.get(active.id)?.streamChatId : undefined}
          genericScopeIds={genericScopeIds}
          onNewChat={newChat}
        />
      </main>
    </div>
  );
}
