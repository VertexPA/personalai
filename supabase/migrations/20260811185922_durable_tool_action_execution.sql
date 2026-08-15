-- Controlled tool actions are durable work items. Browser sessions may request
-- an explicitly supported action, but only the service-role executor can claim
-- and finalize provider work. A timed-out execution is failed rather than
-- retried: an external provider may have completed the side effect already.

begin;

alter table public.tool_actions
  add column if not exists request_fingerprint text not null default '',
  add column if not exists execution_started_at timestamptz,
  add column if not exists execution_attempts integer not null default 0
    check (execution_attempts >= 0);

create index if not exists tool_actions_executor_queue_idx
  on public.tool_actions (created_at asc)
  where status = 'approved';

create or replace function public.request_calendar_tool_action(
  p_organization_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_payload jsonb,
  p_request_fingerprint text,
  p_summary text,
  p_expires_at timestamptz default null
)
returns table (
  tool_action_id uuid,
  approval_request_id uuid,
  action text,
  tool_action_status public.tool_action_status,
  approval_status public.approval_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_action text;
  v_authorization_action text;
  v_risk_level text;
  v_requires_approval boolean;
  v_external_calendar_id text;
  v_existing_action public.tool_actions%rowtype;
  v_existing_approval public.approval_requests%rowtype;
  v_tool_action_id uuid;
  v_approval_request_id uuid := null;
  v_tool_action_status public.tool_action_status;
  v_approval_status public.approval_status := null;
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_expires_at timestamptz;
  v_attendee_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_operation not in ('create', 'update', 'cancel') then
    raise exception 'Calendar operation is invalid.' using errcode = '22023';
  end if;

  if p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Idempotency key is invalid.' using errcode = '22023';
  end if;

  if p_request_fingerprint is null
    or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Request fingerprint is invalid.' using errcode = '22023';
  end if;

  if p_request_payload is null
    or jsonb_typeof(p_request_payload) <> 'object' then
    raise exception 'Calendar request payload is invalid.' using errcode = '22023';
  end if;

  if v_summary is null or char_length(v_summary) > 500 then
    raise exception 'Calendar request summary is invalid.' using errcode = '22023';
  end if;

  v_external_calendar_id := nullif(trim(p_request_payload ->> 'externalCalendarId'), '');
  if v_external_calendar_id is null
    or char_length(v_external_calendar_id) > 1024 then
    raise exception 'Calendar selection is invalid.' using errcode = '22023';
  end if;

  if p_operation in ('create', 'update') then
    if nullif(trim(p_request_payload ->> 'title'), '') is null
      or char_length(trim(p_request_payload ->> 'title')) > 500 then
      raise exception 'Calendar event title is invalid.' using errcode = '22023';
    end if;

    if jsonb_typeof(p_request_payload -> 'startsAt') is distinct from 'string'
      or jsonb_typeof(p_request_payload -> 'endsAt') is distinct from 'string'
      or char_length(p_request_payload ->> 'startsAt') > 64
      or char_length(p_request_payload ->> 'endsAt') > 64 then
      raise exception 'Calendar event timing is invalid.' using errcode = '22023';
    end if;

    begin
      v_starts_at := (p_request_payload ->> 'startsAt')::timestamptz;
      v_ends_at := (p_request_payload ->> 'endsAt')::timestamptz;
    exception when others then
      raise exception 'Calendar event timing is invalid.' using errcode = '22023';
    end;

    if v_ends_at <= v_starts_at then
      raise exception 'Calendar event must end after it starts.' using errcode = '22023';
    end if;
  end if;

  if p_operation in ('update', 'cancel') and (
    nullif(trim(p_request_payload ->> 'externalEventId'), '') is null
    or char_length(trim(p_request_payload ->> 'externalEventId')) > 1024
  ) then
    raise exception 'Calendar event reference is invalid.' using errcode = '22023';
  end if;

  if p_request_payload ? 'attendeeEmails' then
    if jsonb_typeof(p_request_payload -> 'attendeeEmails') <> 'array'
      or jsonb_array_length(p_request_payload -> 'attendeeEmails') > 100 then
      raise exception 'Calendar attendees are invalid.' using errcode = '22023';
    end if;
    v_attendee_count := jsonb_array_length(p_request_payload -> 'attendeeEmails');
  end if;

  if p_operation = 'create' then
    v_action := case
      when v_attendee_count > 0 then 'calendar.create_external'
      else 'calendar.create'
    end;
    v_authorization_action := 'calendar.create';
    v_risk_level := case when v_attendee_count > 0 then 'high' else 'medium' end;
  elsif p_operation = 'update' then
    v_action := 'calendar.move_external';
    v_authorization_action := 'calendar.update';
    v_risk_level := 'high';
  else
    v_action := 'calendar.cancel';
    v_authorization_action := 'calendar.cancel';
    v_risk_level := 'high';
  end if;

  if not app_private.can_perform_action(
    p_organization_id,
    v_authorization_action
  ) then
    raise exception 'You cannot perform this calendar action.' using errcode = '42501';
  end if;

  if not app_private.has_feature(p_organization_id, 'calendar_management') then
    raise exception 'Calendar management is not enabled for this organization.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.calendars
    where organization_id = p_organization_id
      and external_calendar_id = v_external_calendar_id
      and is_selected
      and can_write
  ) then
    raise exception 'Choose a selected calendar with write access.' using errcode = '22023';
  end if;

  select *
    into v_existing_action
    from public.tool_actions
   where organization_id = p_organization_id
     and idempotency_key = p_idempotency_key
   for update;

  if found then
    if v_existing_action.request_fingerprint <> p_request_fingerprint then
      raise exception 'This idempotency key was already used for another request.'
        using errcode = '22023';
    end if;

    select *
      into v_existing_approval
      from public.approval_requests
     where tool_action_id = v_existing_action.id;

    return query
    select
      v_existing_action.id,
      v_existing_approval.id,
      v_existing_action.action,
      v_existing_action.status,
      v_existing_approval.status;
    return;
  end if;

  -- A local, attendee-free create may execute without approval. Every action
  -- that changes an existing event or communicates with attendees follows the
  -- tenant approval policy, which defaults to required for these action names.
  v_requires_approval := v_action <> 'calendar.create'
    and app_private.requires_approval(p_organization_id, v_action);
  v_tool_action_status := case
    when v_requires_approval then 'awaiting_approval'::public.tool_action_status
    else 'approved'::public.tool_action_status
  end;

  if p_expires_at is not null then
    if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
      raise exception 'Approval expiry is invalid.' using errcode = '22023';
    end if;
    v_expires_at := p_expires_at;
  else
    v_expires_at := now() + interval '24 hours';
  end if;

  insert into public.tool_actions (
    organization_id,
    requested_by,
    action,
    tool_name,
    risk_level,
    status,
    idempotency_key,
    request_fingerprint,
    request_payload
  )
  values (
    p_organization_id,
    v_actor_id,
    v_action,
    'google_calendar',
    v_risk_level,
    v_tool_action_status,
    p_idempotency_key,
    p_request_fingerprint,
    p_request_payload
  )
  returning id into v_tool_action_id;

  if v_requires_approval then
    v_approval_status := 'pending'::public.approval_status;
    insert into public.approval_requests (
      organization_id,
      tool_action_id,
      requested_by,
      action,
      summary,
      status,
      idempotency_key,
      expires_at
    )
    values (
      p_organization_id,
      v_tool_action_id,
      v_actor_id,
      v_action,
      v_summary,
      v_approval_status,
      p_idempotency_key,
      v_expires_at
    )
    returning id into v_approval_request_id;
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
    p_organization_id,
    'user',
    v_actor_id,
    'tool_action.requested',
    'google_calendar',
    'tool_action',
    v_tool_action_id::text,
    v_approval_status,
    'requested',
    jsonb_build_object(
      'controlled_action', v_action,
      'operation', p_operation,
      'requires_approval', v_requires_approval
    )
  );

  return query
  select
    v_tool_action_id,
    v_approval_request_id,
    v_action,
    v_tool_action_status,
    v_approval_status;
