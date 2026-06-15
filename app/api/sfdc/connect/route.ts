import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, challengeFromVerifier, randomVerifier, sfdcConfigured } from "@/lib/sfdc/server";

export const dynamic = "force-dynamic";

// Kicks off the Salesforce OAuth web-server flow: verifies the MASE session,
// mints a CSRF `state`, and redirects the browser to Salesforce's authorize URL.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!sfdcConfigured()) {
    return NextResponse.redirect(`${origin}/?sfdc=unconfigured`);
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(`${origin}/login`);
  }
  const state = crypto.randomUUID();
  const verifier = randomVerifier();
  const challenge = await challengeFromVerifier(verifier);
  const res = NextResponse.redirect(authorizeUrl(origin, state, challenge));
  const cookie = { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax" as const, path: "/", maxAge: 600 };
  res.cookies.set("sfdc_state", state, cookie);
  res.cookies.set("sfdc_verifier", verifier, cookie);
  return res;
}
