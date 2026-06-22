// OAuth callback. Azure (via Supabase) redirects here with a one-time code;
// we exchange it for a session cookie, then send the user into the app.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Persist the user's Microsoft refresh token so the backend can send/draft/read
// Outlook mail AS this user. `provider_refresh_token` is ONLY present on the
// session right after the OAuth code exchange, so we must capture it here.
// Best-effort: never let a token-store failure block sign-in.
async function captureOutlookToken(session: {
  provider_refresh_token?: string | null;
  user?: { id?: string } | null;
} | null) {
  const rt = session?.provider_refresh_token;
  const userId = session?.user?.id;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rt || !userId || !url || !serviceKey) return;
  try {
    const admin = createAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.from("user_ms_tokens").upsert({
      user_id: userId,
      refresh_token: rt,
      scope: "Mail.ReadWrite Mail.Send offline_access",
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[outlook] failed to store provider refresh token:", e);
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/deals";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await captureOutlookToken(data?.session ?? null);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or the exchange failed — back to login with an error flag.
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
