// Lightweight, Edge-safe route gate. We deliberately do NOT call
// supabase.auth.getUser() here: that makes a network round-trip to the Supabase
// auth server on every request, and @supabase/supabase-js isn't Edge-runtime
// clean (it touches process.version), which made the middleware hang on Vercel
// (MIDDLEWARE_INVOCATION_TIMEOUT). Instead we just check for the presence of a
// Supabase auth cookie. The real, validated user check still happens downstream
// in app/page.tsx (Node runtime) and in the browser client — so an invalid or
// expired cookie still gets bounced to /login one layer deeper.
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // If Supabase isn't configured on this deploy (env vars absent — e.g. local dev
  // or an unconfigured host), don't gate: redirecting every route to a /login that
  // can't authenticate would lock the app out entirely. Degrade to "no gate", the
  // same stance as AuthButton and app/page.tsx. Production (env present) gates normally.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  const path = request.nextUrl.pathname;
  // /login and /auth/* (the OAuth callback) must stay reachable when signed out.
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  // Supabase stores the session as `sb-<project-ref>-auth-token` (sometimes
  // chunked into .0/.1). Presence is enough for the gate — no network call.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  if (!hasAuthCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
