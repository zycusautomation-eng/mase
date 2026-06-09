// Session refresh + route gate, run from the root middleware on every request.
// Refreshes the Supabase auth token (keeps the cookie alive) and redirects any
// unauthenticated request for a protected route to /login.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured (e.g. env vars missing on the host), don't
  // crash every route — let the request through. The gate is only as strong as
  // the deploy's config; a misconfig should degrade to "no gate", not a 500.
  if (!url || !key) {
    console.warn("[auth] Supabase env vars missing — auth gate disabled.");
    return supabaseResponse;
  }

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser() — it
  // could cause hard-to-debug session-refresh issues.
  // getUser() makes a network call to Supabase. If Supabase is slow or down
  // (e.g. a paused free-tier project), an un-bounded await HANGS the middleware
  // until Vercel kills it -> 504 MIDDLEWARE_INVOCATION_TIMEOUT site-wide. Race it
  // against a short timeout so the middleware always returns fast.
  let user = null;
  let authReachable = true;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("auth-timeout")), 2500),
    );
    const { data } = (await Promise.race([supabase.auth.getUser(), timeout])) as Awaited<
      ReturnType<typeof supabase.auth.getUser>
    >;
    user = data.user;
  } catch (e) {
    // Supabase unreachable/slow (timeout or network error). Do NOT 504, and do NOT
    // trap everyone at a /login that also can't reach the provider: degrade to
    // "no gate" for this request (same stance as missing env). The deployment's
    // platform protection still applies; the gate resumes the moment Supabase is back.
    authReachable = false;
    console.warn("[auth] getUser failed/timeout — letting request through:",
      e instanceof Error ? e.message : e);
  }

  const path = request.nextUrl.pathname;
  // Anything under /login or /auth (the OAuth callback) is public.
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  if (authReachable && !user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Must return supabaseResponse as-is so the refreshed auth cookies survive.
  return supabaseResponse;
}
