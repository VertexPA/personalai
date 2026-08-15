-- Keep the public RPC contract, but move the privileged implementation out of
-- the Data API schema. The public functions below are SECURITY INVOKER
-- shims; the original SECURITY DEFINER implementations retain their existing
-- authorization checks in app_private.

-- OAuth state and credential persistence.
alter function public.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) set schema app_private;

revoke all on function app_private.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) from public, anon;
grant execute on function app_private.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) to authenticated, service_role;

create function public.complete_google_calendar_oauth(
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
language sql
security invoker
set search_path = ''
as $$
  select app_private.complete_google_calendar_oauth(
    $1, $2, $3, $4, $5, $6, $7, $8
  );
$$;

revoke all on function public.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) from public, anon;
grant execute on function public.complete_google_calendar_oauth(
  uuid,
  text,
  text,
  text[],
  timestamptz,
  bytea,
  bytea,
  bytea
) to authenticated, service_role;

alter function public.consume_oauth_state(text, public.integration_provider)
  set schema app_private;

revoke all on function app_private.consume_oauth_state(
  text,
  public.integration_provider
) from public, anon;
grant execute on function app_private.consume_oauth_state(
  text,
  public.integration_provider
) to authenticated, service_role;

create function public.consume_oauth_state(
  p_state_hash text,
  p_provider public.integration_provider
)
returns table(organization_id uuid, redirect_to text)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.consume_oauth_state($1, $2);
$$;

revoke all on function public.consume_oauth_state(
  text,
  public.integration_provider
) from public, anon;
grant execute on function public.consume_oauth_state(
  text,
  public.integration_provider
) to authenticated, service_role;

alter function public.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) set schema app_private;

revoke all on function app_private.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) from public, anon;
grant execute on function app_private.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) to authenticated, service_role;

create function public.create_oauth_state(
  p_state_hash text,
  p_organization_id uuid,
  p_provider public.integration_provider,
  p_redirect_to text,
  p_expires_at timestamptz
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.create_oauth_state($1, $2, $3, $4, $5);
$$;

revoke all on function public.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) from public, anon;
grant execute on function public.create_oauth_state(
  text,
  uuid,
  public.integration_provider,
  text,
  timestamptz
) to authenticated, service_role;

-- Onboarding and workspace preferences.
alter function public.save_onboarding_state(
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
) set schema app_private;

revoke all on function app_private.save_onboarding_state(
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
) from public, anon;
grant execute on function app_private.save_onboarding_state(
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
) to authenticated, service_role;

create function public.save_onboarding_state(
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
  p_activate boolean
)
returns table(
  organization_id uuid,
  current_step text,
  onboarding_completed boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.save_onboarding_state(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19
  );
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
) from public, anon;
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
) to authenticated, service_role;

alter function public.save_workspace_preferences(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  time,
  integer,
  integer,
  boolean
) set schema app_private;

revoke all on function app_private.save_workspace_preferences(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  time,
  integer,
  integer,
  boolean
) from public, anon;
grant execute on function app_private.save_workspace_preferences(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  time,
  integer,
  integer,
  boolean
) to authenticated, service_role;

