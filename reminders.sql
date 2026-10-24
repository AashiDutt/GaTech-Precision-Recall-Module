-- Who is due a retention reminder today. Run in Supabase: SQL Editor.
-- Lists learners who finished the module at least five days ago and have not
-- taken the retention quiz yet, with their personal link.
select
  s.email,
  s.arm,
  (s.state->>'completedAt')::timestamptz as finished_at,
  'https://aashidutt.github.io/GaTech-Precision-Recall-Module/?retention=' || (s.state->>'retentionCode') as link
from public.sessions s
where s.state ? 'retentionCode'
  and coalesce(s.state->>'demo', 'false') <> 'true'   -- skip demo learners
  and (s.state->>'completedAt')::timestamptz <= now() - interval '5 days'
  and not exists (select 1 from public.retention r where r.user_id = s.user_id)
order by finished_at;

-- Results for the analysis: one row per learner who took the retention quiz.
-- select s.email, s.arm, r.score, r.passed, r.submitted_at
-- from public.retention r join public.sessions s using (user_id)
-- where coalesce(s.state->>'demo', 'false') <> 'true'
-- order by s.arm, r.submitted_at;
