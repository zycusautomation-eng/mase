"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Whether Supabase is configured on this deploy. When the env vars are missing
// (local dev or an unconfigured host), constructing the browser client throws —
// so we degrade to "no auth UI" rather than white-screening the whole app.
// Mirrors the middleware's own "misconfig => no gate, not a 500" stance.
const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// User-icon menu in the dashboard header. The avatar button opens a dropdown
// showing the signed-in identity and a sign-out action.
export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail((u?.user_metadata?.name as string) || u?.email || null);
    }).catch(() => {});
  }, []);

  // Close the dropdown on an outside click or the Escape key.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Not configured -> render nothing (no crash, no auth controls).
  if (!SUPABASE_CONFIGURED) return null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="authmenu" ref={ref}>
      <button
        type="button"
        className="authmenu-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={email ? `Account: ${email}` : "Account"}
        title={email || "Account"}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 19.2c0-3.4 3.2-5.6 7-5.6s7 2.2 7 5.6c0 .6-.5 1-1.1 1H6.1c-.6 0-1.1-.4-1.1-1Z" />
        </svg>
      </button>
      {open && (
        <div className="authmenu-pop" role="menu">
          <div className="authmenu-id">
            <div className="authmenu-id-label">Signed in as</div>
            <div className="authmenu-id-email" title={email || ""}>
              {email || "Unknown user"}
            </div>
          </div>
          <div className="authmenu-sep" />
          <button
            type="button"
            className="authmenu-signout"
            role="menuitem"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
