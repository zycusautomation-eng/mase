// Server-only usage-event logger. Every event is stamped with the SESSION's email
// (resolved server-side, so it can't be spoofed by the client) and written to
// public.mase_usage_events via the service-role client. Tracking must NEVER break a
// request — all failures are swallowed. This is the single source of truth for MASE
// adoption (app-opens + attributed actions), replacing the unreliable auth
// last_sign_in_at (which misses persisted sessions) and the un-stamped action writes.
//
// ONE-TIME SETUP (run in Supabase SQL editor — the app has no DDL access):
//   create table if not exists public.mase_usage_events (
//     id          bigint generated always as identity primary key,
//     user_email  text,
//     user_name   text,
//     event       text not null,
//     path        text,
//     meta        jsonb,
//     created_at  timestamptz not null default now()
//   );
//   create index if not exists mase_usage_events_email_idx on public.mase_usage_events (user_email, created_at desc);
//   create index if not exists mase_usage_events_event_idx on public.mase_usage_events (event, created_at desc);
//   alter table public.mase_usage_events enable row level security;  -- service-role only
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { callerEmail } from "@/lib/config/server";
import { EMAIL_TO_OWNER, ADMIN_EMAILS } from "@/lib/engine/helpers";

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

export async function logEvent(event: string, path: string, meta: unknown): Promise<void> {
  try {
    const email = await callerEmail();          // server-resolved session email
    if (!email) return;                          // anonymous / signed-out — skip
    const name = EMAIL_TO_OWNER[email] || (ADMIN_EMAILS.has(email) ? "(admin)" : null);
    await svc().from("mase_usage_events").insert({
      user_email: email,
      user_name: name,
      event: String(event || "unknown").slice(0, 64),
      path: (path || "").slice(0, 256) || null,
      meta: (meta && typeof meta === "object") ? meta : {},
    });
  } catch {
    /* tracking is best-effort — never surface an error to the caller */
  }
}
