-- Approval decisions are a single transaction: the request, its linked action,
-- and audit record cannot diverge when multiple approvers act concurrently.

begin;

create or replace function public.decide_approval_request(
  p_approval_request_id uuid,
  p_decision text,
  p_note text default null
)
returns table (
  approval_request_id uuid,
  approval_status public.approval_status,
  tool_action_status public.tool_action_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_approval public.approval_requests%rowtype;
  v_approval_status public.approval_status;
  v_tool_action_status public.tool_action_status;
  v_clean_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'Approval decision is invalid.' using errcode = '22023';
  end if;

  if v_clean_note is not null and char_length(v_clean_note) > 500 then
    raise exception 'Approval note must not exceed 500 characters.'
      using errcode = '22023';
  end if;

  select *
    into v_approval
    from public.approval_requests
   where id = p_approval_request_id
   for update;

  if not found then
    raise exception 'Approval request was not found.' using errcode = 'P0002';
  end if;

  if not app_private.is_organization_admin(v_approval.organization_id) then
    raise exception 'You cannot decide approvals for this organization.'
      using errcode = '42501';
  end if;

  if v_approval.status <> 'pending' then
    raise exception 'This approval request has already been decided.'
      using errcode = 'P0001';
  end if;

  if v_approval.expires_at is not null and v_approval.expires_at <= now() then
    update public.approval_requests
       set status = 'expired',
           updated_at = now()
     where id = v_approval.id;

    update public.tool_actions
       set status = 'cancelled',
           updated_at = now()
     where id = v_approval.tool_action_id
       and organization_id = v_approval.organization_id
       and status in ('requested', 'awaiting_approval', 'approved');

    if not found then
      raise exception 'The linked controlled action is unavailable.'
        using errcode = 'P0002';
    end if;

    insert into public.audit_logs (
      organization_id,
      actor_type,
      actor_user_id,
      action,
      tool_name,
      target_type,
      target_id,
      approval_status,
      result,
      metadata
    )
    values (
      v_approval.organization_id,
      'user',
      v_actor_id,
      'approval.expired',
      v_approval.action,
      'approval_request',
      v_approval.id::text,
      'expired',
      'blocked',
      jsonb_build_object('tool_action_id', v_approval.tool_action_id)
    );

    return query
    select
      v_approval.id,
      'expired'::public.approval_status,
      'cancelled'::public.tool_action_status;
    return;
  end if;

  v_approval_status := case p_decision
    when 'approve' then 'approved'::public.approval_status
    else 'rejected'::public.approval_status
  end;
  v_tool_action_status := case v_approval_status
    when 'approved' then 'approved'::public.tool_action_status
    else 'cancelled'::public.tool_action_status
  end;

  update public.approval_requests
     set status = v_approval_status,
         decision_by = v_actor_id,
         decision_note = v_clean_note,
         decided_at = now(),
         updated_at = now()
   where id = v_approval.id;

  update public.tool_actions
     set status = v_tool_action_status,
         updated_at = now()
   where id = v_approval.tool_action_id
     and organization_id = v_approval.organization_id
     and status in ('requested', 'awaiting_approval', 'approved');

  if not found then
    raise exception 'The linked controlled action is unavailable.'
      using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    tool_name,
    target_type,
    target_id,
    approval_status,
    result,
    metadata
  )
  values (
    v_approval.organization_id,
    'user',
    v_actor_id,
    case
      when p_decision = 'approve' then 'approval.approved'
      else 'approval.rejected'
    end,
    v_approval.action,
    'approval_request',
    v_approval.id::text,
    v_approval_status,
    case when v_approval_status = 'approved' then 'succeeded' else 'blocked' end,
    jsonb_build_object('tool_action_id', v_approval.tool_action_id)
  );

  return query
  select v_approval.id, v_approval_status, v_tool_action_status;
end;
$$;

revoke all on function public.decide_approval_request(uuid, text, text) from public;
revoke all on function public.decide_approval_request(uuid, text, text) from anon;
grant execute on function public.decide_approval_request(uuid, text, text)
  to authenticated;

-- Token material remains in the private schema. The server-side service client
-- is the only role allowed to retrieve or rotate the encrypted bytes.
create or replace function public.get_google_calendar_credential(
  p_organization_id uuid
)
returns table (
  integration_id uuid,
  calendar_connection_id uuid,
  token_expires_at timestamptz,
  ciphertext bytea,
  initialization_vector bytea,
  authentication_tag bytea
)
language sql
security definer
set search_path = ''
as $$
  select
    integrations.id,
    calendar_connections.id,
    integrations.token_expires_at,
    credentials.ciphertext,
    credentials.initialization_vector,
    credentials.authentication_tag
  from public.integrations
  join public.calendar_connections
    on calendar_connections.integration_id = integrations.id
  join private.integration_credentials credentials
    on credentials.integration_id = integrations.id
  where integrations.organization_id = p_organization_id
    and integrations.provider = 'google_calendar'
    and integrations.status = 'connected'
    and calendar_connections.sync_status in ('connected', 'needs_reauth')
  order by integrations.updated_at desc
  limit 1;
$$;

