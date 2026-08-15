-- Ordinary inbound assistant replies are response-only and can be delivered
-- automatically. Provider-capable calendar and other high-risk actions keep
-- their existing approval workflow.

begin;

-- Move only legacy response-only agent replies out of the old blanket
-- approval gate. The idempotency key is generated exclusively by
-- complete_inbound_agent_run, so unrelated external actions are untouched.
with transitioned_actions as (
  update public.tool_actions as tool_action
     set risk_level = 'low',
         status = 'approved',
         updated_at = now()
   where tool_action.action = 'notification.send_external'
     and tool_action.tool_name = 'notification_delivery'
     and tool_action.agent_run_id is not null
     and tool_action.idempotency_key = 'agent-reply:' || tool_action.agent_run_id::text
     and tool_action.risk_level = 'high'
     and tool_action.status = 'awaiting_approval'
  returning tool_action.id, tool_action.organization_id, tool_action.agent_run_id
),
cleared_approvals as (
  delete from public.approval_requests as approval
   using transitioned_actions as transitioned
   where approval.tool_action_id = transitioned.id
     and approval.organization_id = transitioned.organization_id
     and approval.status = 'pending'
  returning approval.tool_action_id
)
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
select
  transitioned.organization_id,
  'system',
  'agent_reply.delivery_policy.updated',
  'inbound_agent_policy',
  'tool_action',
  transitioned.id::text,
  'succeeded',
  jsonb_build_object(
    'delivery_policy', 'automatic_low_risk',
    'superseded_pending_approval', exists (
      select 1
      from cleared_approvals as cleared
      where cleared.tool_action_id = transitioned.id
    ),
    'agent_run_id', transitioned.agent_run_id
  )
from transitioned_actions as transitioned;

update public.agent_runs as agent_run
   set output_summary = 'Reply queued for automatic low-risk external delivery.',
       updated_at = now()
 where agent_run.output_summary = 'Reply proposed and awaiting controlled external delivery approval.'
   and exists (
     select 1
     from public.tool_actions as tool_action
     where tool_action.agent_run_id = agent_run.id
       and tool_action.action = 'notification.send_external'
       and tool_action.tool_name = 'notification_delivery'
       and tool_action.idempotency_key = 'agent-reply:' || agent_run.id::text
       and tool_action.risk_level = 'low'
       and tool_action.status in ('approved', 'executing', 'succeeded')
   );

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
as $function$
declare
  v_run public.agent_runs%rowtype;
  v_session public.conversation_sessions%rowtype;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_error_code text := nullif(btrim(coalesce(p_error_code, '')), '');
  v_idempotency_key text;
  v_tool_action_id uuid;
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

  -- The LLM adapter is response-only: it cannot invoke tools or mutate tenant
  -- data. Its normal conversational reply is therefore a low-risk, durable
  -- delivery action. High-risk actions use their separate approval workflow.
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
    'low',
    'approved',
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

  update public.agent_runs
     set status = 'succeeded',
         provider = v_provider,
         model = v_model,
         output_summary = 'Reply queued for automatic low-risk external delivery.',
         completed_at = now(),
         updated_at = now()
   where id = v_run.id;

  insert into public.audit_logs (
    organization_id, actor_type, action, tool_name, target_type, target_id,
    result, metadata
  )
  values (
    v_run.organization_id, 'agent', 'agent_run.reply_queued', 'inbound_agent_worker',
    'agent_run', v_run.id::text, 'succeeded',
    jsonb_build_object(
      'tool_action_id', v_tool_action_id,
      'delivery_policy', 'automatic_low_risk'
    )
  );

  return query select v_tool_action_id, null::uuid;
end;
$function$;

revoke all on function public.complete_inbound_agent_run(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_inbound_agent_run(uuid, text, text, text, text, text)
  to service_role;

commit;
