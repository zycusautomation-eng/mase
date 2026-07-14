"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useSfdc } from "@/components/sfdc/SfdcProvider";
import { EMAIL_TO_OWNER, resolveAccess } from "@/lib/engine/helpers";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

// Whether Supabase is configured on this deploy. When the env vars are missing
// (local dev or an unconfigured host), constructing the browser client throws —
// so we degrade to "no auth UI" rather than white-screening the whole app.
const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Synthetic email used to preview the "blocked / non-member" view.
const BLOCKED_PREVIEW = "preview.nonmember@example.com";
type SimOpt = { email: string; name: string; role: "VP" | "Rep" };

// User-icon menu in the dashboard header. Opens a dropdown with the signed-in
// identity, an admin-only "Simulate view" control (impersonate any rep/VP to
// preview exactly what they see), and sign-out.
export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { realIsAdmin, simEmail, simulateAs, scopeName, blocked } = useDashboard();
  const sf = useSfdc();

  // Allow-listed users to simulate, grouped VP-first then rep, A→Z (ported from
  // the old top SimulateBar).
  const simOpts = useMemo<SimOpt[]>(() => {
    return Object.entries(EMAIL_TO_OWNER)
      .map(([e, name]) => {
        const a = resolveAccess(e) as { kind: string; vps?: string[] };
        const role: "VP" | "Rep" = a.kind === "scoped" && (a.vps?.length ?? 0) > 0 ? "VP" : "Rep";
        return { email: e, name: name as string, role };
      })
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "VP" ? -1 : 1));
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail((u?.user_metadata?.name as string) || u?.email || null);
    }).catch(() => {});
  }, []);

  // Outside-click + Escape close are handled by the Popover (Radix) below.

  if (!SUPABASE_CONFIGURED) return null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const simulating = simEmail != null;
  const selectValue = simEmail === BLOCKED_PREVIEW ? "__blocked__" : simEmail ?? "";
  function onSimChange(v: string) {
    if (v === "") simulateAs(null);
    else if (v === "__blocked__") simulateAs(BLOCKED_PREVIEW);
    else simulateAs(v);
  }
  const simStatus = !simulating
    ? null
    : blocked
      ? "a non-member — no access"
      : `${scopeName ?? simEmail}${simOpts.find((o) => o.email === simEmail)?.role === "VP" ? " — whole team" : " — own deals"}`;

  return (
    <div className="authmenu">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`authmenu-avatar ${simulating ? "simulating" : ""}`}
            aria-label={email ? `Account: ${email}` : "Account"}
            title={simulating ? `Simulating ${scopeName ?? simEmail}` : (email || "Account")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="8" r="3.6" />
              <path d="M5 19.2c0-3.4 3.2-5.6 7-5.6s7 2.2 7 5.6c0 .6-.5 1-1.1 1H6.1c-.6 0-1.1-.4-1.1-1Z" />
            </svg>
            {simulating && <span className="authmenu-simdot" aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        {/* Portaled to <body> (escapes the sidebar's fixed/z-index:40 stacking context that
            trapped the old absolute menu) and collision-aware: side="top" opens it UPWARD from
            the bottom-of-sidebar avatar, auto-flipping/shifting to stay on screen. z-[70] sits
            above the sidebar + main content. The .authmenu-* content classes are unchanged. */}
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="authmenu-pop-content z-[70] w-[272px] rounded-xl border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_16px_40px_-8px_rgba(15,23,42,.28)]"
          role="menu"
        >
          <div className="authmenu-id">
            <div className="authmenu-id-label">Signed in as</div>
            <div className="authmenu-id-email" title={email || ""}>
              {email || "Unknown user"}
            </div>
          </div>

          {realIsAdmin && (
            <>
              <div className="authmenu-sep" />
              <div className="authmenu-sim">
                <div className="authmenu-id-label">
                  Simulate view
                  {simulating && <span className="authmenu-sim-on">ON</span>}
                </div>
                <select
                  className="authmenu-sim-select"
                  value={selectValue}
                  onChange={(e) => onSimChange(e.target.value)}
                >
                  <option value="">Your view (admin · whole book)</option>
                  <optgroup label="VPs">
                    {simOpts.filter((o) => o.role === "VP").map((o) => (
                      <option key={o.email} value={o.email}>{o.name} — VP</option>
                    ))}
                  </optgroup>
                  <optgroup label="Reps">
                    {simOpts.filter((o) => o.role === "Rep").map((o) => (
                      <option key={o.email} value={o.email}>{o.name}</option>
                    ))}
                  </optgroup>
                  <option value="__blocked__">A non-member (blocked / no access)</option>
                </select>
                {simulating && (
                  <>
                    <div className="authmenu-sim-status">
                      Viewing as <b>{simStatus}</b>. Exactly what they see.
                    </div>
                    <button type="button" className="authmenu-sim-exit" onClick={() => simulateAs(null)}>
                      Exit simulation
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {sf.configured && (
            <>
              <div className="authmenu-sep" />
              <div className="authmenu-sf">
                <div className="authmenu-id-label">Salesforce</div>
                {sf.connected ? (
                  <>
                    <div className="authmenu-sf-on">
                      <span className="authmenu-sf-dot" aria-hidden /> Connected
                      <span className="authmenu-sf-user" title={sf.username || ""}>{sf.displayName || sf.username}</span>
                    </div>
                    <button type="button" className="authmenu-sf-btn disc" onClick={() => sf.disconnect()}>Disconnect</button>
                  </>
                ) : (
                  <>
                    <div className="authmenu-sf-off">Not connected — to-dos push under a shared account.</div>
                    <button type="button" className="authmenu-sf-btn conn" onClick={() => sf.connect()}>Connect Salesforce</button>
                  </>
                )}
              </div>
            </>
          )}

          <div className="authmenu-sep" />
          <button type="button" className="authmenu-signout" role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
