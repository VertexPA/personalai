-- Schedule the protected Vercel worker dispatcher from Supabase Free pg_cron.
-- The Vault values were provisioned through the immediately preceding,
-- service-role-only RPC; remove that temporary configuration surface as soon as
-- the durable job has been created.

begin;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'ava-vercel-worker-dispatch';

select cron.schedule(
  'ava-vercel-worker-dispatch',
  '*/5 * * * *',
  'select app_private.dispatch_vercel_workers();'
);

drop function public.configure_ava_worker_scheduler_vault(text, text);

commit;
