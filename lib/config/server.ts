// Server-only helpers for the RevOps Chat ACCESS policy, stored in the existing
// public.app_config key/value table (same trick favourites + sweep-lists use — the
// app has no DDL access). Two rows:
//   flag:chat_access_mode    -> "admins" | "everyone" | "allowlist"
//   flag:chat_allowed_emails -> JSON string[] of lower-cased emails (allowlist mode)
// Admins can ALWAYS use chat regardless of mode. Reads of the caller's own access are
// open (the nav + /chat guard need them); the full policy (mode + emails) and all
// WRITES are admin-only (enforced by the route handler via callerIsAdmin()).
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";

const MODE_KEY = "flag:chat_access_mode";
const ALLOW_KEY = "flag:chat_allowed_emails";

export type ChatAccessMode = "admins" | "everyone" | "allowlist";
export type ChatAccess = { mode: ChatAccessMode; emails: string[] };

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

async function getRaw(key: string): Promise<string | null> {
  const { data, error } = await svc().from("app_config").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.value) : null;
}

// Upsert. NB: app_config.updated_by is a uuid FK to auth.users — never set it.
async function setRaw(key: string, value: string): Promise<void> {
  const { data: existing, error: selErr } = await svc().from("app_config")
    .select("key").eq("key", key).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) {
    const { error } = await svc().from("app_config").update({ value }).eq("key", key);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await svc().from("app_config").insert({ key, value });
    if (error) throw new Error(error.message);
  }
}

function normEmails(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s).trim().toLowerCase()).filter((s) => s.includes("@")))];
}

export async function getChatAccess(): Promise<ChatAccess> {
  const rawMode = (await getRaw(MODE_KEY)) || "";
  const mode: ChatAccessMode = rawMode === "everyone" || rawMode === "allowlist" ? rawMode : "admins";
  let emails: string[] = [];
  try { emails = normEmails(JSON.parse((await getRaw(ALLOW_KEY)) || "[]")); } catch { emails = []; }
  return { mode, emails };
}

export async function setChatAccess(a: ChatAccess): Promise<ChatAccess> {
  const mode: ChatAccessMode = a.mode === "everyone" || a.mode === "allowlist" ? a.mode : "admins";
  await setRaw(MODE_KEY, mode);
  await setRaw(ALLOW_KEY, JSON.stringify(normEmails(a.emails)));
  return getChatAccess();
}

// Caller's lower-cased email from the Supabase session (getUser, then the signed
// session JWT — the edge middleware doesn't refresh tokens). null when not signed in.
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

export async function callerIsAdmin(): Promise<boolean> {
  const email = await callerEmail();
  return !!email && ADMIN_EMAILS.has(email);
}

// Can the CURRENT session caller use the chat? Admins always; otherwise per the mode.
export async function chatAllowedForCaller(): Promise<boolean> {
  const email = await callerEmail();
  if (!email) return false;
  if (ADMIN_EMAILS.has(email)) return true;
  const { mode, emails } = await getChatAccess();
  if (mode === "everyone") return true;
  if (mode === "allowlist") return emails.includes(email);
  return false; // "admins" — only admins, already handled above
}
