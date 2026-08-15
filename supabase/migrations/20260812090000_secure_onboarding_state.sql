-- Tenant onboarding is written through one authenticated, transactional RPC.
-- Browser clients receive no broad insert or update policies; the function
-- verifies the caller and only mutates the caller's organization.

begin;

create or replace function public.save_onboarding_state(
  p_organization_id uuid,
  p_organization_name text,
  p_workspace_slug text,
  p_timezone text,
  p_plan_code text,
  p_current_step text,
  p_completed_steps jsonb,
  p_state jsonb,
  p_working_hours jsonb,
  p_assistant_name text,
  p_assistant_tone text,
  p_morning_brief_enabled boolean,
  p_morning_brief_time time,
  p_meeting_buffer_minutes integer,
  p_travel_buffer_minutes integer,
  p_external_actions_require_approval boolean,
  p_default_location_label text,
  p_default_location_address text,
  p_activate boolean default false
)
returns table (
  organization_id uuid,
  current_step text,
  onboarding_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_organization_id uuid;
  v_plan_id uuid;
  v_completed_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(trim(p_organization_name)) not between 2 and 160 then
    raise exception 'Organization name must be between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if p_workspace_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(p_workspace_slug) not between 3 and 63 then
    raise exception 'Workspace slug is invalid.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_timezone
  ) then
    raise exception 'Timezone is invalid.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_completed_steps) is distinct from 'array'
    or jsonb_typeof(p_state) is distinct from 'object'
    or jsonb_typeof(p_working_hours) is distinct from 'object' then
    raise exception 'Onboarding state is invalid.' using errcode = '22023';
  end if;

  if p_current_step not in (
    'choose_plan',
    'organization',
    'timezone',
    'working_hours',
    'connect_google',
    'select_calendars',
    'connect_channels',
    'configure_assistant',
    'morning_brief',
    'meeting_rules',
    'approval_rules',
    'important_locations',
    'activate'
  ) then
    raise exception 'Onboarding step is invalid.' using errcode = '22023';
  end if;

  if p_meeting_buffer_minutes not between 0 and 240
    or p_travel_buffer_minutes not between 0 and 240 then
    raise exception 'Meeting buffers must be between 0 and 240 minutes.'
      using errcode = '22023';
  end if;

  select id
    into v_plan_id
    from public.plans
   where code = p_plan_code
     and is_active
     and is_public;

  if v_plan_id is null then
    raise exception 'Selected plan is not available.' using errcode = '22023';
  end if;

  if p_organization_id is null then
    insert into public.organizations (
      name,
      slug,
      timezone,
      created_by
    )
    values (
      trim(p_organization_name),
      p_workspace_slug,
      p_timezone,
      v_actor_id
    )
    returning id into v_organization_id;

    insert into public.memberships (
      organization_id,
      user_id,
      role,
      invited_by
    )
    values (
      v_organization_id,
      v_actor_id,
      'customer_owner',
      v_actor_id
    );
  else
    if not app_private.is_organization_admin(p_organization_id) then
      raise exception 'You cannot administer this organization.'
        using errcode = '42501';
    end if;

    update public.organizations
       set name = trim(p_organization_name),
           slug = p_workspace_slug,
           timezone = p_timezone
     where id = p_organization_id
     returning id into v_organization_id;

    if v_organization_id is null then
      raise exception 'Organization was not found.' using errcode = 'P0002';
    end if;
  end if;

  update public.billing_accounts
     set plan_id = v_plan_id,
         status = case
           when status = 'cancelled' then status
           else 'trial'::public.billing_status
         end
   where organization_id = v_organization_id;

  update public.assistant_preferences
     set assistant_name = trim(p_assistant_name),
         tone = trim(p_assistant_tone),
         timezone = p_timezone,
         working_hours = p_working_hours,
         morning_brief_enabled = p_morning_brief_enabled,
         morning_brief_time = p_morning_brief_time,
         default_meeting_buffer_minutes = p_meeting_buffer_minutes,
         default_travel_buffer_minutes = p_travel_buffer_minutes,
         updated_by = v_actor_id
   where organization_id = v_organization_id;

  insert into public.approval_policies (
    organization_id,
    action,
    required,
    updated_by
  )
  values
    (v_organization_id, 'calendar.create_external', p_external_actions_require_approval, v_actor_id),
    (v_organization_id, 'calendar.move_external', p_external_actions_require_approval, v_actor_id),
    (v_organization_id, 'calendar.cancel', p_external_actions_require_approval, v_actor_id),
    (v_organization_id, 'notification.send_external', p_external_actions_require_approval, v_actor_id)
  on conflict (organization_id, action) do update
    set required = excluded.required,
        updated_by = excluded.updated_by,
        updated_at = now();

  insert into public.automations (
    organization_id,
    type,
    name,
    schedule,
    timezone,
    enabled,
    status,
    configuration,
    created_by
  )
  values (
    v_organization_id,
    'morning_brief',
    'Daily Morning Brief',
    'Weekdays at ' || to_char(p_morning_brief_time, 'HH24:MI'),
    p_timezone,
    p_morning_brief_enabled,
    case
      when p_morning_brief_enabled then 'active'::public.automation_status
      else 'paused'::public.automation_status
    end,
    jsonb_build_object('time', to_char(p_morning_brief_time, 'HH24:MI')),
    v_actor_id
  )
  on conflict (organization_id, type, name) do update
    set schedule = excluded.schedule,
        timezone = excluded.timezone,
        enabled = excluded.enabled,
        status = excluded.status,
        configuration = excluded.configuration,
        updated_at = now();

  if nullif(trim(coalesce(p_default_location_label, '')), '') is not null
    and nullif(trim(coalesce(p_default_location_address, '')), '') is not null then
    update public.important_locations
       set label = trim(p_default_location_label),
           address = trim(p_default_location_address)
     where organization_id = v_organization_id
       and is_default_origin;

    if not found then
      insert into public.important_locations (
        organization_id,
        label,
        address,
        is_default_origin,
        created_by
      )
      values (
        v_organization_id,
        trim(p_default_location_label),
        trim(p_default_location_address),
        true,
        v_actor_id
      );
    end if;
  end if;

  insert into public.onboarding_progress (
    organization_id,
    current_step,
    completed_steps,
    state,
    completed_at
  )
  values (
    v_organization_id,
    p_current_step,
    p_completed_steps,
    p_state,
    case when p_activate then now() else null end
  )
  on conflict (organization_id) do update
    set current_step = excluded.current_step,
        completed_steps = excluded.completed_steps,
        state = excluded.state,
        completed_at = case
          when p_activate then now()
          else public.onboarding_progress.completed_at
        end,
        updated_at = now();

  if p_activate then
    update public.organizations
       set onboarding_completed_at = coalesce(onboarding_completed_at, now()),
           status = case
             when status = 'trial' then 'active'::public.organization_status
             else status
           end
     where id = v_organization_id;
  end if;

  select onboarding_completed_at
    into v_completed_at
    from public.organizations
   where id = v_organization_id;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    result,
    metadata
  )
  values (
    v_organization_id,
    'user',
    v_actor_id,
    'onboarding.saved',
    'organization',
    v_organization_id::text,
    'succeeded',
    jsonb_build_object('step', p_current_step, 'activated', p_activate)
  );

  return query
  select v_organization_id, p_current_step, v_completed_at is not null;
