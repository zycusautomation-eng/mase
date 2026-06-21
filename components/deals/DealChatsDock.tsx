"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Global, always-available message dock for Espresso — a LinkedIn-style messaging
// icon (top-right) that opens the list of deal AI conversations. The list shows every
// persisted deal conversation (mase_chats, "[deal:…]" rows) most-recent first; click to
// reopen (loads saved history). Conversations currently running show a live "working…"
// dot inline.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X, Loader2, Sparkles, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { getRunning, subscribe, type RunningTask } from "@/lib/engine/dealAiBus";
import { Monogram } from "@/components/ui/Monogram";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useDealAi } from "./DealAiProvider";
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
  const { records } = useDashboard();
  const { openNewDeal } = useDealAi();
  const [convos, setConvos] = useState<DealConvo[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunningState] = useState<RunningTask[]>([]);
  // "+ New chat" deal picker: a search box over the whole book; picking a deal
  // starts an EMPTY deal chat (openNewDeal(deal, "") → "Complete tasks with AI" welcome).
  const [picking, setPicking] = useState(false);
  const [dealQuery, setDealQuery] = useState("");

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
  const shown = merged;

  const handleOpen = (c: DealConvo) => {
    onOpenChange(false);
    if (c.kind === "chat") { router.push(`/chat/${c.id}`); return; } // strategist chat → /chat
    const run = runningByKey.get(c.id);
    onOpen(c.id, { oid: c.oid, accountName: c.accountName }, c.messages, run?.streamChatId);
  };

  // Deal search for "+ New chat": filter the book by account / opp name. Capped so
  // the list stays light even when the query is empty (shows the first slice).
  const dealResults = useMemo(() => {
    const q = dealQuery.trim().toLowerCase();
    const out: { oid: string; accountName: string; oppName?: string; ownerName?: string }[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      const h = (r as any).hard || {};
      const oid = String((r as any).opp_id || h.opp_id || "");
      if (!oid || seen.has(oid)) continue;
      const accountName = String(h.account_name || "").trim();
      const oppName = String(h.opp_name || "").trim();
      const ownerName = String(h.owner_name || "").trim();
      if (q && !`${accountName} ${oppName} ${ownerName}`.toLowerCase().includes(q)) continue;
      seen.add(oid);
      out.push({ oid, accountName: accountName || oppName || oid, oppName, ownerName });
      if (out.length >= 60) break;
    }
    return out;
  }, [records, dealQuery]);

  const startDealChat = (d: { oid: string; accountName: string; oppName?: string; ownerName?: string }) => {
    setPicking(false);
    setDealQuery("");
    onOpenChange(false);
    // Empty-string seed → blank deal chat with the "Complete tasks with AI" welcome.
    openNewDeal({ oid: d.oid, accountName: d.accountName, oppName: d.oppName, ownerName: d.ownerName }, "");
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
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setPicking((p) => !p); setDealQuery(""); }}
                  title="New chat"
                  aria-label="New chat"
                  aria-expanded={picking}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition",
                    picking ? "bg-[#5277F0] text-white" : "text-[#5277F0] hover:bg-[#5277F0]/10",
                  )}
                >
                  <Plus className="h-4 w-4" /> New chat
                </button>
                <button type="button" onClick={() => onOpenChange(false)} className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {picking ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 focus-within:border-[#5277F0] focus-within:ring-1 focus-within:ring-[#5277F0]">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={dealQuery}
                      onChange={(e) => setDealQuery(e.target.value)}
                      placeholder="Search deals by account or opportunity…"
                      className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    {dealQuery ? (
                      <button type="button" onClick={() => setDealQuery("")} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {dealResults.length === 0 ? (
                    <Empty text="No matching deals." />
                  ) : (
                    dealResults.map((d) => (
                      <button
                        key={d.oid}
                        onClick={() => startDealChat(d)}
                        className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left transition hover:bg-muted/60"
                      >
                        <Monogram name={d.accountName} kind="account" size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{d.accountName}</span>
                          {d.oppName ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{d.oppName}</span> : null}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && convos.length === 0 ? (
                <Empty text="Loading…" />
              ) : shown.length === 0 ? (
                <Empty text="No deal conversations yet. Open a deal and hit ✦ AI." />
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
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{text}</div>;
}
