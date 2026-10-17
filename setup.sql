-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Creates one row per learner. Each learner can only read and write their own row.

create table if not exists public.sessions (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email       text,
  arm         text check (arm in ('A', 'B')),
  consent_at  timestamptz,
  screen      text,
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.sessions enable row level security;

drop policy if exists "read own row"   on public.sessions;
drop policy if exists "insert own row" on public.sessions;
drop policy if exists "update own row" on public.sessions;

create policy "read own row" on public.sessions
  for select to authenticated using (user_id = auth.uid());

create policy "insert own row" on public.sessions
  for insert to authenticated with check (user_id = auth.uid());

create policy "update own row" on public.sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.sessions to authenticated;

-- No delete policy: learners cannot delete rows. You can, from the dashboard.
