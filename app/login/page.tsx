"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// When Supabase env vars are absent (local dev / unconfigured host), there is no
// auth provider to sign into — constructing the browser client throws. Degrade to
// opening the app directly instead of crashing on this page.
const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const authError = params.get("error");

  // Not configured -> there's no gate; send the user into the app.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) router.replace("/deals");
  }, [router]);

  async function signIn() {
    if (!SUPABASE_CONFIGURED) {
      router.replace("/deals");
      return;
    }
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "openid profile email",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErr(error.message);
      setLoading(false);
    }
    // On success the browser is redirected to Microsoft — nothing else to do.
  }

  if (!SUPABASE_CONFIGURED) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <p style={styles.sub}>Auth not configured on this environment — opening the app…</p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mase-logo.svg" alt="MASE" style={styles.logo} />
        <h1 style={styles.title}>Deal Intelligence Engine</h1>
        <p style={styles.sub}>Sign in with your Zycus account to continue.</p>

        {(authError || err) && (
          <div style={styles.error}>
            {err || "Sign-in failed. Please try again."}
          </div>
        )}

        <button onClick={signIn} disabled={loading} style={styles.button}>
          <MicrosoftIcon />
          {loading ? "Redirecting…" : "Sign in with Microsoft"}
        </button>

        <p style={styles.note}>Access is restricted to authorized Zycus users.</p>
      </div>
    </main>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0b0e14",
    padding: 24,
  },
  card: {
    width: "min(400px, 100%)",
    background: "#141925",
    border: "1px solid #273042",
    borderRadius: 16,
    padding: "36px 32px 28px",
    boxShadow: "0 1px 3px rgba(0,0,0,.4), 0 10px 30px -12px rgba(0,0,0,.6)",
    textAlign: "center",
  },
  logo: { height: 34, width: "auto", marginBottom: 18 },
  title: { fontSize: 19, fontWeight: 700, color: "#e7ecf4", margin: "0 0 6px", letterSpacing: "-.2px" },
  sub: { fontSize: 13.5, color: "#aeb8cc", margin: "0 0 22px", lineHeight: 1.5 },
  error: {
    background: "#2a1414",
    color: "#fca5a5",
    border: "1px solid transparent",
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 12.5,
    marginBottom: 16,
  },
  button: {
    width: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    background: "#5b8cff",
    color: "#fff",
    border: 0,
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 650,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(0,0,0,.4)",
  },
  note: { fontSize: 12, color: "#7a8699", margin: "18px 0 0" },
};
