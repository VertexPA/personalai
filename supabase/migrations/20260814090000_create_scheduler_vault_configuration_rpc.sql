-- This narrowly scoped RPC exists only long enough to place the production
-- scheduler values in Supabase Vault without ever putting their plaintext in a
-- migration, repository file, terminal output, or MCP SQL query. It is
-- executable solely by the trusted service_role and is removed by the next
-- migration after provisioning.

begin;

create or replace function public.configure_ava_worker_scheduler_vault(
  p_production_url text,
  p_cron_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_id uuid;
begin
  if coalesce(p_production_url, '') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' then
    raise exception 'Production URL must be an HTTPS origin.'
      using errcode = '22023';
  end if;

  if coalesce(length(p_cron_secret), 0) < 32 then
    raise exception 'CRON_SECRET must contain at least 32 characters.'
      using errcode = '22023';
  end if;

  select id
    into v_secret_id
    from vault.secrets
   where name = 'ava_vercel_production_url';

  if v_secret_id is null then
    perform vault.create_secret(
      p_production_url,
      'ava_vercel_production_url',
      'Ava Vercel Production origin for protected worker dispatches.',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_production_url,
      'ava_vercel_production_url',
      'Ava Vercel Production origin for protected worker dispatches.',
      null
    );
  end if;

  select id
    into v_secret_id
    from vault.secrets
   where name = 'ava_vercel_cron_secret';

  if v_secret_id is null then
    perform vault.create_secret(
      p_cron_secret,
      'ava_vercel_cron_secret',
      'Ava Vercel CRON_SECRET for protected worker dispatches.',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_cron_secret,
      'ava_vercel_cron_secret',
      'Ava Vercel CRON_SECRET for protected worker dispatches.',
      null
    );
  end if;
end;
$function$;

revoke all on function public.configure_ava_worker_scheduler_vault(text, text)
  from public, anon, authenticated;
grant execute on function public.configure_ava_worker_scheduler_vault(text, text)
  to service_role;

commit;
