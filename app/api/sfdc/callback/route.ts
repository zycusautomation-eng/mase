import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, fetchIdentity, saveConnection } from "@/lib/sfdc/server";

export const dynamic = "force-dynamic";

// Salesforce redirects here with ?code & ?state. We verify state (CSRF), swap the
// code for tokens, read the rep's SF identity, store it keyed by the Supabase
// user, and bounce back into the app.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");

  const back = (status: string) => {
    const res = NextResponse.redirect(`${origin}/?sfdc=${status}`);
    res.cookies.set("sfdc_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("sfdc_verifier", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (oauthErr) return back("denied");
  if (!code) return back("error");

  const cookieState = req.cookies.get("sfdc_state")?.value;
  if (!state || !cookieState || state !== cookieState) return back("badstate");

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return NextResponse.redirect(`${origin}/login`);

    const verifier = req.cookies.get("sfdc_verifier")?.value;
    const tok = await exchangeCode(origin, code, verifier);
    const ident = await fetchIdentity(tok.id, tok.access_token);

    await saveConnection({
      user_id: data.user.id,
      email: data.user.email ?? null,
      sf_user_id: ident.user_id,
      sf_username: ident.username,
      sf_display_name: ident.display_name,
      instance_url: tok.instance_url,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      scope: tok.scope ?? null,
    });
    return back("connected");
  } catch (e) {
    console.error("[sfdc/callback]", e);
    return back("error");
  }
}