create or replace function public.replace_google_calendar_credential(
  p_integration_id uuid,
  p_token_expires_at timestamptz,
  p_ciphertext bytea,
  p_initialization_vector bytea,
  p_authentication_tag bytea
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if octet_length(p_ciphertext) = 0
    or octet_length(p_initialization_vector) = 0
    or octet_length(p_authentication_tag) = 0 then
    raise exception 'Credential data is invalid.' using errcode = '22023';
  end if;

  update private.integration_credentials
     set ciphertext = p_ciphertext,
         initialization_vector = p_initialization_vector,
         authentication_tag = p_authentication_tag,
         refreshed_at = now(),
         updated_at = now()
   where integration_id = p_integration_id;

  if not found then
    raise exception 'Integration credential was not found.' using errcode = 'P0002';
  end if;

  update public.integrations
     set token_expires_at = p_token_expires_at,
         status = 'connected',
         revoked_at = null,
         last_error_code = null,
         last_error_at = null,
         updated_at = now()
   where id = p_integration_id
     and provider = 'google_calendar';

  if not found then
    raise exception 'Google Calendar integration was not found.'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.save_google_calendar_selection(
  p_calendar_connection_id uuid,
  p_selected_calendar_ids text[],
  p_primary_calendar_external_id text default null
)
returns table (
  selected_count integer,
  primary_calendar_external_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_connection public.calendar_connections%rowtype;
  v_selected_calendar_ids text[] := coalesce(
    p_selected_calendar_ids,
    array[]::text[]
  );
  v_primary_calendar_external_id text := nullif(
    trim(coalesce(p_primary_calendar_external_id, '')),
    ''
  );
  v_selected_count integer;
  v_calendar_limit integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(v_selected_calendar_ids) selected_calendar_id
    where selected_calendar_id is null
      or char_length(trim(selected_calendar_id)) = 0
  ) or exists (
    select 1
    from unnest(v_selected_calendar_ids) selected_calendar_id
    group by selected_calendar_id
    having count(*) > 1
  ) then
    raise exception 'Selected calendars are invalid.' using errcode = '22023';
  end if;

  select *
    into v_connection
    from public.calendar_connections
   where id = p_calendar_connection_id
   for update;

  if not found then
    raise exception 'Calendar connection was not found.' using errcode = 'P0002';
  end if;

  if not app_private.is_organization_admin(v_connection.organization_id) then
    raise exception 'You cannot manage this calendar connection.'
      using errcode = '42501';
  end if;

  if not app_private.has_feature(v_connection.organization_id, 'calendar')
    or not app_private.has_feature(v_connection.organization_id, 'multi_calendar') then
    raise exception 'Calendar selection is not enabled for this organization.'
      using errcode = '42501';
  end if;

  select count(*)
    into v_selected_count
    from public.calendars
   where calendar_connection_id = v_connection.id
     and organization_id = v_connection.organization_id
     and external_calendar_id = any(v_selected_calendar_ids)
     and can_read;

  if v_selected_count <> cardinality(v_selected_calendar_ids) then
    raise exception 'One or more selected calendars are unavailable.'
      using errcode = '22023';
  end if;

  if v_selected_count > 0
    and v_primary_calendar_external_id is null then
    raise exception 'Select a primary calendar.' using errcode = '22023';
  end if;

  if v_primary_calendar_external_id is not null
    and not (v_primary_calendar_external_id = any(v_selected_calendar_ids)) then
    raise exception 'The primary calendar must be selected.'
      using errcode = '22023';
  end if;

  select limit_value
    into v_calendar_limit
    from public.customer_entitlements
   where organization_id = v_connection.organization_id
     and feature_key = 'multi_calendar'
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    select plan_entitlements.limit_value
      into v_calendar_limit
      from public.billing_accounts
      join public.plan_entitlements
        on plan_entitlements.plan_id = billing_accounts.plan_id
     where billing_accounts.organization_id = v_connection.organization_id
       and billing_accounts.status in ('trial', 'active', 'past_due')
       and plan_entitlements.feature_key = 'multi_calendar'
     limit 1;
  end if;

  if v_calendar_limit is not null and v_selected_count > v_calendar_limit then
    raise exception 'Selected calendars exceed this plan limit.'
      using errcode = '22023';
  end if;

  update public.calendars
     set is_selected = external_calendar_id = any(v_selected_calendar_ids),
         is_primary = external_calendar_id = v_primary_calendar_external_id,
         updated_at = now()
   where calendar_connection_id = v_connection.id
     and organization_id = v_connection.organization_id;

  update public.calendar_connections
     set primary_calendar_external_id = v_primary_calendar_external_id,
         updated_at = now()
   where id = v_connection.id;

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
    v_connection.organization_id,
    'user',
    v_actor_id,
    'calendar.selection.updated',
    'google_calendar',
    'calendar_connection',
    v_connection.id::text,
    'succeeded',
    jsonb_build_object(
      'selected_count',
      v_selected_count,
      'primary_calendar_external_id',
      v_primary_calendar_external_id
    )
  );

  return query
  select v_selected_count, v_primary_calendar_external_id;
end;
$$;

revoke all on function public.get_google_calendar_credential(uuid) from public;
revoke all on function public.get_google_calendar_credential(uuid) from anon;
revoke all on function public.get_google_calendar_credential(uuid) from authenticated;
grant execute on function public.get_google_calendar_credential(uuid)
  to service_role;

revoke all on function public.replace_google_calendar_credential(
  uuid,
  timestamptz,
  bytea,
  bytea,
  bytea
) from public;
revoke all on function public.replace_google_calendar_credential(
  uuid,
  timestamptz,
  bytea,
  bytea,
  bytea
) from anon;
revoke all on function public.replace_google_calendar_credential(
  uuid,
  timestamptz,
  bytea,
  bytea,
  bytea
) from authenticated;
grant execute on function public.replace_google_calendar_credential(
  uuid,
  timestamptz,
  bytea,
  bytea,
  bytea
) to service_role;

revoke all on function public.save_google_calendar_selection(uuid, text[], text)
  from public;
revoke all on function public.save_google_calendar_selection(uuid, text[], text)
  from anon;
grant execute on function public.save_google_calendar_selection(uuid, text[], text)
  to authenticated;

commit;
