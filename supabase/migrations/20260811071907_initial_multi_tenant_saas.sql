-- Agentic Executive Assistant SaaS: initial multi-tenant foundation.
--
-- This migration deliberately keeps credentials outside the public schema, enables
-- RLS on every application table, and treats browser access as read-mostly.
-- Mutations that can affect a tenant, plan, integration, or external system are
-- performed by the application's server-side data access layer after authorization.

begin;

create extension if not exists pgcrypto;

create schema if not exists app_private;
create schema if not exists private;
revoke all on schema app_private from public;
revoke all on schema private from public;

create type public.platform_role as enum (
  'platform_admin'
);

create type public.membership_role as enum (
  'customer_owner',
  'customer_admin',
  'customer_member',
  'assistant_user'
);

create type public.organization_status as enum (
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled'
);

create type public.billing_status as enum (
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled'
);

create type public.integration_provider as enum (
  'google_calendar',
  'gmail',
  'whatsapp',
  'telegram',
  'slack',
  'google_routes'
);

create type public.integration_status as enum (
  'not_connected',
  'connected',
  'needs_reauth',
  'revoked',
  'error',
  'disabled'
);

create type public.calendar_access_level as enum (
  'read_only',
  'read_write'
);

create type public.conversation_channel as enum (
  'web',
  'whatsapp',
  'telegram',
  'slack'
);

create type public.approval_status as enum (
  'pending',
  'approved',
  'rejected',
  'expired',
  'executed'
);

create type public.tool_action_status as enum (
  'requested',
  'awaiting_approval',
  'approved',
  'executing',
  'succeeded',
  'failed',
  'cancelled'
);

create type public.notification_status as enum (
  'queued',
  'sent',
  'delivered',
  'failed',
  'cancelled'
);

create type public.automation_status as enum (
  'active',
  'paused',
  'failed',
  'disabled'
);

create type public.memory_kind as enum (
  'preference',
  'contact',
  'location',
  'instruction',
  'context'
);

create type public.audit_actor_type as enum (
  'user',
  'agent',
  'system',
  'integration'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.platform_role not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 3 and 63
  ),
  name text not null check (char_length(name) between 2 and 160),
  status public.organization_status not null default 'trial',
  timezone text not null default 'UTC',
  currency_code text not null default 'MYR' check (char_length(currency_code) = 3),
  onboarding_completed_at timestamptz,
  suspended_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null default 'assistant_user',
  is_active boolean not null default true,
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_organization_id_idx on public.memberships (organization_id);

create table public.onboarding_progress (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  current_step text not null default 'create_account',
  completed_steps jsonb not null default '[]'::jsonb,
  state jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  description text,
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  price_minor integer not null default 0 check (price_minor >= 0),
  currency_code text not null default 'MYR' check (char_length(currency_code) = 3),
  limits jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.features (
  key text primary key check (key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  name text not null,
  description text not null,
  category text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  feature_key text not null references public.features (key) on delete cascade,
  enabled boolean not null default false,
  limit_value integer check (limit_value is null or limit_value >= 0),
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, feature_key)
);

create index plan_entitlements_plan_id_idx on public.plan_entitlements (plan_id);

create table public.customer_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_key text not null references public.features (key) on delete cascade,
  enabled boolean not null,
  limit_value integer check (limit_value is null or limit_value >= 0),
  configuration jsonb not null default '{}'::jsonb,
  reason text,
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, feature_key)
);

create index customer_entitlements_organization_id_idx
  on public.customer_entitlements (organization_id);

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  status public.billing_status not null default 'trial',
  provider text,
  provider_customer_id text,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_customer_id)
);

create table public.billing_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  billing_account_id uuid references public.billing_accounts (id) on delete set null,
  provider text,
  provider_record_id text,
  record_type text not null,
  amount_minor integer,
  currency_code text check (currency_code is null or char_length(currency_code) = 3),
  status text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_record_id)
);

