-- Tenant-scoped mutations for customer settings and user-controlled memory.
-- Browser clients execute only these authenticated RPCs; they do not receive
-- table write policies or service-role credentials.

begin;

create or replace function public.save_workspace_preferences(
  p_organization_id uuid,
  p_assistant_name text,
  p_tone text,
  p_timezone text,
  p_working_hours jsonb,
  p_morning_brief_enabled boolean,
  p_morning_brief_time time,
  p_meeting_buffer_minutes integer,
  p_travel_buffer_minutes integer,
  p_external_actions_require_approval boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_assistant_name text := trim(coalesce(p_assistant_name, ''));
  v_tone text := trim(coalesce(p_tone, ''));
  v_timezone text := trim(coalesce(p_timezone, ''));
  v_working_hours jsonb := coalesce(p_working_hours, '{}'::jsonb);
  v_starts_at text := coalesce(v_working_hours ->> 'startsAt', '');
  v_ends_at text := coalesce(v_working_hours ->> 'endsAt', '');
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not app_private.is_organization_admin(p_organization_id) then
    raise exception 'You cannot manage this workspace.' using errcode = '42501';
  end if;

  if char_length(v_assistant_name) not between 1 and 60
    or char_length(v_tone) not between 2 and 240 then
    raise exception 'Assistant settings are invalid.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = v_timezone
  ) then
    raise exception 'Timezone is invalid.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_working_hours) <> 'object'
    or jsonb_typeof(v_working_hours -> 'days') <> 'array'
    or jsonb_array_length(v_working_hours -> 'days') not between 1 and 7
    or exists (
      select 1
      from jsonb_array_elements_text(v_working_hours -> 'days') as day(value)
      where day.value !~ '^[0-6]$'
    )
    or (
      select count(*) <> count(distinct day.value)
      from jsonb_array_elements_text(v_working_hours -> 'days') as day(value)
    ) then
    raise exception 'Working days are invalid.' using errcode = '22023';
  end if;

  if v_starts_at !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    or v_ends_at !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    or v_starts_at::time >= v_ends_at::time then
    raise exception 'Working hours are invalid.' using errcode = '22023';
  end if;

  if p_meeting_buffer_minutes not between 0 and 240
    or p_travel_buffer_minutes not between 0 and 240 then
    raise exception 'Buffer minutes are invalid.' using errcode = '22023';
  end if;

  update public.organizations
     set timezone = v_timezone,
         updated_at = now()
   where id = p_organization_id;

  if not found then
    raise exception 'Workspace was not found.' using errcode = 'P0002';
  end if;

  update public.assistant_preferences
     set assistant_name = v_assistant_name,
         tone = v_tone,
         timezone = v_timezone,
         working_hours = jsonb_build_object(
           'days', v_working_hours -> 'days',
           'startsAt', v_starts_at,
           'endsAt', v_ends_at
         ),
         morning_brief_enabled = p_morning_brief_enabled,
         morning_brief_time = p_morning_brief_time,
         default_meeting_buffer_minutes = p_meeting_buffer_minutes,
         default_travel_buffer_minutes = p_travel_buffer_minutes,
         updated_by = v_actor_id,
         updated_at = now()
   where organization_id = p_organization_id;

  if not found then
    raise exception 'Workspace preferences were not found.' using errcode = 'P0002';
  end if;

  update public.automations
     set timezone = v_timezone,
         updated_at = now()
   where organization_id = p_organization_id;

  update public.onboarding_progress
     set state = coalesce(state, '{}'::jsonb)
       || jsonb_build_object(
         'externalActionsRequireApproval', p_external_actions_require_approval
       ),
         updated_at = now()
   where organization_id = p_organization_id;

  update public.approval_policies
     set required = p_external_actions_require_approval,
         updated_by = v_actor_id,
         updated_at = now()
   where organization_id = p_organization_id
     and action in (
       'calendar.create_external',
       'calendar.move_external',
       'calendar.cancel',
       'email.send',
       'notification.send_external'
     );

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
    'workspace.preferences.updated',
    'workspace_preferences',
    'organization',
    p_organization_id::text,
    'succeeded',
    jsonb_build_object(
      'timezone', v_timezone,
      'morning_brief_enabled', p_morning_brief_enabled,
      'external_actions_require_approval', p_external_actions_require_approval
    )
  );
