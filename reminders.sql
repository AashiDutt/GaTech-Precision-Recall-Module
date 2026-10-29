-- Who is due a retention reminder today. Run in Supabase: SQL Editor.
-- Lists learners who finished the module at least five days ago and have not
-- taken the retention quiz yet, with their personal link.
--
-- One row per email. Someone who signed up on more than one device has several
-- rows (later ones are flagged state.repeat). The row that counts for each email is
-- the earliest one that finished the module, or the earliest row if none finished.
-- Use the same rule for the analysis.
with counted as (
  select distinct on (lower(s.email)) s.*
  from public.sessions s
  where coalesce(s.state->>'demo', 'false') <> 'true'   -- skip demo learners
  order by lower(s.email),
           (s.state ? 'completedAt') desc,               -- finished rows first
           coalesce((s.state->>'completedAt')::timestamptz, s.consent_at),
           s.consent_at
)
select
  c.email,
  c.arm,
  (c.state->>'completedAt')::timestamptz as finished_at,
  'https://aashidutt.github.io/GaTech-Precision-Recall-Module/?retention=' || (c.state->>'retentionCode') as link
from counted c
where c.state ? 'retentionCode'
  and (c.state->>'completedAt')::timestamptz <= now() - interval '5 days'
  and not exists (select 1 from public.retention r where r.user_id = c.user_id)
order by finished_at;

-- Results for the analysis: one row per email, chosen by the rule above. score and
-- passed are the first attempt (the study measure); attempts counts retakes.
-- with counted as (
--   select distinct on (lower(s.email)) s.*
--   from public.sessions s
--   where coalesce(s.state->>'demo', 'false') <> 'true'
--   order by lower(s.email), (s.state ? 'completedAt') desc,
--            coalesce((s.state->>'completedAt')::timestamptz, s.consent_at), s.consent_at
-- )
-- select c.email, c.arm, coalesce((c.state->>'repeat')::boolean, false) as repeat,
--        r.score, r.passed, r.attempts, r.best_score, r.submitted_at
-- from counted c join public.retention r using (user_id)
-- order by c.arm, r.submitted_at;
