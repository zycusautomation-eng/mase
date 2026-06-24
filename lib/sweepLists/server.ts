// Server-only helpers for the Admin -> Run Sweep "saved lists" feature.
//
// Storage: lists live as rows in the EXISTING public.app_config key/value table (the
// same table that holds the agent prompts) — one row per list, keyed
// "sweep_list:<uuid>", value = JSON. This deliberately avoids a dedicated table /
// migration (we have no DDL access from the app), and only the service-role client
// here touches them. Every route handler that calls these first checks
// callerEmailIfAdmin(), the same trust model as the deal-engine proxy.
import "server-only";
import { randomUUID } from "node:crypto";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";

const PREFIX = "sweep_list:";

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

// Resolve the caller from the Supabase session and return their email iff they are
// an admin (else null). getUser() first; fall back to the signed session JWT (the
// edge middleware deliberately does not refresh, so a valid-but-stale token would
// otherwise lock out a real admin) — same pattern as the deal-engine proxy.
export async function callerEmailIfAdmin(): Promise<string | null> {
  try {
    const supabase = await createSSRClient();
    const { data: u } = await supabase.auth.getUser();
    let email = u?.user?.email ?? null;
    if (!email) {
      const { data: s } = await supabase.auth.getSession();
      email = s?.session?.user?.email ?? null;
    }
    return email && ADMIN_EMAILS.has(email.toLowerCase()) ? email : null;
  } catch {
    return null;
  }
}

export type SweepList = {
  id: string;
  name: string;
  opp_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type Stored = {
  name: string; opp_ids: string[]; created_by: string | null;
  created_at: string; updated_at: string;
};

function normIds(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

function parseRow(row: { key: string; value: string; updated_at?: string | null }): SweepList | null {
  try {
    const s = JSON.parse(row.value) as Stored;
    return {
      id: row.key.slice(PREFIX.length),
      name: String(s.name ?? ""),
      opp_ids: normIds(s.opp_ids),
      created_by: s.created_by ?? null,
      created_at: s.created_at ?? row.updated_at ?? "",
      updated_at: s.updated_at ?? row.updated_at ?? "",
    };
  } catch {
    return null;
  }
}

export async function listLists(): Promise<SweepList[]> {
  const { data, error } = await svc().from("app_config")
    .select("key,value,updated_at").like("key", `${PREFIX}%`);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map(parseRow)
    .filter((x): x is SweepList => !!x)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

export async function createList(name: string, oppIds: string[], email: string): Promise<SweepList> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const stored: Stored = { name, opp_ids: normIds(oppIds), created_by: email, created_at: now, updated_at: now };
  // NB: app_config.updated_by is a uuid (FK to auth.users), so we do NOT set it to an
  // email — the creator's email lives inside the JSON value (created_by) instead.
  const { error } = await svc().from("app_config")
    .insert({ key: PREFIX + id, value: JSON.stringify(stored) });
  if (error) throw new Error(error.message);
  return { id, ...stored };
}

export async function updateList(
  id: string,
  patch: { name?: string; opp_ids?: string[] }
): Promise<SweepList> {
  const key = PREFIX + id;
  const { data, error } = await svc().from("app_config")
    .select("key,value,updated_at").eq("key", key).single();
  if (error) throw new Error(error.message);
  const cur = parseRow(data);
  if (!cur) throw new Error("list not found");
  const next: Stored = {
    name: patch.name !== undefined ? patch.name : cur.name,
    opp_ids: patch.opp_ids !== undefined ? normIds(patch.opp_ids) : cur.opp_ids,
    created_by: cur.created_by,
    created_at: cur.created_at,
    updated_at: new Date().toISOString(),
  };
  const { error: uerr } = await svc().from("app_config")
    .update({ value: JSON.stringify(next) }).eq("key", key);
  if (uerr) throw new Error(uerr.message);
  return { id, ...next };
}

export async function deleteList(id: string): Promise<void> {
  const { error } = await svc().from("app_config").delete().eq("key", PREFIX + id);
  if (error) throw new Error(error.message);
}
