// Server-only helpers for personal "Favourites" (starred deals).
//
// Storage: one row per user in the EXISTING public.app_config key/value table
// (key "user_favs:<email>", value = JSON string[] of opp_ids) — same trick the
// sweep-lists feature uses to avoid a dedicated table / migration (the app has no
// DDL access). Only the service-role client here touches the table; the route
// handler resolves the caller from their Supabase session, so each user can only
// read/write their OWN row. Personal bookmarks → any logged-in user, not admin-only.
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSSRClient } from "@/lib/supabase/server";

const PREFIX = "user_favs:";

let _svc: SupabaseClient | null = null;
function svc(): SupabaseClient {
  if (!_svc) {
    _svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _svc;
}

// Caller's email from the Supabase session (getUser first; fall back to the signed
// session JWT — the edge middleware doesn't refresh, so a valid-but-stale token
// would otherwise read as logged-out). Lower-cased; null when not signed in. No
// admin gate: favourites are personal to whoever is logged in.
export async function callerEmail(): Promise<string | null> {
  try {
    const supabase = await createSSRClient();
    const { data: u } = await supabase.auth.getUser();
    let email = u?.user?.email ?? null;
    if (!email) {
      const { data: s } = await supabase.auth.getSession();
      email = s?.session?.user?.email ?? null;
    }
    return email ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

function normIds(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

export async function getFavs(email: string): Promise<string[]> {
  const { data, error } = await svc().from("app_config")
    .select("value").eq("key", PREFIX + email).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return [];
  try {
    return normIds(JSON.parse(data.value));
  } catch {
    return [];
  }
}

// Replace the caller's whole favourites set (the client always sends the full list —
// the set is tiny). Upsert into the single per-user row. NB: app_config.updated_by
// is a uuid FK to auth.users, so we never set it — only key + value.
export async function setFavs(email: string, oppIds: string[]): Promise<string[]> {
  const ids = normIds(oppIds);
  const key = PREFIX + email;
  const { data: existing, error: selErr } = await svc().from("app_config")
    .select("key").eq("key", key).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  const value = JSON.stringify(ids);
  if (existing) {
    const { error } = await svc().from("app_config").update({ value }).eq("key", key);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await svc().from("app_config").insert({ key, value });
    if (error) throw new Error(error.message);
  }
  return ids;
}