create function public.save_workspace_preferences(
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
language sql
security invoker
set search_path = ''
as $$
  select app_private.save_workspace_preferences(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
  );
$$;

revoke all on function public.save_workspace_preferences(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  time,
  integer,
  integer,
  boolean
) from public, anon;
grant execute on function public.save_workspace_preferences(
  uuid,
  text,
  text,
  text,
  jsonb,
  boolean,
  time,
  integer,
  integer,
  boolean
) to authenticated, service_role;

-- Assistant rules and memory.
alter function public.save_assistant_rule(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  boolean
) set schema app_private;

revoke all on function app_private.save_assistant_rule(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  boolean
) from public, anon;
grant execute on function app_private.save_assistant_rule(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  boolean
) to authenticated, service_role;

create function public.save_assistant_rule(
  p_organization_id uuid,
  p_rule_id uuid,
  p_kind text,
  p_natural_language text,
  p_structured_rule jsonb,
  p_requires_confirmation boolean,
  p_is_active boolean
)
returns table(rule_id uuid, confirmed_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.save_assistant_rule($1, $2, $3, $4, $5, $6, $7);
$$;

revoke all on function public.save_assistant_rule(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  boolean
) from public, anon;
grant execute on function public.save_assistant_rule(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  boolean
) to authenticated, service_role;

alter function public.confirm_assistant_rule(uuid) set schema app_private;

revoke all on function app_private.confirm_assistant_rule(uuid) from public, anon;
grant execute on function app_private.confirm_assistant_rule(uuid)
  to authenticated, service_role;

create function public.confirm_assistant_rule(p_rule_id uuid)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select app_private.confirm_assistant_rule($1);
$$;

revoke all on function public.confirm_assistant_rule(uuid) from public, anon;
grant execute on function public.confirm_assistant_rule(uuid)
  to authenticated, service_role;

alter function public.delete_assistant_rule(uuid) set schema app_private;

revoke all on function app_private.delete_assistant_rule(uuid) from public, anon;
grant execute on function app_private.delete_assistant_rule(uuid)
  to authenticated, service_role;

create function public.delete_assistant_rule(p_rule_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.delete_assistant_rule($1);
$$;

revoke all on function public.delete_assistant_rule(uuid) from public, anon;
grant execute on function public.delete_assistant_rule(uuid)
  to authenticated, service_role;

alter function public.upsert_assistant_memory(
  uuid,
  uuid,
  public.memory_kind,
  text,
  text
) set schema app_private;

revoke all on function app_private.upsert_assistant_memory(
  uuid,
  uuid,
  public.memory_kind,
  text,
  text
) from public, anon;
grant execute on function app_private.upsert_assistant_memory(
  uuid,
  uuid,
  public.memory_kind,
  text,
  text
) to authenticated, service_role;

create function public.upsert_assistant_memory(
  p_organization_id uuid,
  p_memory_id uuid,
  p_kind public.memory_kind,
  p_key text,
  p_statement text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.upsert_assistant_memory($1, $2, $3, $4, $5);
$$;

revoke all on function public.upsert_assistant_memory(
  uuid,
  uuid,
  public.memory_kind,
  text,
  text
) from public, anon;
grant execute on function public.upsert_assistant_memory(
  uuid,
  uuid,
  public.memory_kind,
  text,
  text
) to authenticated, service_role;

alter function public.delete_assistant_memory(uuid, uuid) set schema app_private;

revoke all on function app_private.delete_assistant_memory(uuid, uuid)
  from public, anon;
grant execute on function app_private.delete_assistant_memory(uuid, uuid)
  to authenticated, service_role;

create function public.delete_assistant_memory(
  p_organization_id uuid,
  p_memory_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.delete_assistant_memory($1, $2);
$$;

revoke all on function public.delete_assistant_memory(uuid, uuid) from public, anon;
grant execute on function public.delete_assistant_memory(uuid, uuid)
  to authenticated, service_role;

-- Approval and controlled calendar actions.
alter function public.decide_approval_request(uuid, text, text)
  set schema app_private;

revoke all on function app_private.decide_approval_request(uuid, text, text)
  from public, anon;
grant execute on function app_private.decide_approval_request(uuid, text, text)
  to authenticated, service_role;

create function public.decide_approval_request(
  p_approval_request_id uuid,
  p_decision text,
  p_note text
)
returns table(
  approval_request_id uuid,
  approval_status public.approval_status,
  tool_action_status public.tool_action_status
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.decide_approval_request($1, $2, $3);
$$;

revoke all on function public.decide_approval_request(uuid, text, text)
  from public, anon;
grant execute on function public.decide_approval_request(uuid, text, text)
  to authenticated, service_role;

alter function public.request_calendar_tool_action(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  timestamptz
) set schema app_private;

revoke all on function app_private.request_calendar_tool_action(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  timestamptz
) from public, anon;
grant execute on function app_private.request_calendar_tool_action(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  timestamptz
) to authenticated, service_role;

create function public.request_calendar_tool_action(
  p_organization_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_payload jsonb,
  p_request_fingerprint text,
  p_summary text,
  p_expires_at timestamptz
)
returns table(
  tool_action_id uuid,
  approval_request_id uuid,
  action text,
  tool_action_status public.tool_action_status,
  approval_status public.approval_status
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.request_calendar_tool_action(
    $1, $2, $3, $4, $5, $6, $7
  );
$$;

revoke all on function public.request_calendar_tool_action(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  timestamptz
) from public, anon;
grant execute on function public.request_calendar_tool_action(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  timestamptz
) to authenticated, service_role;

-- Google Calendar selection.
alter function public.save_google_calendar_selection(uuid, text[], text)
  set schema app_private;

revoke all on function app_private.save_google_calendar_selection(uuid, text[], text)
  from public, anon;
grant execute on function app_private.save_google_calendar_selection(uuid, text[], text)
  to authenticated, service_role;

create function public.save_google_calendar_selection(
  p_calendar_connection_id uuid,
  p_selected_calendar_ids text[],
  p_primary_calendar_external_id text
)
returns table(selected_count integer, primary_calendar_external_id text)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.save_google_calendar_selection($1, $2, $3);
$$;

revoke all on function public.save_google_calendar_selection(uuid, text[], text)
  from public, anon;
grant execute on function public.save_google_calendar_selection(uuid, text[], text)
  to authenticated, service_role;

-- Platform administration operations.
alter function public.platform_set_customer_plan(uuid, text) set schema app_private;

revoke all on function app_private.platform_set_customer_plan(uuid, text)
  from public, anon;
grant execute on function app_private.platform_set_customer_plan(uuid, text)
  to authenticated, service_role;

create function public.platform_set_customer_plan(
  p_organization_id uuid,
  p_plan_code text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.platform_set_customer_plan($1, $2);
$$;

revoke all on function public.platform_set_customer_plan(uuid, text)
  from public, anon;
grant execute on function public.platform_set_customer_plan(uuid, text)
  to authenticated, service_role;

alter function public.platform_save_customer_entitlement_override(
  uuid,
  text,
  boolean,
  integer,
  text,
  timestamptz
) set schema app_private;

revoke all on function app_private.platform_save_customer_entitlement_override(
  uuid,
  text,
  boolean,
  integer,
  text,
  timestamptz
) from public, anon;
grant execute on function app_private.platform_save_customer_entitlement_override(
  uuid,
  text,
  boolean,
  integer,
  text,
  timestamptz
) to authenticated, service_role;

create function public.platform_save_customer_entitlement_override(
  p_organization_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_limit_value integer,
  p_reason text,
  p_expires_at timestamptz
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.platform_save_customer_entitlement_override(
    $1, $2, $3, $4, $5, $6
  );
$$;

revoke all on function public.platform_save_customer_entitlement_override(
  uuid,
  text,
  boolean,
  integer,
  text,
  timestamptz
) from public, anon;
grant execute on function public.platform_save_customer_entitlement_override(
  uuid,
  text,
  boolean,
  integer,
  text,
  timestamptz
) to authenticated, service_role;

alter function public.platform_remove_customer_entitlement_override(uuid, text)
  set schema app_private;

revoke all on function app_private.platform_remove_customer_entitlement_override(
  uuid,
  text
) from public, anon;
grant execute on function app_private.platform_remove_customer_entitlement_override(
  uuid,
  text
) to authenticated, service_role;

create function public.platform_remove_customer_entitlement_override(
  p_organization_id uuid,
  p_feature_key text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.platform_remove_customer_entitlement_override($1, $2);
$$;

revoke all on function public.platform_remove_customer_entitlement_override(
  uuid,
  text
) from public, anon;
grant execute on function public.platform_remove_customer_entitlement_override(
  uuid,
  text
) to authenticated, service_role;

-- New functions stay private-by-default. Explicit grants in future migrations
-- are now required for any deliberately exposed RPC.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
