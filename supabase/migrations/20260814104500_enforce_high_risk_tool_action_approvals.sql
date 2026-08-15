-- Defense in depth: a worker may auto-run low and medium actions that have no
-- approval record, but high and critical actions must always carry an approved
-- approval request before either queue discovery or the final claim succeeds.

begin;

create or replace function public.list_approved_tool_action_ids(
  p_limit integer default 50
)
returns table (tool_action_id uuid)
language sql
security definer
set search_path = ''
as $function$
  select tool_action.id
  from public.tool_actions as tool_action
  where tool_action.status = 'approved'
    and (
      (
        tool_action.risk_level in ('low', 'medium')
        and not exists (
          select 1
          from public.approval_requests as approval
          where approval.tool_action_id = tool_action.id
        )
      )
      or exists (
        select 1
        from public.approval_requests as approval
        where approval.tool_action_id = tool_action.id
          and approval.status = 'approved'
      )
    )
  order by tool_action.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

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
as $function$
#variable_conflict use_column
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

  if (
    v_action.risk_level in ('high', 'critical')
    and not exists (
      select 1
      from public.approval_requests as approval
      where approval.tool_action_id = v_action.id
        and approval.status = 'approved'
    )
  ) or exists (
    select 1
    from public.approval_requests as approval
    where approval.tool_action_id = v_action.id
      and approval.status <> 'approved'
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
      select 1
      from public.approval_requests as approval
      where approval.tool_action_id = v_action.id
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
$function$;

revoke all on function public.list_approved_tool_action_ids(integer)
  from public, anon, authenticated;
revoke all on function public.claim_approved_tool_action(uuid)
  from public, anon, authenticated;
grant execute on function public.list_approved_tool_action_ids(integer)
  to service_role;
grant execute on function public.claim_approved_tool_action(uuid)
  to service_role;

commit;