create index billing_records_organization_id_idx on public.billing_records (organization_id, occurred_at desc);

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null,
  quantity numeric(18, 6) not null default 1 check (quantity >= 0),
  unit text not null default 'count',
  estimated_cost_minor integer check (estimated_cost_minor is null or estimated_cost_minor >= 0),
  currency_code text not null default 'USD' check (char_length(currency_code) = 3),
  source_type text,
  source_id text,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index usage_records_organization_metric_idx
  on public.usage_records (organization_id, metric, occurred_at desc);

create table public.assistant_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  assistant_name text not null default 'Ava',
  tone text not null default 'calm, proactive, executive',
  timezone text not null default 'UTC',
  working_hours jsonb not null default '{}'::jsonb,
  morning_brief_enabled boolean not null default true,
  morning_brief_time time not null default '07:30',
  default_meeting_buffer_minutes integer not null default 15
    check (default_meeting_buffer_minutes between 0 and 240),
  default_travel_buffer_minutes integer not null default 15
    check (default_travel_buffer_minutes between 0 and 240),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assistant_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  kind text not null,
  natural_language text,
  structured_rule jsonb not null default '{}'::jsonb,
  requires_confirmation boolean not null default false,
  confirmed_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_rules_organization_id_idx
  on public.assistant_rules (organization_id, is_active);

create table public.assistant_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_user_id uuid references public.profiles (id) on delete set null,
  kind public.memory_kind not null,
  key text not null,
  value jsonb not null,
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  source text not null default 'user_confirmed',
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, owner_user_id, kind, key)
);

create index assistant_memories_organization_id_idx
  on public.assistant_memories (organization_id, kind);

create table public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  action text not null,
  required boolean not null default true,
  conditions jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, action)
);

create index approval_policies_organization_id_idx
  on public.approval_policies (organization_id);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.integration_provider not null,
  external_account_id text,
  display_name text,
  status public.integration_status not null default 'not_connected',
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_account_id)
);

create index integrations_organization_provider_idx
  on public.integrations (organization_id, provider);

create table private.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null unique references public.integrations (id) on delete cascade,
  ciphertext bytea not null,
  initialization_vector bytea not null,
  authentication_tag bytea not null,
  key_version smallint not null default 1 check (key_version > 0),
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.oauth_states (
  state_hash text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider public.integration_provider not null,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null unique references public.integrations (id) on delete cascade,
  access_level public.calendar_access_level not null default 'read_only',
  primary_calendar_external_id text,
  sync_status public.integration_status not null default 'not_connected',
  last_synced_at timestamptz,
  next_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_connections_organization_id_idx
  on public.calendar_connections (organization_id);

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  calendar_connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  external_calendar_id text not null,
  name text not null,
  color text,
  timezone text,
  is_primary boolean not null default false,
  is_personal boolean not null default false,
  is_business boolean not null default false,
  can_read boolean not null default true,
  can_write boolean not null default false,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_connection_id, external_calendar_id)
);

create index calendars_organization_id_idx on public.calendars (organization_id);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  external_event_id text not null,
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  event_timezone text,
  is_all_day boolean not null default false,
  is_cancelled boolean not null default false,
  attendees jsonb not null default '[]'::jsonb,
  organizer jsonb not null default '{}'::jsonb,
  recurrence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (calendar_id, external_event_id)
);

create index calendar_events_schedule_idx
  on public.calendar_events (organization_id, starts_at, ends_at)
  where not is_cancelled;

create table public.important_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null,
  address text not null,
  provider_place_id text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_default_origin boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    latitude is null or (latitude between -90 and 90)
  ),
  check (
    longitude is null or (longitude between -180 and 180)
  )
);

create index important_locations_organization_id_idx
  on public.important_locations (organization_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  display_name text not null,
  email text,
  phone text,
  external_id text,
  importance smallint not null default 0 check (importance between 0 and 5),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id)
);

create index contacts_organization_id_idx on public.contacts (organization_id, importance desc);

