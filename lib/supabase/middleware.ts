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
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    // Network/Supabase hiccup — don't 500 the whole site. Treat as signed-out.
    console.warn("[auth] getUser failed:", e instanceof Error ? e.message : e);
  }

  const path = request.nextUrl.pathname;
  // Anything under /login or /auth (the OAuth callback) is public.
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Must return supabaseResponse as-is so the refreshed auth cookies survive.
  return supabaseResponse;
}
