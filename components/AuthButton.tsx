"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Shows the signed-in user and a sign-out button in the dashboard header.
export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail((u?.user_metadata?.name as string) || u?.email || null);
    });
  }, []);

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