create table public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  integration_id uuid references public.integrations (id) on delete set null,
  channel public.conversation_channel not null,
  external_conversation_id text,
  title text,
  status text not null default 'active' check (status in ('active', 'archived', 'closed')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, external_conversation_id)
);

create index conversation_sessions_organization_id_idx
  on public.conversation_sessions (organization_id, last_message_at desc);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.conversation_sessions (id) on delete cascade,
  external_message_id text,
  direction text not null check (direction in ('inbound', 'outbound', 'system')),
  sender_type text not null check (sender_type in ('user', 'assistant', 'system', 'integration')),
  body text,
  attachment_metadata jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, external_message_id)
);

create index conversation_messages_session_id_idx
  on public.conversation_messages (session_id, sent_at);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid references public.conversation_sessions (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  provider text not null,
  model text,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_summary text,
  output_summary text,
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  estimated_cost_minor integer check (estimated_cost_minor is null or estimated_cost_minor >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_runs_organization_id_idx
  on public.agent_runs (organization_id, created_at desc);

create table public.tool_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  action text not null,
  tool_name text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  status public.tool_action_status not null default 'requested',
  idempotency_key text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_code text,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index tool_actions_organization_status_idx
  on public.tool_actions (organization_id, status, created_at desc);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tool_action_id uuid not null unique references public.tool_actions (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_for uuid references public.profiles (id) on delete set null,
  action text not null,
  summary text not null,
  status public.approval_status not null default 'pending',
  idempotency_key text not null,
  expires_at timestamptz,
  decision_by uuid references public.profiles (id) on delete set null,
  decision_note text,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index approval_requests_queue_idx
  on public.approval_requests (organization_id, status, created_at desc);

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope text not null,
  key text not null,
  request_fingerprint text not null,
  status text not null check (status in ('in_progress', 'succeeded', 'failed')),
  response jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, scope, key)
);

create index idempotency_records_expiry_idx
  on public.idempotency_records (expires_at);

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null,
  name text not null,
  schedule text not null,
  timezone text not null,
  enabled boolean not null default true,
  status public.automation_status not null default 'active',
  configuration jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, type, name)
);

create index automations_schedule_idx
  on public.automations (enabled, next_run_at)
  where enabled;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  idempotency_key text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  output jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (automation_id, idempotency_key)
);

create index automation_runs_organization_id_idx
  on public.automation_runs (organization_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id uuid references public.profiles (id) on delete set null,
  channel public.conversation_channel not null,
  notification_type text not null,
  subject text,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.notification_status not null default 'queued',
  idempotency_key text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index notifications_queue_idx
  on public.notifications (status, scheduled_for)
  where status = 'queued';

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  provider_message_id text,
  status public.notification_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, provider_message_id)
);

create table public.route_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.integration_provider not null default 'google_routes',
  route_key text not null,
  departure_bucket timestamptz,
  distance_meters integer check (distance_meters is null or distance_meters >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  traffic_duration_seconds integer check (
    traffic_duration_seconds is null or traffic_duration_seconds >= 0
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, route_key, departure_bucket)
);

create index route_cache_expiry_idx on public.route_cache (expires_at);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  integration_id uuid references public.integrations (id) on delete set null,
  provider public.integration_provider not null,
  external_event_id text,
  payload_hash text not null,
  status text not null check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_event_id)
);

