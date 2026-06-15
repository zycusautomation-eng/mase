-- Per-user Salesforce OAuth connections for MASE.
-- One row per MASE user holding their SF tokens, so a pushed to-do is created
-- AS the rep (CreatedBy + Owner = them), not the shared integration user.
--
-- SECURITY: RLS is enabled with NO policies for authenticated/anon — the table
-- is reachable ONLY via the service-role key used by the server-side
-- /api/sfdc/* routes. Tokens never reach the browser; the UI only sees safe
-- status (connected + username) via /api/sfdc/status.

create table if not exists public.sf_connections (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  email           text,
  sf_user_id      text,
  sf_username     text,
  sf_display_name text,
  instance_url    text,
  access_token    text,
  refresh_token   text,
  token_type      text default 'Bearer',
  scope           text,
  issued_at       timestamptz default now(),
  expires_at      timestamptz,
  updated_at      timestamptz default now()
);

alter table public.sf_connections enable row level security;
-- Intentionally NO policies: only the service role (server routes) may touch it.
