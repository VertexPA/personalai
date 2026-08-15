-- Inbound webhook rows hand off to a durable agent queue. An agent may propose
-- a reply, but it can only become a notification after a tenant administrator
-- approves the linked controlled action. Delivery remains a separate durable
-- worker with its own provider idempotency record.

begin;

alter table public.agent_runs
  add column if not exists input_message_id uuid
    references public.conversation_messages (id) on delete set null,
  add column if not exists execution_attempts integer not null default 0
    check (execution_attempts >= 0);

create index if not exists agent_runs_inbound_queue_idx
  on public.agent_runs (created_at asc)
  where status = 'queued' and provider = 'inbound_queue';

create or replace function public.assign_inbound_agent_run_input_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
begin
  if new.provider = 'inbound_queue' and new.input_message_id is null then
    if new.session_id is null then
      raise exception 'Inbound agent runs require a conversation session.'
        using errcode = '22023';
    end if;

    select conversation_messages.id
      into v_message_id
      from public.conversation_messages
     where conversation_messages.organization_id = new.organization_id
       and conversation_messages.session_id = new.session_id
       and conversation_messages.direction = 'inbound'
     order by conversation_messages.created_at desc, conversation_messages.id desc
     limit 1;

    if v_message_id is null then
      raise exception 'Inbound agent runs require an inbound message.'
        using errcode = '22023';
    end if;

    new.input_message_id := v_message_id;
  end if;

  return new;
end;
$$;

drop trigger if exists agent_runs_assign_inbound_input_message on public.agent_runs;
create trigger agent_runs_assign_inbound_input_message
  before insert or update of provider, session_id, input_message_id
  on public.agent_runs
  for each row execute procedure public.assign_inbound_agent_run_input_message();