end;
$$;

create or replace function public.list_approved_tool_action_ids(
  p_limit integer default 50
)
returns table (tool_action_id uuid)
language sql
security definer
set search_path = ''
as $$
  select tool_actions.id
  from public.tool_actions
  where tool_actions.status = 'approved'
    and (
      not exists (
        select 1
        from public.approval_requests
        where approval_requests.tool_action_id = tool_actions.id
      )
      or exists (
        select 1
        from public.approval_requests
        where approval_requests.tool_action_id = tool_actions.id
          and approval_requests.status = 'approved'
      )
    )
  order by tool_actions.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.claim_approved_tool_action(
  p_tool_action_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  action text,
  tool_name text,
  risk_level text,
  idempotency_key text,
  request_payload jsonb,
  requested_by uuid,
  execution_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.tool_actions%rowtype;
begin
  select *
    into v_action
    from public.tool_actions
   where id = p_tool_action_id
     and status = 'approved'
   for update skip locked;

  if not found then
    return;
  end if;

  if exists (
    select 1
    from public.approval_requests
    where tool_action_id = v_action.id
      and status <> 'approved'
  ) then
    update public.tool_actions
       set status = 'failed',
           error_code = 'approval_state_invalid',
           executed_at = now(),
           updated_at = now()
     where id = v_action.id;

    insert into public.audit_logs (
      organization_id,
      actor_type,
      action,
      tool_name,
      target_type,
      target_id,
      result,
      error_code
    )
    values (
      v_action.organization_id,
      'system',
      'tool_action.execution.failed',
      v_action.tool_name,
      'tool_action',
      v_action.id::text,
      'failed',
      'approval_state_invalid'
    );
    return;
  end if;

  update public.tool_actions
     set status = 'executing',
         execution_started_at = now(),
         execution_attempts = execution_attempts + 1,
         updated_at = now()
   where id = v_action.id
   returning * into v_action;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    action,
    tool_name,
    target_type,
    target_id,
    approval_status,
    result,
    metadata
  )
  values (
    v_action.organization_id,
    'system',
    'tool_action.execution.started',
    v_action.tool_name,
    'tool_action',
    v_action.id::text,
    case when exists (
      select 1 from public.approval_requests
       where tool_action_id = v_action.id
    ) then 'approved'::public.approval_status else null end,
    'requested',
    jsonb_build_object('attempt', v_action.execution_attempts)
  );

  return query
  select
    v_action.id,
    v_action.organization_id,
    v_action.action,
    v_action.tool_name,
    v_action.risk_level,
    v_action.idempotency_key,
    v_action.request_payload,
    v_action.requested_by,
    v_action.execution_attempts;
