"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Salesforce connection status, shared by the login gate modal and the user
// dropdown. Tokens never come here — only safe status (connected + username).
interface SfdcStatus {
  configured: boolean;   // is the Connected/External app wired (client id/secret present)
  authed: boolean;       // is there a MASE session
  connected: boolean;    // has this user linked their Salesforce
  username: string | null;
  displayName: string | null;
  loading: boolean;
  refresh: () => void;
  connect: () => void;
  disconnect: () => Promise<void>;
}
const Ctx = createContext<SfdcStatus | null>(null);

export function useSfdc(): SfdcStatus {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSfdc must be used inside <SfdcProvider>");
  return c;
}

export function SfdcProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState({ configured: false, authed: false, connected: false, username: null as string | null, displayName: null as string | null, loading: true });
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/sfdc/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setS({
        configured: !!j.configured, authed: !!j.authed, connected: !!j.connected,
        username: j.sf_username ?? null, displayName: j.sf_display_name ?? null, loading: false,
      }))
      .catch(() => setS((p) => ({ ...p, loading: false })));
  }, []);

  // On mount: load status. If we just came back from the OAuth round-trip
  // (?sfdc=connected|denied|error), re-check and clean the URL.
  useEffect(() => {
    refresh();
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get("sfdc");
      if (r) { u.searchParams.delete("sfdc"); window.history.replaceState({}, "", u.toString()); if (r === "connected") setTimeout(refresh, 300); }
    } catch { /* ignore */ }
  }, [refresh]);

  const connect = useCallback(() => { window.location.href = "/api/sfdc/connect"; }, []);
  const disconnect = useCallback(async () => {
    await fetch("/api/sfdc/disconnect", { method: "POST" }).catch(() => {});
    refresh();
  }, [refresh]);

  const value = useMemo<SfdcStatus>(() => ({ ...s, refresh, connect, disconnect }), [s, refresh, connect, disconnect]);

  // Gate modal: only when the app is configured, the user is signed in, and
  // they haven't linked SF yet. While client id/secret are absent (configured
  // === false) the modal never shows — so nobody is locked out pre-setup.
  const showGate = s.configured && s.authed && !s.connected && !s.loading && !dismissed;

  return (
    <Ctx.Provider value={value}>
      {children}
      {showGate ? (
        <div className="sfgate-overlay">
          <div className="sfgate-card" role="dialog" aria-modal="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/salesforce.svg" alt="" width={44} height={44} className="sfgate-logo" />
            <div className="sfgate-h">Connect your Salesforce</div>
            <div className="sfgate-p">
              MASE pushes your to-dos to Salesforce <b>as you</b>, so completed tasks land in your name — not a shared account. Connect once to continue.
            </div>
            <button className="sfgate-btn" onClick={connect}>Connect to Salesforce</button>
            <button className="sfgate-later" onClick={() => setDismissed(true)}>Not now</button>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