create or replace function public.list_queued_inbound_agent_run_ids(
  p_limit integer default 50
)
returns table (agent_run_id uuid)
language sql
security definer
set search_path = ''
as $$
  select agent_runs.id
  from public.agent_runs
  where agent_runs.provider = 'inbound_queue'
    and agent_runs.status = 'queued'
  order by agent_runs.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.claim_queued_inbound_agent_run(
  p_agent_run_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  session_id uuid,
  input_message_id uuid,
  user_id uuid,
  channel public.conversation_channel,
  external_conversation_id text,
  message_body text,
  execution_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_session public.conversation_sessions%rowtype;
  v_message public.conversation_messages%rowtype;
begin
  select *
    into v_run
    from public.agent_runs
   where id = p_agent_run_id
     and provider = 'inbound_queue'
     and status = 'queued'
   for update skip locked;

  if not found then
    return;
  end if;

  select *
    into v_session
    from public.conversation_sessions
   where id = v_run.session_id
     and organization_id = v_run.organization_id;

  select *
    into v_message
    from public.conversation_messages
   where id = v_run.input_message_id
     and session_id = v_run.session_id
     and organization_id = v_run.organization_id
     and direction = 'inbound';

  if not found or v_session.id is null
    or nullif(btrim(coalesce(v_message.body, '')), '') is null then
    update public.agent_runs
       set status = 'failed',
           error_code = 'inbound_message_unavailable',
           completed_at = now(),
           updated_at = now()
     where id = v_run.id;

    insert into public.audit_logs (
      organization_id, actor_type, action, tool_name, target_type, target_id,
      result, error_code
    )
    values (
      v_run.organization_id, 'system', 'agent_run.failed', 'inbound_agent_worker',
      'agent_run', v_run.id::text, 'failed', 'inbound_message_unavailable'
    );
    return;
  end if;

  update public.agent_runs
     set status = 'running',
         started_at = now(),
         execution_attempts = execution_attempts + 1,
         updated_at = now()
   where id = v_run.id
   returning * into v_run;

  insert into public.audit_logs (
    organization_id, actor_type, action, tool_name, target_type, target_id,
    result, metadata
  )
  values (
    v_run.organization_id, 'system', 'agent_run.started', 'inbound_agent_worker',
    'agent_run', v_run.id::text, 'requested',
    jsonb_build_object('attempt', v_run.execution_attempts)
  );

  return query
  select
    v_run.id,
    v_run.organization_id,
    v_run.session_id,
    v_run.input_message_id,
    v_session.user_id,
    v_session.channel,
    v_session.external_conversation_id,
    v_message.body,
    v_run.execution_attempts;
end;
$$;

create or replace function public.complete_inbound_agent_run(
  p_agent_run_id uuid,
  p_outcome text,
  p_reply text default null,
  p_provider text default null,
  p_model text default null,
  p_error_code text default null
)
returns table (
  tool_action_id uuid,
  approval_request_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_session public.conversation_sessions%rowtype;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_error_code text := nullif(btrim(coalesce(p_error_code, '')), '');
  v_idempotency_key text;
  v_tool_action_id uuid;
  v_approval_request_id uuid;
begin
  if p_outcome is null or p_outcome not in ('succeeded', 'failed') then
    raise exception 'Inbound agent outcome is invalid.' using errcode = '22023';
  end if;

  if p_outcome = 'succeeded' and (
    v_reply is null or char_length(v_reply) > 4000
    or v_provider is null or v_provider !~ '^[a-z0-9_-]{3,64}$'
    or v_model is not null and char_length(v_model) > 256
  ) then
    raise exception 'Inbound agent reply is invalid.' using errcode = '22023';
  end if;

  if p_outcome = 'failed' and (
    v_error_code is null or v_error_code !~ '^[a-z0-9_]{3,96}$'
  ) then
    raise exception 'Inbound agent error is invalid.' using errcode = '22023';
  end if;

  select *
    into v_run
    from public.agent_runs
   where id = p_agent_run_id
     and provider = 'inbound_queue'
     and status = 'running'
   for update;

  if not found then
    raise exception 'Inbound agent run is not running.' using errcode = 'P0001';
  end if;

  if p_outcome = 'failed' then
    update public.agent_runs
       set status = 'failed',
           error_code = v_error_code,
           completed_at = now(),
           updated_at = now()
     where id = v_run.id;

    insert into public.audit_logs (
      organization_id, actor_type, action, tool_name, target_type, target_id,
      result, error_code
    )
    values (
      v_run.organization_id, 'system', 'agent_run.failed', 'inbound_agent_worker',
      'agent_run', v_run.id::text, 'failed', v_error_code
    );
    return;
  end if;

  select *
    into v_session
    from public.conversation_sessions
   where id = v_run.session_id
     and organization_id = v_run.organization_id;

  if not found
    or v_session.channel not in ('whatsapp', 'telegram')
    or nullif(btrim(coalesce(v_session.external_conversation_id, '')), '') is null then
    raise exception 'Inbound conversation cannot receive an external reply.'
      using errcode = '22023';
  end if;

  v_idempotency_key := 'agent-reply:' || v_run.id::text;

  insert into public.tool_actions (
    organization_id,
    agent_run_id,
    action,
    tool_name,
    risk_level,
    status,
    idempotency_key,
    request_fingerprint,
    request_payload
  )
  values (
    v_run.organization_id,
    v_run.id,
    'notification.send_external',
    'notification_delivery',
    'high',
    'awaiting_approval',
    v_idempotency_key,
    '',
    jsonb_build_object(
      'channel', v_session.channel::text,
      'recipient', v_session.external_conversation_id,
      'body', v_reply,
      'conversationSessionId', v_session.id::text,
      'agentRunId', v_run.id::text
    )
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_tool_action_id;

  if v_tool_action_id is null then
    select id
      into v_tool_action_id
      from public.tool_actions
     where organization_id = v_run.organization_id
       and idempotency_key = v_idempotency_key;
  end if;

  insert into public.approval_requests (
    organization_id,
    tool_action_id,
    action,
    summary,
    status,
    idempotency_key,
    expires_at
  )
  values (
    v_run.organization_id,
    v_tool_action_id,
    'notification.send_external',
    'Send Ava reply to the active ' || v_session.channel::text || ' conversation.',
    'pending',
    v_idempotency_key,
    now() + interval '24 hours'
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_approval_request_id;

  if v_approval_request_id is null then
    select id
      into v_approval_request_id
      from public.approval_requests
     where organization_id = v_run.organization_id
       and idempotency_key = v_idempotency_key;
  end if;

  update public.agent_runs
     set status = 'succeeded',
         provider = v_provider,
         model = v_model,
         output_summary = 'Reply proposed and awaiting controlled external delivery approval.',
         completed_at = now(),
         updated_at = now()
   where id = v_run.id;

  insert into public.audit_logs (
    organization_id, actor_type, action, tool_name, target_type, target_id,
    result, metadata
  )
  values (
    v_run.organization_id, 'agent', 'agent_run.reply_proposed', 'inbound_agent_worker',
    'agent_run', v_run.id::text, 'succeeded',
    jsonb_build_object('tool_action_id', v_tool_action_id, 'approval_request_id', v_approval_request_id)
  );

  return query select v_tool_action_id, v_approval_request_id;
end;
$$;

create or replace function public.fail_stale_inbound_agent_runs(
  p_started_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_failed_count integer := 0;
begin
  for v_run in
    select *
      from public.agent_runs
     where provider = 'inbound_queue'
       and status = 'running'
       and started_at <= p_started_before
     for update skip locked
  loop
    update public.agent_runs
       set status = 'failed',
           error_code = 'agent_execution_timeout_unknown_outcome',
           completed_at = now(),
           updated_at = now()
     where id = v_run.id;

    insert into public.audit_logs (
      organization_id, actor_type, action, tool_name, target_type, target_id,
      result, error_code
    )
    values (
      v_run.organization_id, 'system', 'agent_run.failed', 'inbound_agent_worker',
      'agent_run', v_run.id::text, 'failed', 'agent_execution_timeout_unknown_outcome'
    );
    v_failed_count := v_failed_count + 1;
  end loop;

  return v_failed_count;
end;
$$;

create or replace function public.enqueue_approved_notification_action(
  p_tool_action_id uuid
)
returns table (notification_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.tool_actions%rowtype;
  v_channel text;
  v_recipient text;
  v_body text;
  v_session_id uuid;
  v_agent_run_id uuid;
  v_notification_id uuid;
begin
  select *
    into v_action
    from public.tool_actions
   where id = p_tool_action_id
     and action = 'notification.send_external'
     and tool_name = 'notification_delivery'
     and status = 'executing'
   for update;

  if not found then
    raise exception 'Controlled notification action is not executing.'
      using errcode = 'P0001';
  end if;

  v_channel := nullif(btrim(coalesce(v_action.request_payload ->> 'channel', '')), '');
  v_recipient := nullif(btrim(coalesce(v_action.request_payload ->> 'recipient', '')), '');
  v_body := nullif(btrim(coalesce(v_action.request_payload ->> 'body', '')), '');

  if v_channel is null or v_channel not in ('whatsapp', 'telegram')
    or v_recipient is null or char_length(v_recipient) > 512
    or v_body is null or char_length(v_body) > 4000
    or coalesce(v_action.request_payload ->> 'conversationSessionId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_action.request_payload ->> 'agentRunId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Controlled notification payload is invalid.' using errcode = '22023';
  end if;

  v_session_id := (v_action.request_payload ->> 'conversationSessionId')::uuid;
  v_agent_run_id := (v_action.request_payload ->> 'agentRunId')::uuid;

  if not exists (
    select 1
    from public.conversation_sessions
    where id = v_session_id
      and organization_id = v_action.organization_id
      and channel::text = v_channel
      and external_conversation_id = v_recipient
  ) or not exists (
    select 1
    from public.agent_runs
    where id = v_agent_run_id
      and organization_id = v_action.organization_id
  ) then
    raise exception 'Controlled notification target is unavailable.' using errcode = 'P0002';
  end if;

  insert into public.notifications (
    organization_id,
    channel,
    notification_type,
    subject,
    body,
    payload,
    status,
    idempotency_key
  )
  values (
    v_action.organization_id,
    v_channel::public.conversation_channel,
    'assistant_reply',
    'Ava reply',
    v_body,
    jsonb_build_object(
      'recipient', v_recipient,
      'conversationSessionId', v_session_id::text,
      'agentRunId', v_agent_run_id::text
    ),
    'queued',
    'controlled-notification:' || v_action.id::text
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select id
      into v_notification_id
      from public.notifications
     where organization_id = v_action.organization_id
       and idempotency_key = 'controlled-notification:' || v_action.id::text;
  end if;

  insert into public.audit_logs (
    organization_id, actor_type, action, tool_name, target_type, target_id,
    result, metadata
  )
  values (
    v_action.organization_id, 'system', 'notification.queued',
    'controlled_notification_executor', 'notification', v_notification_id::text,
    'requested', jsonb_build_object('tool_action_id', v_action.id, 'channel', v_channel)
  );

  return query select v_notification_id;
end;
$$;

create or replace function public.record_sent_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_session_id uuid;
begin
  if new.status not in ('sent', 'delivered')
    or nullif(btrim(coalesce(new.provider_message_id, '')), '') is null then
    return new;
  end if;

  select *
    into v_notification
    from public.notifications
   where id = new.notification_id;

  if not found
    or coalesce(v_notification.payload ->> 'conversationSessionId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  v_session_id := (v_notification.payload ->> 'conversationSessionId')::uuid;
  if not exists (
    select 1
    from public.conversation_sessions
    where id = v_session_id
      and organization_id = v_notification.organization_id
      and channel = v_notification.channel
  ) then
    return new;
  end if;

  insert into public.conversation_messages (
    organization_id,
    session_id,
    external_message_id,
    direction,
    sender_type,
    body,
    sent_at
  )
  values (
    v_notification.organization_id,
    v_session_id,
    new.provider_message_id,
    'outbound',
    'assistant',
    v_notification.body,
    now()
  )
  on conflict (session_id, external_message_id) do nothing;

  update public.conversation_sessions
     set last_message_at = now(),
         updated_at = now()
   where id = v_session_id;

  return new;
end;
$$;

drop trigger if exists notification_deliveries_record_conversation_message
  on public.notification_deliveries;
create trigger notification_deliveries_record_conversation_message
  after insert on public.notification_deliveries
  for each row execute procedure public.record_sent_conversation_message();

revoke all on function public.assign_inbound_agent_run_input_message() from public, anon, authenticated;
revoke all on function public.list_queued_inbound_agent_run_ids(integer)
  from public, anon, authenticated;
revoke all on function public.claim_queued_inbound_agent_run(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_inbound_agent_run(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_stale_inbound_agent_runs(timestamptz)
  from public, anon, authenticated;
revoke all on function public.enqueue_approved_notification_action(uuid)
  from public, anon, authenticated;
revoke all on function public.record_sent_conversation_message() from public, anon, authenticated;

grant execute on function public.list_queued_inbound_agent_run_ids(integer)
  to service_role;
grant execute on function public.claim_queued_inbound_agent_run(uuid)
  to service_role;
grant execute on function public.complete_inbound_agent_run(uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.fail_stale_inbound_agent_runs(timestamptz)
  to service_role;
grant execute on function public.enqueue_approved_notification_action(uuid)
  to service_role;

commit;
