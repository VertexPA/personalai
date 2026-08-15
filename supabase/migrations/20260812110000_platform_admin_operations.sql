-- Explicit, audited platform-admin controls. Customer administrators cannot
-- invoke these functions because the database validates the platform role from
-- auth.uid(), independent of the UI route guard.

begin;

create or replace function public.platform_set_customer_plan(
  p_organization_id uuid,
  p_plan_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_plan_id uuid;
  v_plan_code text := trim(coalesce(p_plan_code, ''));
begin
  if v_actor_id is null or not app_private.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;

  select id
    into v_plan_id
    from public.plans
   where code = v_plan_code
     and is_active;

  if not found then
    raise exception 'Plan was not found or is inactive.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Customer workspace was not found.' using errcode = 'P0002';
  end if;

  update public.billing_accounts
     set plan_id = v_plan_id,
         updated_at = now()
   where organization_id = p_organization_id;

  if not found then
    raise exception 'Customer billing account was not found.' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    tool_name,
    target_type,
    target_id,
    result,
    metadata
  )
  values (
    p_organization_id,
    'user',
    v_actor_id,
    'platform.customer_plan.updated',
    'platform_admin',
    'billing_account',
    p_organization_id::text,
    'succeeded',
    jsonb_build_object('plan_code', v_plan_code)
  );
end;
$$;

create or replace function public.platform_save_customer_entitlement_override(
  p_organization_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_limit_value integer,
  p_reason text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_feature_key text := trim(coalesce(p_feature_key, ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_actor_id is null or not app_private.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;

  if p_limit_value is not null and p_limit_value < 0
    or v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Entitlement override is invalid.' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Entitlement expiry must be in the future.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Customer workspace was not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.features where key = v_feature_key and is_active
  ) then
    raise exception 'Feature was not found or is inactive.' using errcode = 'P0002';
  end if;

  insert into public.customer_entitlements (
    organization_id,
    feature_key,
    enabled,
    limit_value,
    configuration,
    reason,
    expires_at,
    created_by
  )
  values (
    p_organization_id,
    v_feature_key,
    p_enabled,
    p_limit_value,
    '{}'::jsonb,
    v_reason,
    p_expires_at,
    v_actor_id
  )
  on conflict (organization_id, feature_key)
  do update set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    reason = excluded.reason,
    expires_at = excluded.expires_at,
    created_by = v_actor_id,
    updated_at = now();

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    tool_name,
    target_type,
    target_id,
    result,
    metadata
  )
  values (
    p_organization_id,
    'user',
    v_actor_id,
    'platform.entitlement_override.saved',
    'platform_admin',
    'customer_entitlement',
    v_feature_key,
    'succeeded',
    jsonb_build_object(
      'enabled', p_enabled,
      'limit_value', p_limit_value,
      'expires_at', p_expires_at
    )
  );
end;
$$;

create or replace function public.platform_remove_customer_entitlement_override(
  p_organization_id uuid,
  p_feature_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_feature_key text := trim(coalesce(p_feature_key, ''));
begin
  if v_actor_id is null or not app_private.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;

  delete from public.customer_entitlements
   where organization_id = p_organization_id
     and feature_key = v_feature_key;

  if not found then
    raise exception 'Entitlement override was not found.' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    tool_name,
    target_type,
    target_id,
    result,
    metadata
  )
  values (
    p_organization_id,
    'user',
    v_actor_id,
    'platform.entitlement_override.removed',
    'platform_admin',
    'customer_entitlement',
    v_feature_key,
    'succeeded',
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.platform_set_customer_plan(uuid, text) from public, anon;
revoke all on function public.platform_save_customer_entitlement_override(
  uuid, text, boolean, integer, text, timestamptz
) from public, anon;
revoke all on function public.platform_remove_customer_entitlement_override(uuid, text)
  from public, anon;

grant execute on function public.platform_set_customer_plan(uuid, text)
  to authenticated;
grant execute on function public.platform_save_customer_entitlement_override(
  uuid, text, boolean, integer, text, timestamptz
) to authenticated;
grant execute on function public.platform_remove_customer_entitlement_override(uuid, text)
  to authenticated;

commit;
