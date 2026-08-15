-- Vercel Hobby does not provide the application's required five-minute worker
-- cadence. Keep Vercel as the production application host and dispatch the
-- same protected HTTP worker routes from the existing Supabase Free project.
-- The deployment URL and bearer secret are injected into Supabase Vault after
-- deployment; neither value appears in this migration or in cron.job.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function app_private.dispatch_vercel_workers()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_production_url text;
  v_cron_secret text;
  v_path text;
begin
  select decrypted_secret
    into v_production_url
    from vault.decrypted_secrets
   where name = 'ava_vercel_production_url';

  select decrypted_secret
    into v_cron_secret
    from vault.decrypted_secrets
   where name = 'ava_vercel_cron_secret';

  if nullif(btrim(coalesce(v_production_url, '')), '') is null
    or nullif(btrim(coalesce(v_cron_secret, '')), '') is null then
    raise exception 'Production worker scheduler is not configured.'
      using errcode = '22023';
  end if;

  if v_production_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' then
    raise exception 'Production worker scheduler URL is invalid.'
      using errcode = '22023';
  end if;

  foreach v_path in array array[
    '/api/jobs/automations/run',
    '/api/jobs/tool-actions/run',
    '/api/jobs/agent-runs/run',
    '/api/jobs/notifications/run'
  ]
  loop
    perform net.http_post(
      url := rtrim(v_production_url, '/') || v_path,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_cron_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  end loop;
end;
$function$;

revoke all on function app_private.dispatch_vercel_workers()
  from public, anon, authenticated, service_role;

commit;
