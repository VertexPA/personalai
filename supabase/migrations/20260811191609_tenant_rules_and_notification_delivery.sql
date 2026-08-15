-- Tenant-owned assistant rules and notifications both use narrow RPCs for
-- multi-table state transitions. No browser write policy is added.

begin;

create or replace function public.save_assistant_rule(
  p_organization_id uuid,
  p_rule_id uuid default null,
  p_kind text default 'custom',
  p_natural_language text default null,
  p_structured_rule jsonb default '{}'::jsonb,
  p_requires_confirmation boolean default false,
  p_is_active boolean default true
)
returns table (
  rule_id uuid,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.assistant_rules%rowtype;
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_natural_language text := nullif(trim(coalesce(p_natural_language, '')), '');
  v_rule_id uuid;
  v_confirmed_at timestamptz;
  v_confirmation_reset boolean := false;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not app_private.is_organization_admin(p_organization_id) then
    raise exception 'You cannot manage rules for this organization.'
      using errcode = '42501';
  end if;

  if v_kind !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'Rule kind is invalid.' using errcode = '22023';
  end if;

  if v_natural_language is null or char_length(v_natural_language) > 2000 then
    raise exception 'Rule text is invalid.' using errcode = '22023';
  end if;

  if p_structured_rule is null or jsonb_typeof(p_structured_rule) <> 'object' then
    raise exception 'Structured rule is invalid.' using errcode = '22023';
  end if;

  if p_rule_id is null then
    v_confirmed_at := case when p_requires_confirmation then null else now() end;
    insert into public.assistant_rules (
      organization_id,
      created_by,
      kind,
      natural_language,
      structured_rule,
      requires_confirmation,
      confirmed_at,
      is_active
    )
    values (
      p_organization_id,
      v_actor_id,
      v_kind,
      v_natural_language,
      p_structured_rule,
      p_requires_confirmation,
      v_confirmed_at,
      p_is_active
    )
    returning id into v_rule_id;
  else
    select *
      into v_existing
      from public.assistant_rules
     where id = p_rule_id
     for update;

    if not found or v_existing.organization_id <> p_organization_id then
      raise exception 'Assistant rule was not found.' using errcode = 'P0002';
    end if;

    v_confirmation_reset := p_requires_confirmation and (
      not v_existing.requires_confirmation
      or v_existing.kind is distinct from v_kind
      or v_existing.natural_language is distinct from v_natural_language
      or v_existing.structured_rule is distinct from p_structured_rule
    );
    v_confirmed_at := case
      when not p_requires_confirmation then now()
      when v_confirmation_reset then null
      else v_existing.confirmed_at
    end;

    update public.assistant_rules
       set kind = v_kind,
           natural_language = v_natural_language,
           structured_rule = p_structured_rule,
           requires_confirmation = p_requires_confirmation,
           confirmed_at = v_confirmed_at,
           is_active = p_is_active,
           updated_at = now()
     where id = v_existing.id
     returning id into v_rule_id;
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
    case when p_rule_id is null then 'assistant_rule.created' else 'assistant_rule.updated' end,
    'assistant_rules',
    'assistant_rule',
    v_rule_id::text,
    'succeeded',
    jsonb_build_object(
      'kind', v_kind,
      'requires_confirmation', p_requires_confirmation,
      'confirmation_reset', v_confirmation_reset,
      'is_active', p_is_active
    )
  );

  return query select v_rule_id, v_confirmed_at;
end;
$$;

create or replace function public.confirm_assistant_rule(
  p_rule_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_rule public.assistant_rules%rowtype;
  v_confirmed_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select *
    into v_rule
    from public.assistant_rules
   where id = p_rule_id
   for update;

  if not found then
    raise exception 'Assistant rule was not found.' using errcode = 'P0002';
  end if;

  if not app_private.is_organization_admin(v_rule.organization_id) then
    raise exception 'You cannot confirm this assistant rule.' using errcode = '42501';
  end if;

  v_confirmed_at := coalesce(v_rule.confirmed_at, now());
  update public.assistant_rules
     set confirmed_at = v_confirmed_at,
         updated_at = now()
   where id = v_rule.id;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    tool_name,
    target_type,
    target_id,
    result
  )
  values (
    v_rule.organization_id,
    'user',
    v_actor_id,
    'assistant_rule.confirmed',
    'assistant_rules',
    'assistant_rule',
    v_rule.id::text,
    'succeeded'
  );

  return v_confirmed_at;
