"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// App-wide provider for the deal AI experience: the conversation dock + the deal
// chat panel live here (rendered once), so the universal navbar's "Ask AI" button,
// the Espresso ✦ AI buttons, and the deal page all drive the SAME panel/dock from
// any page. The floating dock button is hidden (showButton=false) — the navbar opens it.
import React, { createContext, useCallback, useContext, useState } from "react";
import DealChatsDock, { type OpenConvo } from "./DealChatsDock";
import DealAgentPanel, { type DealForAgent } from "./DealAgentPanel";

interface PanelState { convoKey?: string; deal: DealForAgent; initialMessages?: any[]; resumeChatId?: string; seed?: string }

interface DealAiCtx {
  // ✦ AI on a deal. seed: undefined → default to-do scan; "" → blank chat; else that prompt.
  openNewDeal: (deal: DealForAgent, seed?: string) => void;
  openDock: () => void; // open the user's deal conversation list
}

const Ctx = createContext<DealAiCtx | null>(null);

export function useDealAi(): DealAiCtx {
  return useContext(Ctx) || { openNewDeal: () => {}, openDock: () => {} };
}

export function DealAiProvider({ children }: { children: React.ReactNode }) {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const openNewDeal = useCallback((deal: DealForAgent, seed?: string) => setPanel({ deal, seed }), []);
  const openDock = useCallback(() => setDockOpen(true), []);
  const openExisting: OpenConvo = useCallback(
    (convoKey, deal, initialMessages, resumeChatId) => setPanel({ convoKey, deal, initialMessages, resumeChatId }),
    [],
  );

  return (
    <Ctx.Provider value={{ openNewDeal, openDock }}>
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
          onClose={() => setPanel(null)}
          onBack={() => { setPanel(null); setDockOpen(true); }}
        />
      ) : null}
    </Ctx.Provider>
  );
}
