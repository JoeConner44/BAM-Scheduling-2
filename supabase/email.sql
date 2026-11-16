-- Email follow-up scheduler. Run once in the Supabase SQL Editor AFTER the "email" Edge Function is deployed.
-- Creates a private secret for the scheduler and a weekday-morning job that asks the function to send
-- whatever follow-ups are due. The secret never leaves the database.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.email_cron (
  id     int primary key default 1 check (id = 1),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.email_cron (id) values (1) on conflict do nothing;
alter table public.email_cron enable row level security;          -- no policies: service role only
revoke all on public.email_cron from anon, authenticated;

-- Weekdays at 14:00 UTC (9 am Eastern in winter, 10 am in summer). Re-running this file replaces the job.
select cron.unschedule(jobid) from cron.job where jobname = 'asphaltpro-followups';
select cron.schedule(
  'asphaltpro-followups',
  '0 14 * * 1-5',
  $job$
  select net.http_post(
    url     := 'https://zfpcngafkzgqryskubuu.supabase.co/functions/v1/email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select secret from public.email_cron where id = 1)),
    body    := '{"action":"runFollowups"}'::jsonb
  );
  $job$
);