end;
$$;

create or replace function public.delete_assistant_rule(
  p_rule_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_rule public.assistant_rules%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select *
    into v_rule
    from public.assistant_rules
   where id = p_rule_id
   for update;

  if not found then
    raise exception 'Assistant rule was not found.' using errcode = 'P0002';
  end if;

  if not app_private.is_organization_admin(v_rule.organization_id) then
    raise exception 'You cannot delete this assistant rule.' using errcode = '42501';
  end if;

  delete from public.assistant_rules where id = v_rule.id;

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
    v_rule.organization_id,
    'user',
    v_actor_id,
    'assistant_rule.deleted',
    'assistant_rules',
    'assistant_rule',
    v_rule.id::text,
    'succeeded',
    jsonb_build_object('kind', v_rule.kind)
  );
end;
$$;

alter table public.notifications
  add column if not exists delivery_started_at timestamptz,
  add column if not exists delivery_attempts integer not null default 0
    check (delivery_attempts >= 0),
  add column if not exists last_error_code text;

create index if not exists notifications_delivery_recovery_idx
  on public.notifications (delivery_started_at asc)
  where status = 'sent' and sent_at is null;

create or replace function public.list_queued_notification_ids(
  p_limit integer default 50
)
returns table (notification_id uuid)
language sql
security definer
set search_path = ''
as $$
  select notifications.id
  from public.notifications
  where notifications.status = 'queued'
    and (notifications.scheduled_for is null or notifications.scheduled_for <= now())
  order by notifications.scheduled_for asc nulls first, notifications.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.claim_queued_notification(
  p_notification_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  recipient_user_id uuid,
  channel public.conversation_channel,
  notification_type text,
  subject text,
  body text,
  payload jsonb,
  idempotency_key text,
  delivery_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
begin
  select *
    into v_notification
    from public.notifications
   where id = p_notification_id
     and status = 'queued'
     and (scheduled_for is null or scheduled_for <= now())
   for update skip locked;

  if not found then
    return;
  end if;

  update public.notifications
     set status = 'sent',
         delivery_started_at = now(),
         delivery_attempts = delivery_attempts + 1,
         last_error_code = null,
         updated_at = now()
   where id = v_notification.id
   returning * into v_notification;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    action,
    tool_name,
    target_type,
    target_id,
    result,
    metadata
  )
  values (
    v_notification.organization_id,
    'system',
    'notification.delivery.started',
    'notification_delivery_worker',
    'notification',
    v_notification.id::text,
    'requested',
    jsonb_build_object(
      'channel', v_notification.channel,
      'attempt', v_notification.delivery_attempts
    )
  );

  return query
  select
    v_notification.id,
    v_notification.organization_id,
    v_notification.recipient_user_id,
    v_notification.channel,
    v_notification.notification_type,
    v_notification.subject,
    v_notification.body,
    v_notification.payload,
    v_notification.idempotency_key,
    v_notification.delivery_attempts;
end;
$$;

