"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// App-wide provider for the deal AI experience: the conversation dock + the deal
// chat panel live here (rendered once), so the universal navbar's "Ask AI" button,
// the Espresso ✦ AI buttons, and the deal page all drive the SAME panel/dock from
// any page. The floating dock button is hidden (showButton=false) — the navbar opens it.
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DealChatsDock, { type OpenConvo } from "./DealChatsDock";
import DealAgentPanel, { type DealForAgent } from "./DealAgentPanel";

interface PanelState { convoKey?: string; deal: DealForAgent; initialMessages?: any[]; resumeChatId?: string; seed?: string }

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
  const openDeal = useCallback(async (deal: DealForAgent) => {
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
        setPanel({ convoKey: row.id, deal, initialMessages: msgs });
        return;
      }
    } catch { /* fall through to a fresh chat */ }
    setPanel({ deal, seed: "" });
  }, []);

  return (
    <Ctx.Provider value={{ openNewDeal, openDeal, openDock }}>
      {children}
      <DealChatsDock onOpen={openExisting} open={dockOpen} onOpenChange={setDockOpen} showButton={false} />
      {panel ? (
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
