-- Per-user storage for the MASE deal-strategist chat.
-- One row per conversation; messages kept as a JSONB array. RLS scopes every
-- row to its owner (auth.uid()), so chats are private and sync across devices.
-- Applied to the shared Supabase project (wfwgatyfzqzrcauatufb).

create table if not exists public.mase_chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'New chat',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mase_chats_user_updated
  on public.mase_chats (user_id, updated_at desc);

alter table public.mase_chats enable row level security;

create policy mase_chats_select on public.mase_chats
  for select to authenticated using (auth.uid() = user_id);
create policy mase_chats_insert on public.mase_chats
  for insert to authenticated with check (auth.uid() = user_id);
create policy mase_chats_update on public.mase_chats
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy mase_chats_delete on public.mase_chats
  for delete to authenticated using (auth.uid() = user_id);