create or replace function public.complete_notification_delivery(
  p_notification_id uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_clean_provider_message_id text := nullif(trim(coalesce(p_provider_message_id, '')), '');
  v_clean_error_code text := nullif(trim(coalesce(p_error_code, '')), '');
begin
  if p_outcome not in ('sent', 'delivered', 'failed') then
    raise exception 'Notification outcome is invalid.' using errcode = '22023';
  end if;

  if p_outcome in ('sent', 'delivered') and v_clean_provider_message_id is null then
    raise exception 'Provider message reference is required.' using errcode = '22023';
  end if;

  if v_clean_provider_message_id is not null
    and char_length(v_clean_provider_message_id) > 1024 then
    raise exception 'Provider message reference is invalid.' using errcode = '22023';
  end if;

  if p_outcome = 'failed' and (
    v_clean_error_code is null or v_clean_error_code !~ '^[a-z0-9_]{3,96}$'
  ) then
    raise exception 'Notification error code is invalid.' using errcode = '22023';
  end if;

  select *
    into v_notification
    from public.notifications
   where id = p_notification_id
     and status = 'sent'
     and sent_at is null
   for update;

  if not found then
    raise exception 'Notification is not being delivered.' using errcode = 'P0001';
  end if;

  update public.notifications
     set status = p_outcome::public.notification_status,
         sent_at = case when p_outcome in ('sent', 'delivered') then now() else null end,
         last_error_code = case when p_outcome = 'failed' then v_clean_error_code else null end,
         updated_at = now()
   where id = v_notification.id;

  insert into public.notification_deliveries (
    organization_id,
    notification_id,
    provider_message_id,
    status,
    attempt_count,
    last_error,
    delivered_at
  )
  values (
    v_notification.organization_id,
    v_notification.id,
    v_clean_provider_message_id,
    p_outcome::public.notification_status,
    v_notification.delivery_attempts,
    case when p_outcome = 'failed' then v_clean_error_code else null end,
    case when p_outcome = 'delivered' then now() else null end
  );

  insert into public.audit_logs (
    organization_id,
    actor_type,
    action,
    tool_name,
    target_type,
    target_id,
    result,
    error_code,
    metadata
  )
  values (
    v_notification.organization_id,
    'system',
    'notification.delivery.' || p_outcome,
    'notification_delivery_worker',
    'notification',
    v_notification.id::text,
    case when p_outcome = 'failed' then 'failed' else 'succeeded' end,
    case when p_outcome = 'failed' then v_clean_error_code else null end,
    jsonb_build_object('channel', v_notification.channel)
  );
end;
$$;

create or replace function public.fail_stale_notification_deliveries(
  p_started_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_failed_count integer := 0;
begin
  for v_notification in
    select *
      from public.notifications
     where status = 'sent'
       and sent_at is null
       and delivery_started_at <= p_started_before
     for update skip locked
  loop
    update public.notifications
       set status = 'failed',
           last_error_code = 'delivery_timeout_unknown_outcome',
           updated_at = now()
     where id = v_notification.id;

    insert into public.notification_deliveries (
      organization_id,
      notification_id,
      status,
      attempt_count,
      last_error
    )
    values (
      v_notification.organization_id,
      v_notification.id,
      'failed',
      v_notification.delivery_attempts,
      'delivery_timeout_unknown_outcome'
    );

    insert into public.audit_logs (
      organization_id,
      actor_type,
      action,
      tool_name,
      target_type,
      target_id,
      result,
      error_code,
      metadata
    )
    values (
      v_notification.organization_id,
      'system',
      'notification.delivery.failed',
      'notification_delivery_worker',
      'notification',
      v_notification.id::text,
      'failed',
      'delivery_timeout_unknown_outcome',
      jsonb_build_object('delivery_started_at', v_notification.delivery_started_at)
    );

    v_failed_count := v_failed_count + 1;
  end loop;

  return v_failed_count;
end;
$$;

revoke all on function public.save_assistant_rule(
  uuid, uuid, text, text, jsonb, boolean, boolean
) from public, anon;
revoke all on function public.confirm_assistant_rule(uuid) from public, anon;
revoke all on function public.delete_assistant_rule(uuid) from public, anon;
revoke all on function public.list_queued_notification_ids(integer)
  from public, anon, authenticated;
revoke all on function public.claim_queued_notification(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_stale_notification_deliveries(timestamptz)
  from public, anon, authenticated;

grant execute on function public.save_assistant_rule(
  uuid, uuid, text, text, jsonb, boolean, boolean
) to authenticated;
grant execute on function public.confirm_assistant_rule(uuid) to authenticated;
grant execute on function public.delete_assistant_rule(uuid) to authenticated;
grant execute on function public.list_queued_notification_ids(integer)
  to service_role;
grant execute on function public.claim_queued_notification(uuid)
  to service_role;
grant execute on function public.complete_notification_delivery(uuid, text, text, text)
  to service_role;
grant execute on function public.fail_stale_notification_deliveries(timestamptz)
  to service_role;

commit;