create index webhook_events_provider_status_idx
  on public.webhook_events (provider, status, received_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_type public.audit_actor_type not null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_reference text,
  action text not null,
  tool_name text,
  target_type text,
  target_id text,
  approval_status public.approval_status,
  result text not null check (result in ('succeeded', 'failed', 'blocked', 'requested')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_logs_organization_id_idx
  on public.audit_logs (organization_id, occurred_at desc);

create table public.system_health_checks (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  status text not null check (status in ('healthy', 'degraded', 'unhealthy')),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create index system_health_checks_component_idx
  on public.system_health_checks (component, checked_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure app_private.handle_new_user();

create or replace function app_private.create_organization_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.onboarding_progress (organization_id)
  values (new.id)
  on conflict do nothing;

  insert into public.assistant_preferences (organization_id, timezone)
  values (new.id, new.timezone)
  on conflict do nothing;

  insert into public.billing_accounts (organization_id, status)
  values (new.id, 'trial')
  on conflict do nothing;

  insert into public.approval_policies (organization_id, action, required)
  values
    (new.id, 'calendar.read', false),
    (new.id, 'travel.read', false),
    (new.id, 'schedule.recommend', false),
    (new.id, 'reminder.create', false),
    (new.id, 'calendar.create_external', true),
    (new.id, 'calendar.move_external', true),
    (new.id, 'calendar.cancel', true),
    (new.id, 'email.send', true),
    (new.id, 'notification.send_external', true)
  on conflict (organization_id, action) do nothing;

  return new;
end;
$$;

create trigger organizations_create_defaults
  after insert on public.organizations
  for each row execute procedure app_private.create_organization_defaults();

create or replace function app_private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.platform_role_assignments
    where user_id = (select auth.uid())
      and role = 'platform_admin'
  );
$$;

create or replace function app_private.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships
    where organization_id = p_organization_id
      and user_id = (select auth.uid())
      and is_active
  );
$$;

create or replace function app_private.can_access_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_private.is_platform_admin()
    or app_private.is_organization_member(p_organization_id);
$$;

create or replace function app_private.has_organization_role(
  p_organization_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_private.is_platform_admin()
    or exists (
      select 1
      from public.memberships
      where organization_id = p_organization_id
        and user_id = (select auth.uid())
        and is_active
        and role = any(p_roles)
    );
$$;

create or replace function app_private.is_organization_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_private.has_organization_role(
    p_organization_id,
    array['customer_owner', 'customer_admin']::public.membership_role[]
  );
$$;

create or replace function app_private.shares_an_organization_with(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_private.is_platform_admin()
    or exists (
      select 1
      from public.memberships viewer_membership
      join public.memberships target_membership
        on target_membership.organization_id = viewer_membership.organization_id
      where viewer_membership.user_id = (select auth.uid())
        and viewer_membership.is_active
        and target_membership.user_id = p_target_user_id
        and target_membership.is_active
    );
$$;

create or replace function app_private.has_feature(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, auth
as $$
  select
    case
      when not app_private.can_access_organization(p_organization_id) then false
      else coalesce(
        (
          select ce.enabled
          from public.customer_entitlements ce
          where ce.organization_id = p_organization_id
            and ce.feature_key = p_feature_key
            and (ce.expires_at is null or ce.expires_at > now())
          limit 1
        ),
        (
          select pe.enabled
          from public.billing_accounts ba
          join public.plan_entitlements pe on pe.plan_id = ba.plan_id
          where ba.organization_id = p_organization_id
            and pe.feature_key = p_feature_key
            and ba.status in ('trial', 'active', 'past_due')
          limit 1
        ),
        false
      )
    end;
$$;

create or replace function app_private.can_perform_action(
  p_organization_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private, auth
as $$
begin
  if not app_private.can_access_organization(p_organization_id) then
    return false;
  end if;

  case p_action
    when 'organization.manage', 'integration.manage', 'billing.manage',
         'team.manage', 'approval_policy.manage', 'automation.manage' then
      return app_private.is_organization_admin(p_organization_id);
    when 'calendar.read', 'assistant.use', 'memory.read' then
      return true;
    when 'calendar.create', 'calendar.update', 'calendar.cancel',
         'notification.send', 'email.send' then
      return app_private.has_organization_role(
        p_organization_id,
        array['customer_owner', 'customer_admin', 'assistant_user']::public.membership_role[]
      );
    else
      return false;
  end case;
end;
$$;

create or replace function app_private.requires_approval(
  p_organization_id uuid,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, auth
as $$
  select
    case
      when not app_private.can_access_organization(p_organization_id) then true
      else coalesce(
        (
          select required
          from public.approval_policies
          where organization_id = p_organization_id
            and action = p_action
          limit 1
        ),
        true
      )
    end;
$$;

revoke all on function app_private.handle_new_user() from public;
revoke all on function app_private.create_organization_defaults() from public;
revoke all on function app_private.is_platform_admin() from public;
revoke all on function app_private.is_organization_member(uuid) from public;
revoke all on function app_private.can_access_organization(uuid) from public;
revoke all on function app_private.has_organization_role(uuid, public.membership_role[]) from public;
revoke all on function app_private.is_organization_admin(uuid) from public;
revoke all on function app_private.shares_an_organization_with(uuid) from public;
revoke all on function app_private.has_feature(uuid, text) from public;
revoke all on function app_private.can_perform_action(uuid, text) from public;
revoke all on function app_private.requires_approval(uuid, text) from public;

grant usage on schema app_private to authenticated, service_role;
grant execute on function app_private.is_platform_admin() to authenticated, service_role;
grant execute on function app_private.is_organization_member(uuid) to authenticated, service_role;
grant execute on function app_private.can_access_organization(uuid) to authenticated, service_role;
grant execute on function app_private.has_organization_role(uuid, public.membership_role[])
  to authenticated, service_role;
grant execute on function app_private.is_organization_admin(uuid) to authenticated, service_role;
grant execute on function app_private.shares_an_organization_with(uuid) to authenticated, service_role;
grant execute on function app_private.has_feature(uuid, text) to authenticated, service_role;
grant execute on function app_private.can_perform_action(uuid, text) to authenticated, service_role;
grant execute on function app_private.requires_approval(uuid, text) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.platform_role_assignments enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.customer_entitlements enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_records enable row level security;
alter table public.usage_records enable row level security;
alter table public.assistant_preferences enable row level security;
alter table public.assistant_rules enable row level security;
alter table public.assistant_memories enable row level security;
alter table public.approval_policies enable row level security;
alter table public.integrations enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendars enable row level security;
alter table public.calendar_events enable row level security;
alter table public.important_locations enable row level security;
alter table public.contacts enable row level security;
alter table public.conversation_sessions enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.tool_actions enable row level security;
alter table public.approval_requests enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.route_cache enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_health_checks enable row level security;
alter table private.integration_credentials enable row level security;
alter table private.oauth_states enable row level security;

create policy "profiles: users see their profile or teammates"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or app_private.shares_an_organization_with(id)
  );

create policy "profiles: users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "platform roles: users see their own assignment"
  on public.platform_role_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or app_private.is_platform_admin()
  );

create policy "organizations: members can read their organization"
  on public.organizations for select to authenticated
  using (app_private.can_access_organization(id));

create policy "memberships: organization members can read memberships"
  on public.memberships for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "onboarding: organization admins can read progress"
  on public.onboarding_progress for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "plans: authenticated users can see active public plans"
  on public.plans for select to authenticated
  using (is_active and (is_public or app_private.is_platform_admin()));

create policy "features: authenticated users can see active features"
  on public.features for select to authenticated
  using (is_active or app_private.is_platform_admin());

create policy "plan entitlements: authenticated users can read active plan configuration"
  on public.plan_entitlements for select to authenticated
  using (
    app_private.is_platform_admin()
    or exists (
      select 1 from public.plans
      where plans.id = plan_entitlements.plan_id
        and plans.is_active
        and plans.is_public
    )
  );

create policy "customer entitlements: organization users can read effective overrides"
  on public.customer_entitlements for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "billing accounts: organization admins can read"
  on public.billing_accounts for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "billing records: organization admins can read"
  on public.billing_records for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "usage: organization admins can read their usage"
  on public.usage_records for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "assistant preferences: members can read"
  on public.assistant_preferences for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "assistant rules: members can read"
  on public.assistant_rules for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "assistant memories: members can read their organization memory"
  on public.assistant_memories for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "approval policies: members can read"
  on public.approval_policies for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "integrations: members can read connection status"
  on public.integrations for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "calendar connections: members can read"
  on public.calendar_connections for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "calendars: members can read selected calendars"
  on public.calendars for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "calendar events: members can read their tenant schedule"
  on public.calendar_events for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "locations: members can read"
  on public.important_locations for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "contacts: members can read"
  on public.contacts for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "conversation sessions: users see their own conversations or admins see all"
  on public.conversation_sessions for select to authenticated
  using (
    user_id = (select auth.uid())
    or app_private.is_organization_admin(organization_id)
  );

create policy "conversation messages: users see their own conversations or admins see all"
  on public.conversation_messages for select to authenticated
  using (
    app_private.is_organization_admin(organization_id)
    or exists (
      select 1
      from public.conversation_sessions
      where conversation_sessions.id = conversation_messages.session_id
        and conversation_sessions.user_id = (select auth.uid())
    )
  );

create policy "agent runs: users see their own runs or admins see all"
  on public.agent_runs for select to authenticated
  using (
    requested_by = (select auth.uid())
    or app_private.is_organization_admin(organization_id)
  );

create policy "tool actions: users see their own actions or admins see all"
  on public.tool_actions for select to authenticated
  using (
    requested_by = (select auth.uid())
    or app_private.is_organization_admin(organization_id)
  );

create policy "approval requests: requester, approver, or organization admin can read"
  on public.approval_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or requested_for = (select auth.uid())
    or app_private.is_organization_admin(organization_id)
  );

create policy "idempotency records: organization admins can inspect"
  on public.idempotency_records for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "automations: organization admins can read"
  on public.automations for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "automation runs: organization admins can read"
  on public.automation_runs for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "notifications: recipients or organization admins can read"
  on public.notifications for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    or app_private.is_organization_admin(organization_id)
  );

create policy "notification deliveries: organization admins can read"
  on public.notification_deliveries for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "route cache: members can read tenant route data"
  on public.route_cache for select to authenticated
  using (app_private.can_access_organization(organization_id));

create policy "webhook events: platform admins can inspect"
  on public.webhook_events for select to authenticated
  using (app_private.is_platform_admin());

create policy "audit logs: organization admins can read"
  on public.audit_logs for select to authenticated
  using (app_private.is_organization_admin(organization_id));

create policy "system health: platform admins can read"
  on public.system_health_checks for select to authenticated
  using (app_private.is_platform_admin());

-- Explicit grants are required because current Supabase projects do not auto-expose
-- newly created tables. RLS remains the row-level enforcement mechanism.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute procedure public.set_updated_at();
create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute procedure public.set_updated_at();
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute procedure public.set_updated_at();
create trigger features_set_updated_at
  before update on public.features
  for each row execute procedure public.set_updated_at();
create trigger plan_entitlements_set_updated_at
  before update on public.plan_entitlements
  for each row execute procedure public.set_updated_at();
create trigger customer_entitlements_set_updated_at
  before update on public.customer_entitlements
  for each row execute procedure public.set_updated_at();
create trigger billing_accounts_set_updated_at
  before update on public.billing_accounts
  for each row execute procedure public.set_updated_at();
create trigger assistant_preferences_set_updated_at
  before update on public.assistant_preferences
  for each row execute procedure public.set_updated_at();
create trigger assistant_rules_set_updated_at
  before update on public.assistant_rules
  for each row execute procedure public.set_updated_at();
create trigger assistant_memories_set_updated_at
  before update on public.assistant_memories
  for each row execute procedure public.set_updated_at();
create trigger approval_policies_set_updated_at
  before update on public.approval_policies
  for each row execute procedure public.set_updated_at();
create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute procedure public.set_updated_at();
create trigger integration_credentials_set_updated_at
  before update on private.integration_credentials
  for each row execute procedure public.set_updated_at();
create trigger calendar_connections_set_updated_at
  before update on public.calendar_connections
  for each row execute procedure public.set_updated_at();
create trigger calendars_set_updated_at
  before update on public.calendars
  for each row execute procedure public.set_updated_at();
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute procedure public.set_updated_at();
create trigger important_locations_set_updated_at
  before update on public.important_locations
  for each row execute procedure public.set_updated_at();
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute procedure public.set_updated_at();
create trigger conversation_sessions_set_updated_at
  before update on public.conversation_sessions
  for each row execute procedure public.set_updated_at();
create trigger agent_runs_set_updated_at
  before update on public.agent_runs
  for each row execute procedure public.set_updated_at();
create trigger tool_actions_set_updated_at
  before update on public.tool_actions
  for each row execute procedure public.set_updated_at();
create trigger approval_requests_set_updated_at
  before update on public.approval_requests
  for each row execute procedure public.set_updated_at();
create trigger idempotency_records_set_updated_at
  before update on public.idempotency_records
  for each row execute procedure public.set_updated_at();
create trigger automations_set_updated_at
  before update on public.automations
  for each row execute procedure public.set_updated_at();
create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute procedure public.set_updated_at();
create trigger notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row execute procedure public.set_updated_at();
create trigger route_cache_set_updated_at
  before update on public.route_cache
  for each row execute procedure public.set_updated_at();

insert into public.features (key, name, description, category)
values
  ('calendar', 'Calendar', 'Read the unified calendar schedule.', 'calendar'),
  ('calendar_management', 'Calendar management', 'Create, edit, reschedule, and cancel calendar events.', 'calendar'),
  ('multi_calendar', 'Multiple calendars', 'Connect and manage more than one calendar.', 'calendar'),
  ('whatsapp', 'WhatsApp', 'Use WhatsApp as an assistant channel.', 'channels'),
  ('telegram', 'Telegram', 'Use Telegram as an assistant channel.', 'channels'),
  ('gmail', 'Gmail', 'Search, summarize, and draft email.', 'integrations'),
  ('slack', 'Slack', 'Use Slack as an assistant channel and integration.', 'integrations'),
  ('morning_brief', 'Morning brief', 'Receive daily schedule and travel briefings.', 'automation'),
  ('basic_travel', 'Basic travel', 'Calculate travel duration and departure times.', 'travel'),
  ('live_traffic', 'Live traffic', 'Use traffic-aware travel duration.', 'travel'),
  ('travel_aware_scheduling', 'Travel-aware scheduling', 'Factor travel into scheduling decisions.', 'travel'),
  ('smart_rescheduling', 'Smart rescheduling', 'Receive smart scheduling recommendations.', 'calendar'),
  ('conflict_detection', 'Conflict detection', 'Detect calendar and travel conflicts.', 'calendar'),
  ('attendee_notifications', 'Attendee notifications', 'Notify meeting attendees after approval.', 'communication'),
  ('voice_messages', 'Voice messages', 'Process and send supported voice messages.', 'channels'),
  ('basic_memory', 'Basic assistant memory', 'Store confirmed personal assistant preferences.', 'assistant'),
  ('advanced_memory', 'Advanced memory', 'Use expanded memory and preference controls.', 'assistant'),
  ('meeting_buffers', 'Meeting buffers', 'Configure schedule buffers for meetings and travel.', 'calendar'),
  ('team_users', 'Team users', 'Add users to a shared organization.', 'team'),
  ('shared_calendars', 'Shared calendars', 'Use shared organization calendars.', 'calendar'),
  ('approval_workflows', 'Approval workflows', 'Configure organization approval policies.', 'governance'),
  ('audit_logs', 'Audit logs', 'View sensitive action audit logs.', 'governance'),
  ('crm_integrations', 'CRM integrations', 'Connect future CRM integrations.', 'integrations'),
  ('custom_automations', 'Custom automations', 'Create custom assistant automations.', 'automation'),
  ('advanced_analytics', 'Advanced analytics', 'View advanced tenant analytics.', 'analytics')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      updated_at = now();

insert into public.plans (
  code,
  name,
  description,
  price_minor,
  currency_code,
  limits,
  is_public,
  is_active
)
values
  (
    'personal',
    'Personal',
    'A capable personal executive assistant for one person.',
    39900,
    'MYR',
    '{"team_users": 1, "calendars": 2}'::jsonb,
    true,
    true
  ),
  (
    'executive',
    'Executive',
    'Travel-aware schedule intelligence for a busy executive.',
    69900,
    'MYR',
    '{"team_users": 1, "calendars": 4}'::jsonb,
    true,
    true
  ),
  (
    'business',
    'Business',
    'A governed executive assistant for shared company operations.',
    129900,
    'MYR',
    '{"team_users": 25, "calendars": 25}'::jsonb,
    true,
    true
  )
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      price_minor = excluded.price_minor,
      currency_code = excluded.currency_code,
      limits = excluded.limits,
      is_public = excluded.is_public,
      is_active = excluded.is_active,
      updated_at = now();

with seeded_entitlements(plan_code, feature_key, enabled, limit_value) as (
  values
    ('personal', 'calendar', true, null),
    ('personal', 'calendar_management', true, null),
    ('personal', 'multi_calendar', true, 2),
    ('personal', 'whatsapp', true, null),
    ('personal', 'telegram', true, null),
    ('personal', 'morning_brief', true, null),
    ('personal', 'basic_travel', true, null),
    ('personal', 'basic_memory', true, null),
    ('personal', 'meeting_buffers', true, null),
    ('executive', 'calendar', true, null),
    ('executive', 'calendar_management', true, null),
    ('executive', 'multi_calendar', true, 4),
    ('executive', 'whatsapp', true, null),
    ('executive', 'telegram', true, null),
    ('executive', 'gmail', true, null),
    ('executive', 'morning_brief', true, null),
    ('executive', 'basic_travel', true, null),
    ('executive', 'live_traffic', true, null),
    ('executive', 'travel_aware_scheduling', true, null),
    ('executive', 'smart_rescheduling', true, null),
    ('executive', 'conflict_detection', true, null),
    ('executive', 'attendee_notifications', true, null),
    ('executive', 'voice_messages', true, null),
    ('executive', 'basic_memory', true, null),
    ('executive', 'advanced_memory', true, null),
    ('executive', 'meeting_buffers', true, null),
    ('business', 'calendar', true, null),
    ('business', 'calendar_management', true, null),
    ('business', 'multi_calendar', true, 25),
    ('business', 'whatsapp', true, null),
    ('business', 'telegram', true, null),
    ('business', 'gmail', true, null),
    ('business', 'slack', true, null),
    ('business', 'morning_brief', true, null),
    ('business', 'basic_travel', true, null),
    ('business', 'live_traffic', true, null),
    ('business', 'travel_aware_scheduling', true, null),
    ('business', 'smart_rescheduling', true, null),
    ('business', 'conflict_detection', true, null),
    ('business', 'attendee_notifications', true, null),
    ('business', 'voice_messages', true, null),
    ('business', 'basic_memory', true, null),
    ('business', 'advanced_memory', true, null),
    ('business', 'meeting_buffers', true, null),
    ('business', 'team_users', true, 25),
    ('business', 'shared_calendars', true, null),
    ('business', 'approval_workflows', true, null),
    ('business', 'audit_logs', true, null),
    ('business', 'crm_integrations', true, null),
    ('business', 'custom_automations', true, null),
    ('business', 'advanced_analytics', true, null)
)
insert into public.plan_entitlements (plan_id, feature_key, enabled, limit_value)
select plans.id, seeded_entitlements.feature_key, seeded_entitlements.enabled, seeded_entitlements.limit_value
from seeded_entitlements
join public.plans on plans.code = seeded_entitlements.plan_code
on conflict (plan_id, feature_key) do update
  set enabled = excluded.enabled,
      limit_value = excluded.limit_value,
      updated_at = now();

commit;
