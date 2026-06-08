"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Whether Supabase is configured on this deploy. When the env vars are missing
// (local dev or an unconfigured host), constructing the browser client throws —
// so we degrade to "no auth UI" rather than white-screening the whole app.
// Mirrors the middleware's own "misconfig => no gate, not a 500" stance.
const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Shows the signed-in user and a sign-out button in the dashboard header.
export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail((u?.user_metadata?.name as string) || u?.email || null);
    }).catch(() => {});
  }, []);

  // Not configured -> render nothing (no crash, no auth controls).
  if (!SUPABASE_CONFIGURED) return null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="authbtn">
      {email && <span className="authbtn-user" title={email}>{email}</span>}
      <button className="authbtn-out" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}
