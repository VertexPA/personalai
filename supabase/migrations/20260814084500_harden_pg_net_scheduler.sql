-- pg_net is installed in public by default on some Supabase projects, which
-- triggers the extension-in-public advisor and grants direct HTTP access to
-- API roles. This deployment has no queued requests yet, so it is safe to
-- rebuild the extension in the recommended extensions schema before workers
-- are scheduled. The guard prevents a future migration replay from silently
-- discarding queued work.

begin;

do $block$
begin
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_net'
       and n.nspname = 'public'
  ) and exists (select 1 from net.http_request_queue) then
    raise exception 'Cannot relocate pg_net while HTTP requests are queued.'
      using errcode = '55000';
  end if;
end;
$block$;

-- pg_net is not relocatable. Supabase documents drop-and-recreate as the
-- supported way to put the extension metadata outside public.
drop function if exists app_private.dispatch_vercel_workers();
drop extension if exists pg_net;
create extension pg_net schema extensions;

-- The network queue is internal infrastructure. Application API roles must
-- use the narrowly scoped security-definer dispatcher below instead of making
-- arbitrary outbound requests directly.
revoke all on schema net from public, anon, authenticated, service_role;
revoke all on all functions in schema net
  from public, anon, authenticated, service_role;
revoke all on all tables in schema net
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema net
  from public, anon, authenticated, service_role;

create function app_private.dispatch_vercel_workers()
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