end;
$$;

create or replace function public.complete_tool_action_execution(
  p_tool_action_id uuid,
  p_outcome text,
  p_result_payload jsonb default '{}'::jsonb,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.tool_actions%rowtype;
  v_approval_status public.approval_status := null;
  v_clean_error_code text := nullif(trim(coalesce(p_error_code, '')), '');
begin
  if p_outcome not in ('succeeded', 'failed') then
    raise exception 'Tool action outcome is invalid.' using errcode = '22023';
  end if;

  if p_result_payload is null or jsonb_typeof(p_result_payload) <> 'object' then
    raise exception 'Tool action result is invalid.' using errcode = '22023';
  end if;

  if v_clean_error_code is not null
    and v_clean_error_code !~ '^[a-z0-9_]{3,96}$' then
    raise exception 'Tool action error code is invalid.' using errcode = '22023';
  end if;

  select *
    into v_action
    from public.tool_actions
   where id = p_tool_action_id
     and status = 'executing'
   for update;

  if not found then
    raise exception 'Tool action is not executing.' using errcode = 'P0001';
  end if;

  update public.tool_actions
     set status = p_outcome::public.tool_action_status,
         result_payload = p_result_payload,
         error_code = case when p_outcome = 'failed' then v_clean_error_code else null end,
         executed_at = now(),
         updated_at = now()
   where id = v_action.id;

  if p_outcome = 'succeeded' then
    update public.approval_requests
       set status = 'executed',
           executed_at = now(),
           updated_at = now()
     where tool_action_id = v_action.id
       and status = 'approved'
     returning status into v_approval_status;
  elsif exists (
    select 1 from public.approval_requests where tool_action_id = v_action.id
  ) then
    v_approval_status := 'approved'::public.approval_status;
  end if;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    action,
    tool_name,
    target_type,
    target_id,
    approval_status,
    result,
    error_code,
    metadata
  )
  values (
    v_action.organization_id,
    'system',
    'tool_action.execution.' || p_outcome,
    v_action.tool_name,
    'tool_action',
    v_action.id::text,
    v_approval_status,
    p_outcome,
    case when p_outcome = 'failed' then v_clean_error_code else null end,
    p_result_payload
  );
end;
$$;

create or replace function public.fail_stale_tool_action_executions(
  p_started_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.tool_actions%rowtype;
  v_failed_count integer := 0;
begin
  for v_action in
    select *
      from public.tool_actions
     where status = 'executing'
       and execution_started_at <= p_started_before
     for update skip locked
  loop
    update public.tool_actions
       set status = 'failed',
           error_code = 'execution_timeout_unknown_outcome',
           executed_at = now(),
           updated_at = now()
     where id = v_action.id;

    insert into public.audit_logs (
      organization_id,
      actor_type,
      action,
      tool_name,
      target_type,
      target_id,
      approval_status,
      result,
      error_code,
      metadata
    )
    values (
      v_action.organization_id,
      'system',
      'tool_action.execution.failed',
      v_action.tool_name,
      'tool_action',
      v_action.id::text,
      case when exists (
        select 1 from public.approval_requests
         where tool_action_id = v_action.id
      ) then 'approved'::public.approval_status else null end,
      'failed',
      'execution_timeout_unknown_outcome',
      jsonb_build_object('execution_started_at', v_action.execution_started_at)
    );

    v_failed_count := v_failed_count + 1;
  end loop;

  return v_failed_count;
end;
$$;

revoke all on function public.request_calendar_tool_action(
  uuid, text, text, jsonb, text, text, timestamptz
) from public, anon;
revoke all on function public.list_approved_tool_action_ids(integer)
  from public, anon, authenticated;
revoke all on function public.claim_approved_tool_action(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_tool_action_execution(uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.fail_stale_tool_action_executions(timestamptz)
  from public, anon, authenticated;

grant execute on function public.request_calendar_tool_action(
  uuid, text, text, jsonb, text, text, timestamptz
) to authenticated;
grant execute on function public.list_approved_tool_action_ids(integer)
  to service_role;
grant execute on function public.claim_approved_tool_action(uuid)
  to service_role;
grant execute on function public.complete_tool_action_execution(uuid, text, jsonb, text)
  to service_role;
grant execute on function public.fail_stale_tool_action_executions(timestamptz)
  to service_role;

commit;