end;
$$;

revoke all on function public.save_onboarding_state(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  boolean,
  time,
  integer,
  integer,
  boolean,
  text,
  text,
  boolean
) from public;

grant execute on function public.save_onboarding_state(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  boolean,
  time,
  integer,
  integer,
  boolean,
  text,
  text,
  boolean
) to authenticated;

create or replace function public.create_oauth_state(
  p_state_hash text,
  p_organization_id uuid,
  p_provider public.integration_provider,
  p_redirect_to text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null
    or not app_private.is_organization_admin(p_organization_id) then
    raise exception 'You cannot manage integrations for this organization.'
      using errcode = '42501';
  end if;

  if char_length(p_state_hash) < 32 or p_expires_at <= now() then
    raise exception 'OAuth state is invalid.' using errcode = '22023';
  end if;

  if p_provider = 'google_calendar'
    and not app_private.has_feature(p_organization_id, 'calendar') then
    raise exception 'Calendar is not enabled for this organization.'
      using errcode = '42501';
  end if;

  delete from private.oauth_states
   where expires_at <= now();

  insert into private.oauth_states (
    state_hash,
    organization_id,
    user_id,
    provider,
    redirect_to,
    expires_at
  )
  values (
    p_state_hash,
    p_organization_id,
    v_actor_id,
    p_provider,
    p_redirect_to,
    p_expires_at
  );
end;
$$;

create or replace function public.consume_oauth_state(
  p_state_hash text,
  p_provider public.integration_provider
)
returns table (
  organization_id uuid,
  redirect_to text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_organization_id uuid;
  v_redirect_to text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  delete from private.oauth_states
   where state_hash = p_state_hash
     and provider = p_provider
     and user_id = v_actor_id
     and expires_at > now()
   returning organization_id, redirect_to
        into v_organization_id, v_redirect_to;

  if v_organization_id is null then
    raise exception 'OAuth state is invalid or expired.' using errcode = '22023';
  end if;

  return query select v_organization_id, v_redirect_to;
end;
$$;

create or replace function public.complete_google_calendar_oauth(
  p_organization_id uuid,
  p_external_account_id text,
  p_display_name text,
  p_scopes text[],
  p_token_expires_at timestamptz,
  p_ciphertext bytea,
  p_initialization_vector bytea,
  p_authentication_tag bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_integration_id uuid;
begin
  if v_actor_id is null
    or not app_private.is_organization_admin(p_organization_id) then
    raise exception 'You cannot manage integrations for this organization.'
      using errcode = '42501';
  end if;

  if not app_private.has_feature(p_organization_id, 'calendar') then
    raise exception 'Calendar is not enabled for this organization.'
      using errcode = '42501';
  end if;

  if nullif(trim(p_external_account_id), '') is null
    or octet_length(p_ciphertext) = 0
    or octet_length(p_initialization_vector) = 0
    or octet_length(p_authentication_tag) = 0 then
    raise exception 'OAuth connection data is invalid.' using errcode = '22023';
  end if;

  insert into public.integrations (
    organization_id,
    provider,
    external_account_id,
    display_name,
    status,
    scopes,
    token_expires_at,
    connected_by,
    connected_at,
    last_successful_sync_at
  )
  values (
    p_organization_id,
    'google_calendar',
    p_external_account_id,
    nullif(trim(p_display_name), ''),
    'connected',
    p_scopes,
    p_token_expires_at,
    v_actor_id,
    now(),
    now()
  )
  on conflict (organization_id, provider, external_account_id) do update
    set display_name = excluded.display_name,
        status = 'connected',
        scopes = excluded.scopes,
        token_expires_at = excluded.token_expires_at,
        connected_by = excluded.connected_by,
        connected_at = excluded.connected_at,
        revoked_at = null,
        last_error_code = null,
        last_error_at = null,
        updated_at = now()
  returning id into v_integration_id;

  insert into private.integration_credentials (
    integration_id,
    ciphertext,
    initialization_vector,
    authentication_tag,
    refreshed_at
  )
  values (
    v_integration_id,
    p_ciphertext,
    p_initialization_vector,
    p_authentication_tag,
    now()
  )
  on conflict (integration_id) do update
    set ciphertext = excluded.ciphertext,
        initialization_vector = excluded.initialization_vector,
        authentication_tag = excluded.authentication_tag,
        refreshed_at = excluded.refreshed_at,
        updated_at = now();

  insert into public.calendar_connections (
    organization_id,
    integration_id,
    access_level,
    sync_status,
    next_sync_at
  )
  values (
    p_organization_id,
    v_integration_id,
    'read_write',
    'connected',
    now()
  )
  on conflict (integration_id) do update
    set access_level = excluded.access_level,
        sync_status = 'connected',
        next_sync_at = excluded.next_sync_at,
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
    'integration.connected',
    'google_calendar',
    'integration',
    v_integration_id::text,
    'succeeded',
    jsonb_build_object('provider', 'google_calendar')
  );

  return v_integration_id;
end;
$$;

revoke all on function public.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) from public;

revoke all on function public.consume_oauth_state(
  text,
  public.integration_provider
) from public;

revoke all on function public.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) from public;

grant execute on function public.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) to authenticated;

grant execute on function public.consume_oauth_state(
  text,
  public.integration_provider
) to authenticated;

grant execute on function public.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) to authenticated;

commit;
