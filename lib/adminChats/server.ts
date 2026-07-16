// Server-only helpers for the Admin → Chats tab: read EVERY user's saved
// conversations across the RLS boundary. mase_chats is row-scoped to auth.uid(), so
// listing all users' chats requires the SERVICE-ROLE key (bypasses RLS) — same trick
// lib/config/server.ts uses. Both chat types live in mase_chats; a deal chat is a row
// whose title is prefixed "[deal:<oid>] <account>", a general chat has no marker.
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_TO_OWNER, ADMIN_EMAILS } from "@/lib/engine/helpers";

let _svc: SupabaseClient | null = null;
function svc(): SupabaseClient {
  if (!_svc) {
    _svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _svc;
}

// A deal chat's title is "[deal:<oid>] <account>"; a general chat has no marker.
const DEAL_RE = /^\[deal:([^\]]+)\]\s*(.*)$/;
function classify(rawTitle: unknown): { type: "deal" | "general"; oid: string | null; title: string } {
  const t = String(rawTitle || "");
  const m = DEAL_RE.exec(t);
  if (m) return { type: "deal", oid: (m[1] || "").trim() || null, title: (m[2] || "").trim() || "Deal chat" };
  return { type: "general", oid: null, title: t.trim() || "New chat" };
}

// Friendly display name for an email (SFDC owner name, else flag admins), else null.
function displayName(email: string | null): string | null {
  if (!email) return null;
  return EMAIL_TO_OWNER[email] || (ADMIN_EMAILS.has(email) ? "Admin" : null);
}

// Build a user_id(uuid) -> email map via the Supabase Admin API (paginated). mase_chats
// stores only the auth uuid and there is no profiles table, so this is the only resolver.
async function userEmailMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const perPage = 200;
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await svc().auth.admin.listUsers({ page, perPage });
      const users = data?.users || [];
      if (error || users.length === 0) break;
      for (const u of users) if (u.id && u.email) map.set(u.id, String(u.email).toLowerCase());
      if (users.length < perPage) break;
    }
  } catch { /* fall back to raw uuid where unresolved */ }
  return map;
}

export type AdminChatMeta = {
  id: string; type: "deal" | "general"; oid: string | null; title: string;
  created_at: string | null; updated_at: string | null;
};
export type AdminChatUser = {
  user_id: string; email: string | null; name: string | null;
  chatCount: number; lastActivity: string | null; chats: AdminChatMeta[];
};

// All chats, grouped by user, newest-active user first. Lightweight: does NOT fetch the
// (potentially large) messages arrays — the transcript is loaded on demand by getChatById.
export async function listAllChats(): Promise<AdminChatUser[]> {
  const { data, error } = await svc()
    .from("mase_chats")
    .select("id,user_id,title,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const emailMap = await userEmailMap();

  const byUser = new Map<string, AdminChatUser>();
  for (const r of rows) {
    const uid = String((r as any).user_id || "unknown");
    if (!byUser.has(uid)) {
      const email = emailMap.get(uid) || null;
      byUser.set(uid, { user_id: uid, email, name: displayName(email), chatCount: 0, lastActivity: null, chats: [] });
    }
    const { type, oid, title } = classify((r as any).title);
    byUser.get(uid)!.chats.push({
      id: (r as any).id, type, oid, title,
      created_at: (r as any).created_at ?? null, updated_at: (r as any).updated_at ?? null,
    });
  }

  const users = [...byUser.values()].map((u) => ({
    ...u, chatCount: u.chats.length, lastActivity: u.chats[0]?.updated_at ?? null,
  }));
  users.sort((a, b) => String(b.lastActivity || "").localeCompare(String(a.lastActivity || "")));
  return users;
}

export type AdminChatDetail = AdminChatMeta & {
  user_id: string; email: string | null; name: string | null; messages: any[];
};

// One chat's full transcript (the messages JSONB), plus its owner + type. Service-role,
// so it resolves regardless of who owns the row (RLS would otherwise block cross-user reads).
export async function getChatById(id: string): Promise<AdminChatDetail | null> {
  const { data, error } = await svc()
    .from("mase_chats")
    .select("id,user_id,title,messages,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { type, oid, title } = classify((data as any).title);
  let email: string | null = null;
  try {
    const { data: u } = await svc().auth.admin.getUserById(String((data as any).user_id));
    email = u?.user?.email ? String(u.user.email).toLowerCase() : null;
  } catch { /* leave null */ }
  return {
    id: (data as any).id, type, oid, title,
    user_id: String((data as any).user_id), email, name: displayName(email),
    messages: Array.isArray((data as any).messages) ? (data as any).messages : [],
    created_at: (data as any).created_at ?? null, updated_at: (data as any).updated_at ?? null,
  };
}
