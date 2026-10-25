-- Milestone 2. Run once in Supabase: SQL Editor > New query > paste > Run.
-- Adds the retention quiz. Safe to run again.
-- Demo learners (signed up from a link ending in ?demo) can take it straight away.
--
-- The retention quiz opens from an emailed link on any device, without signing in.
-- The link holds a long random code that the app saved with the learner's row when
-- they finished the module. Learners cannot read or write the retention table
-- directly. The two functions below are the only way in, and each needs a valid code.

create table if not exists public.retention (
  user_id      uuid primary key references public.sessions (user_id) on delete cascade,
  email        text,
  arm          text,
  answers      jsonb not null,
  score        int not null,
  passed       boolean not null,
  started_at   timestamptz,
  submitted_at timestamptz not null default now()
);

-- Learners who score below 6 may try again. The first attempt stays in answers, score
-- and passed (that is the study measure). Later attempts only update these columns.
alter table public.retention add column if not exists attempts int not null default 1;
alter table public.retention add column if not exists best_score int;
alter table public.retention add column if not exists ever_passed boolean not null default false;
update public.retention set best_score = score, ever_passed = passed where best_score is null;

alter table public.retention enable row level security;
-- No policies on purpose: nobody can select, insert or update this table through the API.
revoke all on public.retention from anon, authenticated;

-- Checks a link. Returns when the quiz opens and whether it is done (passed).
-- Returns nothing about the learner (no email, no answers).
create or replace function public.retention_lookup(p_code text)
returns table (completed_at timestamptz, opens_at timestamptz, done boolean)
language sql stable security definer set search_path = public as $$
  select (s.state->>'completedAt')::timestamptz,
         (s.state->>'completedAt')::timestamptz
           + case when s.state->>'demo' = 'true' then interval '0' else interval '5 days' end,
         exists (select 1 from public.retention r where r.user_id = s.user_id and r.ever_passed)
  from public.sessions s
  where length(p_code) >= 32 and s.state->>'retentionCode' = p_code
  limit 1;
$$;

-- Stores a retention attempt. Returns 'ok', 'done' (already passed), 'early' or 'invalid'.
create or replace function public.retention_submit(
  p_code text, p_answers jsonb, p_score int, p_passed boolean, p_started_at timestamptz)
returns text
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions%rowtype;
  r public.retention%rowtype;
begin
  select * into s from public.sessions
  where length(p_code) >= 32 and state->>'retentionCode' = p_code
  limit 1;
  if not found then return 'invalid'; end if;
  if now() < (s.state->>'completedAt')::timestamptz
       + (case when s.state->>'demo' = 'true' then interval '0' else interval '5 days' end) then
    return 'early';
  end if;
  select * into r from public.retention where user_id = s.user_id;
  if not found then
    insert into public.retention (user_id, email, arm, answers, score, passed, started_at, best_score, ever_passed)
    values (s.user_id, s.email, s.arm, p_answers, p_score, p_passed, p_started_at, p_score, p_passed);
    return 'ok';
  end if;
  if r.ever_passed then return 'done'; end if;
  update public.retention
     set attempts = attempts + 1,
         best_score = greatest(best_score, p_score),
         ever_passed = p_passed
   where user_id = s.user_id;
  return 'ok';
end;
$$;

revoke all on function public.retention_lookup(text) from public;
revoke all on function public.retention_submit(text, jsonb, int, boolean, timestamptz) from public;
grant execute on function public.retention_lookup(text) to anon, authenticated;
grant execute on function public.retention_submit(text, jsonb, int, boolean, timestamptz) to anon, authenticated;
