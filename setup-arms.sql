-- One arm per person. Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again.
--
-- The app draws an arm at random at sign-up, but each browser or device creates a
-- new row. Without this, someone who switches device could land in both arms.
-- claim_arm keeps the first arm drawn for each email and returns it on every later
-- sign-up. Learners cannot read the participants table directly.
-- Known limit: claim_arm reveals whether an email has signed up before.

create table if not exists public.participants (
  email      text primary key,
  arm        text not null check (arm in ('A', 'B')),
  created_at timestamptz not null default now()
);

alter table public.participants enable row level security;
-- No policies on purpose: nobody can read or write this table through the API.
revoke all on public.participants from anon, authenticated;

-- Backfill emails that signed up before this table existed (earliest row wins).
insert into public.participants (email, arm, created_at)
select distinct on (lower(email)) lower(email), arm, coalesce(consent_at, now())
from public.sessions
where email is not null and arm in ('A', 'B') and coalesce(state->>'demo', 'false') <> 'true'
order by lower(email), consent_at
on conflict (email) do nothing;

-- Returns the arm to use, and whether this email had signed up before.
create or replace function public.claim_arm(p_email text, p_arm text)
returns table (arm text, repeat boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  e text := lower(trim(p_email));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or p_arm not in ('A', 'B') then
    raise exception 'invalid input';
  end if;
  insert into public.participants (email, arm) values (e, p_arm)
  on conflict (email) do nothing;
  if found then
    return query select p_arm, false;
  else
    return query select p.arm, true from public.participants p where p.email = e;
  end if;
end;
$$;

revoke all on function public.claim_arm(text, text) from public;
grant execute on function public.claim_arm(text, text) to anon, authenticated;