end;
$$;

create or replace function public.upsert_assistant_memory(
  p_organization_id uuid,
  p_memory_id uuid,
  p_kind public.memory_kind,
  p_key text,
  p_statement text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_key text := trim(coalesce(p_key, ''));
  v_statement text := trim(coalesce(p_statement, ''));
  v_memory public.assistant_memories%rowtype;
  v_memory_id uuid;
  v_action text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not app_private.can_access_organization(p_organization_id) then
    raise exception 'You cannot access this workspace.' using errcode = '42501';
  end if;

  if char_length(v_key) not between 1 and 100
    or char_length(v_statement) not between 1 and 2000 then
    raise exception 'Memory details are invalid.' using errcode = '22023';
  end if;

  if p_memory_id is null then
    insert into public.assistant_memories (
      organization_id,
      owner_user_id,
      kind,
      key,
      value,
      confidence,
      source,
      created_by
    )
    values (
      p_organization_id,
      v_actor_id,
      p_kind,
      v_key,
      jsonb_build_object('statement', v_statement),
      1,
      'user_confirmed',
      v_actor_id
    )
    on conflict (organization_id, owner_user_id, kind, key)
    do update set
      value = excluded.value,
      confidence = 1,
      source = 'user_confirmed',
      expires_at = null,
      created_by = v_actor_id,
      updated_at = now()
    returning id into v_memory_id;
    v_action := 'memory.created';
  else
    select *
      into v_memory
      from public.assistant_memories
     where id = p_memory_id
       and organization_id = p_organization_id
     for update;

    if not found then
      raise exception 'Memory was not found.' using errcode = 'P0002';
    end if;

    if v_memory.owner_user_id is distinct from v_actor_id
      and not app_private.is_organization_admin(p_organization_id) then
      raise exception 'You can only edit your own memory.' using errcode = '42501';
    end if;

    update public.assistant_memories
       set kind = p_kind,
           key = v_key,
           value = jsonb_build_object('statement', v_statement),
           confidence = 1,
           source = 'user_confirmed',
           expires_at = null,
           created_by = v_actor_id,
           updated_at = now()
     where id = v_memory.id
    returning id into v_memory_id;
    v_action := 'memory.updated';
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
    v_action,
    'assistant_memory',
    'assistant_memory',
    v_memory_id::text,
    'succeeded',
    jsonb_build_object('kind', p_kind::text)
  );

  return v_memory_id;
end;
$$;

create or replace function public.delete_assistant_memory(
  p_organization_id uuid,
  p_memory_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_memory public.assistant_memories%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not app_private.can_access_organization(p_organization_id) then
    raise exception 'You cannot access this workspace.' using errcode = '42501';
  end if;

  select *
    into v_memory
    from public.assistant_memories
   where id = p_memory_id
     and organization_id = p_organization_id
   for update;

  if not found then
    raise exception 'Memory was not found.' using errcode = 'P0002';
  end if;

  if v_memory.owner_user_id is distinct from v_actor_id
    and not app_private.is_organization_admin(p_organization_id) then
    raise exception 'You can only delete your own memory.' using errcode = '42501';
  end if;

  delete from public.assistant_memories
   where id = v_memory.id;

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
    'memory.deleted',
    'assistant_memory',
    'assistant_memory',
    v_memory.id::text,
    'succeeded',
    jsonb_build_object('kind', v_memory.kind::text)
  );
end;
$$;

revoke all on function public.save_workspace_preferences(
  uuid, text, text, text, jsonb, boolean, time, integer, integer, boolean
) from public, anon;
revoke all on function public.upsert_assistant_memory(
  uuid, uuid, public.memory_kind, text, text
) from public, anon;
revoke all on function public.delete_assistant_memory(uuid, uuid) from public, anon;

grant execute on function public.save_workspace_preferences(
  uuid, text, text, text, jsonb, boolean, time, integer, integer, boolean
) to authenticated;
grant execute on function public.upsert_assistant_memory(
  uuid, uuid, public.memory_kind, text, text
) to authenticated;
grant execute on function public.delete_assistant_memory(uuid, uuid)
  to authenticated;

commit;
