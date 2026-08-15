# Database design

The foundational migrations are:

    supabase/migrations/20260811071907_initial_multi_tenant_saas.sql
    supabase/migrations/20260811180039_approval_decision_workflow.sql
    supabase/migrations/20260811185922_durable_tool_action_execution.sql
    supabase/migrations/20260811191609_tenant_rules_and_notification_delivery.sql
    supabase/migrations/20260811193450_durable_inbound_message_processing.sql
    supabase/migrations/20260811194150_durable_agent_reply_workflow.sql
    supabase/migrations/20260812090000_secure_onboarding_state.sql
    supabase/migrations/20260812100000_workspace_preferences_and_memory.sql
    supabase/migrations/20260812110000_platform_admin_operations.sql

Every customer-owned resource includes organization_id. UUIDs and timestamp columns are used throughout.

## Core tenant tables

| Area | Tables |
| --- | --- |
| Identity | profiles, platform_role_assignments |
| Tenancy | organizations, memberships, onboarding_progress |
| Commercial | plans, features, plan_entitlements, customer_entitlements, billing_accounts, billing_records, usage_records |
| Assistant | assistant_preferences, assistant_rules, assistant_memories, approval_policies |
| Integrations | integrations, calendar_connections, calendars, calendar_events, important_locations, contacts |
| Agent governance | agent_runs, tool_actions, approval_requests, idempotency_records, audit_logs |
| Automation and communication | automations, automation_runs, notifications, notification_deliveries, conversation_sessions, conversation_messages |
| Reliability | route_cache, webhook_events, system_health_checks |

Private schema tables hold integration_credentials and oauth_states. They are not part of the Data API exposed schemas and receive RLS as defense in depth.

## Roles

- platform_admin manages the SaaS across tenants.
- customer_owner owns a customer organization.
- customer_admin administers an organization.
- customer_member has limited, read-centric workspace access.
- assistant_user can use approved assistant actions but cannot administer billing, integrations, or organization policy.

## RLS model

All application tables have RLS enabled. Private helper functions live in the non-exposed app_private schema, use an explicit search path, and validate the authenticated user’s membership.

The public browser data API is intentionally read-mostly. Sensitive mutations happen through server actions or route handlers using the server-side data access layer. Those handlers must validate the current user, organization, role, feature, and approval requirement before service-role access is used.

The onboarding, Google OAuth, calendar-selection, approval-decision, workspace-settings, and memory flows use narrowly scoped authenticated RPCs. Each user-facing function has a fixed search path, verifies auth.uid(), verifies organization administration where applicable, and performs multi-table changes transactionally. This avoids broad browser insert/update policies while preserving tenant isolation.

Approval decisions acquire a row lock and atomically update the approval request, linked controlled-tool action, and audit record. The service-only tool executor can claim an approved action once; a timeout is recorded as an unknown outcome rather than replayed. Calendar selection validates the connected tenant calendar catalog, selected primary calendar, and the effective multi_calendar limit before persisting. Encrypted Google credentials can only be read or rotated through functions granted to service_role; authenticated browser sessions have no execute grant.

Workspace preference updates are limited to organization owners and admins. Their
transaction updates the assistant preferences, tenant timezone, existing
automation timezone, external-action default policies, onboarding state, and an
audit event together. Memory writes are scoped to the current member's owned
records unless an organization admin edits a shared record; every create,
update, and delete writes an audit event.

Platform operations use separate functions that require
`app_private.is_platform_admin()` from the authenticated session. They can set
an existing active plan and create, replace, or remove one customer entitlement
override. The customer ID, feature, plan, and result are audited against the
affected organization; a customer owner or admin cannot use these functions.

Assistant rules are saved, confirmed, and deleted by tenant-admin RPCs. Rules
that require confirmation remain excluded from agent context until an admin
confirms them. Notification and inbound-agent queue functions are service-role
only: workers claim a row before contacting a provider, preserve only safe error
codes, and mark timed-out work as failed rather than replaying it.

Verified WhatsApp and Telegram text messages call one service-only transaction.
It validates the tenant integration and channel entitlement, deduplicates the
provider event, persists the conversation message, and creates the linked agent
run. The agent worker stores a proposed reply as an approval-gated controlled
notification action. Only an approved action can create the durable
notification, and a delivery trigger records the outbound conversation message
only after a provider accepts it.

Tenant isolation is enforced in three layers:

1. organization_id foreign keys and indexes;
2. RLS membership predicates;
3. server-side authorization in the data access and tool layers.

## Plans and entitlement overrides

Plan entitlements are seeded for Personal, Executive, and Business. A customer_entitlements row overrides a plan setting for one organization, allowing add-ons such as Slack for an Executive customer without a plan fork.

## Applying the schema

After linking Supabase:

    npx supabase db push

For a local Docker-backed Supabase instance:

    npx supabase start
    npx supabase db reset
    npx supabase db lint
    npx supabase db advisors

Do not apply the migration to a production project until the local reset and database advisors have been reviewed.
