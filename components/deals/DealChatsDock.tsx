"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Global, always-available message dock for Espresso — a LinkedIn-style messaging
// icon (top-right) that opens the list of deal AI conversations. Two views:
//   • "Chats"   — every persisted deal conversation (mase_chats, "[deal:…]" rows),
//                 most-recent first; click to reopen (loads saved history).
//   • "Running" — deals an agent is actively working right now (in-session
//                 registry); click to reconnect to the live run.
// Conversations currently running show a live "working…" dot in the Chats list too.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { getRunning, subscribe, type RunningTask } from "@/lib/engine/dealAiBus";
import { Monogram } from "@/components/ui/Monogram";
import type { DealForAgent } from "./DealAgentPanel";

interface DealConvo {
  id: string;
  kind: "deal" | "chat";   // deal = "[deal:…]" chat (opens the panel); chat = strategist /chat
  oid: string;
  accountName: string;     // display name (account for deals, title for strategist chats)
  snippet: string;
  updatedAt: string;
  messages: any[];
}

const TITLE_RE = /^\[deal:([^\]]+)\]\s*(.*)$/;

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

export type OpenConvo = (
  convoKey: string,
  deal: DealForAgent,
  initialMessages: any[],
  resumeChatId?: string,
) => void;

export default function DealChatsDock({ onOpen, open, onOpenChange, showButton = true }: { onOpen: OpenConvo; open: boolean; onOpenChange: (open: boolean) => void; showButton?: boolean }) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const router = useRouter();
  const [tab, setTab] = useState<"chats" | "running">("chats");
  const [convos, setConvos] = useState<DealConvo[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunningState] = useState<RunningTask[]>([]);

  useEffect(() => {
    setRunningState(getRunning());
    return subscribe(() => setRunningState(getRunning()));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // ALL of the user's conversations (RLS-scoped) — deal chats AND strategist /chat.
    const { data } = await supabase
      .from("mase_chats")
      .select("id,title,messages,updated_at")
      .order("updated_at", { ascending: false })
      .limit(120);
    const list: DealConvo[] = (data || []).map((r: any) => {
      const mm = TITLE_RE.exec(r.title || "");
      const msgs = Array.isArray(r.messages) ? r.messages : [];
      const last = [...msgs].reverse().find((x: any) => x && x.content);
      return {
        id: r.id,
        kind: (mm ? "deal" : "chat") as "deal" | "chat",
        oid: mm?.[1] || "",
        accountName: (mm?.[2] || r.title || "Untitled chat").trim(),
        snippet: String(last?.content || "").replace(/\s+/g, " ").slice(0, 90),
        updatedAt: r.updated_at,
        messages: msgs,
      };
    });
    setConvos(list);
    setLoading(false);
  }, [supabase]);

  // Load when opened; refresh whenever a run starts/finishes (it just persisted).
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (open) load(); }, [running.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const runningByKey = new Map(running.map((r) => [r.convoKey, r]));
  // Merge: persisted convos + any running task not yet persisted (fresh scan).
  const persistedKeys = new Set(convos.map((c) => c.id));
  const orphanRunning: DealConvo[] = running
    .filter((r) => !persistedKeys.has(r.convoKey))
    .map((r) => ({ id: r.convoKey, kind: "deal" as const, oid: r.oid, accountName: r.accountName, snippet: "Agent working…", updatedAt: new Date(r.startedAt).toISOString(), messages: [] }));
  const merged = [...orphanRunning, ...convos];
  const shown = tab === "running" ? merged.filter((c) => runningByKey.has(c.id)) : merged;

  const handleOpen = (c: DealConvo) => {
    onOpenChange(false);
    if (c.kind === "chat") { router.push(`/chat/${c.id}`); return; } // strategist chat → /chat
    const run = runningByKey.get(c.id);
    onOpen(c.id, { oid: c.oid, accountName: c.accountName }, c.messages, run?.streamChatId);
  };

  return (
    <div className="mase-chat-root">
      {showButton && !open ? (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          title="Deal conversations"
          aria-label="Deal conversations"
          className="fixed bottom-6 right-6 z-[55] flex h-12 w-12 items-center justify-center rounded-full bg-[#5b8cff] text-white shadow-[0_6px_20px_rgba(91,140,255,0.45)] ring-1 ring-black/5 transition hover:brightness-105"
        >
          <MessageSquare className="h-5 w-5" />
          {running.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold leading-none text-[#5b8cff] ring-2 ring-[#5b8cff]">{running.length}</span>
          ) : null}
        </button>
      ) : null}

      {open ? (
        <>
          <div className="fixed inset-0 z-[93]" onClick={() => onOpenChange(false)} />
          <aside className="fixed bottom-0 right-0 top-0 z-[94] flex w-[440px] max-w-[92vw] flex-col border-l border-border bg-background shadow-[0_0_44px_rgba(0,0,0,0.2)]">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <MessageSquare className="h-4 w-4" /> Conversations
              </div>
              <button type="button" onClick={() => onOpenChange(false)} className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex gap-1 border-b border-border px-3 py-2">
              {(["chats", "running"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition",
                    tab === t ? "bg-[#5b8cff] text-white" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t === "chats" ? "Chats" : `Running${running.length ? ` (${running.length})` : ""}`}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "chats" && loading && convos.length === 0 ? (
                <Empty text="Loading…" />
              ) : shown.length === 0 ? (
                <Empty text={tab === "running" ? "No agents running right now." : "No deal conversations yet. Open a deal and hit ✦ AI."} />
              ) : (
                shown.map((c) => {
                  const live = runningByKey.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleOpen(c)}
                      className="flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition hover:bg-muted/60"
                    >
                      {c.kind === "deal" ? (
                        <span className="relative shrink-0">
                          <Monogram name={c.accountName} kind="account" size={36} />
                          {live ? <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-[#5b8cff]"><Loader2 className="h-2.5 w-2.5 animate-spin text-white" /></span> : null}
                        </span>
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><Sparkles className="h-4 w-4" /></span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{c.accountName}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{relTime(c.updatedAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {live ? <span className="font-medium text-[#5b8cff]">● working… </span> : null}
                          {c.snippet || "—"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{text}</div>;
}
