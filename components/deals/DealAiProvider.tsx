"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// App-wide provider for the deal AI experience: the conversation dock + the deal
// chat panel live here (rendered once), so the universal navbar's "Ask AI" button,
// the Espresso ✦ AI buttons, and the deal page all drive the SAME panel/dock from
// any page. The floating dock button is hidden (showButton=false) — the navbar opens it.
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/ui/Monogram";
import DealChatsDock, { type OpenConvo } from "./DealChatsDock";
import DealAgentPanel, { type DealForAgent } from "./DealAgentPanel";

interface PanelState { convoKey?: string; deal: DealForAgent; initialMessages?: any[]; resumeChatId?: string; seed?: string; loading?: boolean }

// Instant-open shell shown while openDeal looks up the deal's saved conversation —
// same geometry as DealAgentPanel so the swap-in doesn't jump. Keeps the click snappy:
// the panel appears on the SAME frame as the click; history streams in when ready.
function PanelLoading({ deal, onClose }: { deal: DealForAgent; onClose: () => void }) {
  return (
    <div className="mase-chat-root fixed right-0 top-0 bottom-0 z-[100] flex w-full max-w-[640px] flex-col border-l border-border bg-background shadow-2xl" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Monogram name={deal.accountName} kind="account" size={28} className="ml-1 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-foreground">{deal.accountName}</div>
            <div className="truncate text-[11px] text-muted-foreground">{deal.oppName || "Deal AI"}</div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <div className="text-[12.5px]">Opening this deal&rsquo;s conversation…</div>
      </div>
    </div>
  );
}

interface DealAiCtx {
  // ✦ AI on a deal. seed: undefined → default to-do scan; "" → blank chat; else that prompt.
  openNewDeal: (deal: DealForAgent, seed?: string) => void;
  // "Ask Mase" on a deal: RESUME the deal's most-recent saved chat (or start a fresh
  // one if it has none). The panel's own "New chat" button starts a fresh one.
  openDeal: (deal: DealForAgent) => void;
  openDock: () => void; // open the user's deal conversation list
}

const Ctx = createContext<DealAiCtx | null>(null);

export function useDealAi(): DealAiCtx {
  return useContext(Ctx) || { openNewDeal: () => {}, openDeal: () => {}, openDock: () => {} };
}

export function DealAiProvider({ children }: { children: React.ReactNode }) {
  const supabaseRef = useRef(createClient());
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const openNewDeal = useCallback((deal: DealForAgent, seed?: string) => setPanel({ deal, seed }), []);
  const openDock = useCallback(() => setDockOpen(true), []);
  const openExisting: OpenConvo = useCallback(
    (convoKey, deal, initialMessages, resumeChatId) => setPanel({ convoKey, deal, initialMessages, resumeChatId }),
    [],
  );
  // Deal-drawer "Ask Mase": reopen the MOST-RECENT saved conversation for this
  // opportunity (mase_chats "[deal:<oid>]…" rows, RLS-scoped to the user) so the rep
  // continues where they left off, instead of a new blank chat every time. Falls back
  // to a fresh chat when the deal has no prior conversation. Resuming passes the row id
  // as convoKey, so the panel appends to that same mase_chats row (see keyRef/persist).
  // Open INSTANTLY (loading shell on the click frame), then swap in the history.
  // The token guards the async continuation: if the user closed the panel or clicked
  // a different deal while the query was in flight, the stale result is dropped —
  // a slow lookup can never reopen a dismissed panel or clobber a newer one.
  const openReqRef = useRef(0);
  const openDeal = useCallback(async (deal: DealForAgent) => {
    const token = ++openReqRef.current;
    setPanel({ deal, loading: true });
    let next: PanelState = { deal, seed: "" }; // fresh-chat fallback
    try {
      const { data } = await supabaseRef.current
        .from("mase_chats")
        .select("id,messages,updated_at")
        .like("title", `[deal:${deal.oid}]%`)
        .order("updated_at", { ascending: false })
        .limit(1);
      const row = data?.[0];
      if (row?.id) {
        const msgs = Array.isArray(row.messages) ? row.messages : [];
        next = { convoKey: row.id, deal, initialMessages: msgs };
      }
    } catch { /* fall through to a fresh chat */ }
    if (openReqRef.current !== token) return; // closed or superseded while loading
    setPanel((cur) => (cur && cur.loading && cur.deal.oid === deal.oid ? next : cur));
  }, []);

  return (
    <Ctx.Provider value={{ openNewDeal, openDeal, openDock }}>
      {children}
      <DealChatsDock onOpen={openExisting} open={dockOpen} onOpenChange={setDockOpen} showButton={false} />
      {panel && panel.loading ? (
        <PanelLoading deal={panel.deal} onClose={() => setPanel(null)} />
      ) : panel ? (
        <DealAgentPanel
          key={panel.convoKey || `new-${panel.deal.oid}-${panel.seed ?? "scan"}`}
          deal={panel.deal}
          convoKey={panel.convoKey}
          initialMessages={panel.initialMessages}
          resumeChatId={panel.resumeChatId}
          seed={panel.seed}
          onNewChat={() => openNewDeal(panel.deal, "")}
          onClose={() => setPanel(null)}
          onBack={() => { setPanel(null); setDockOpen(true); }}
        />
      ) : null}
    </Ctx.Provider>
  );
}
