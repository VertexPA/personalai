# Architecture

## System flow

Customer → Web, WhatsApp, Telegram, or Slack → SaaS route handler → Authentication and tenant resolution → Feature entitlement check → Durable event or request queue → Approval policy check → Idempotency guard → Controlled integration tool.

Hermes is an intent-producing agent runtime. It does not receive direct OAuth tokens, service-role credentials, or unrestricted integration clients. It returns a plan or tool intent to the SaaS ToolGateway, which is responsible for all sensitive execution.

## Boundaries

The browser may use the Supabase publishable key and browser-safe configuration only. It never receives service-role keys, integration credentials, Maps keys, OAuth refresh tokens, Hermes bridge tokens, or webhook secrets.

The Next.js application owns:

- authentication and session refresh;
- tenant resolution;
- role authorization;
- feature entitlement and plan override checks;
- approval creation and decisions;
- encrypted integration credentials;
- audit and usage recording;
- webhook validation and idempotency;
- UI and server-side data-transfer objects.

Tenant setup is performed through a narrowly scoped authenticated database RPC,
not through browser table mutation. The RPC creates the organization,
owner membership, defaults, billing assignment, preferences, automation,
approval defaults, location, onboarding state, and audit event atomically.

Google Calendar OAuth follows the same boundary: a server-generated state is
hashed and stored privately, consumed once by the callback, and the encrypted
token bundle is committed through a tenant-checked database RPC.

The Google Calendar service is server-only. A service_role-restricted RPC
returns encrypted token bytes to the server service, which decrypts and
refreshes them before calling Google. Calendar discovery and event sync write
only the active tenant’s catalog and selected calendar events. An authenticated
tenant-admin RPC validates selection and entitlement limits before enabling a
calendar.

Approval decisions also use a transactional RPC. It locks the pending request,
updates its linked tool action to approved or cancelled, and appends an audit
event together. A provider executor may only consume the approved state once.
The execution worker claims the row before a provider call and fails a stale
claim closed rather than replaying an external side effect.

Workspace settings and customer memory follow the same write boundary. A
tenant-admin settings RPC validates and updates preferences, timezone-sensitive
automation configuration, approval defaults, and audit history together. A
member-facing memory RPC allows a user to manage their owned memories, while
shared records remain admin-controlled. Neither workflow grants browser table
write access.

Verified messaging webhooks have a second durable boundary. WhatsApp resolves a
connected tenant sender; Telegram requires a previously linked active chat. The
service-only inbound transaction deduplicates the provider event, stores the
message and conversation mapping, and queues bounded, credential-free agent
reasoning. The agent result becomes a proposed `notification.send_external`
action. A tenant administrator must approve it before the controlled-action
worker creates a notification for the separate delivery worker.

Agent context contains the workspace name and timezone, confirmed active rules,
and shared or linked-user memory only. It excludes credentials, raw webhook
payloads, audit logs, and unconfirmed rules whether the run begins from Web or
from the inbound queue.

The Hermes bridge owns:

- conversational reasoning;
- planning;
- memory-related reasoning;
- proposed tool selection.

The server-only AI SDK provider layer normalizes OpenAI, Anthropic, and
OpenRouter behind `LlmProvider`. If it is explicitly configured without a
Hermes bridge, it is response-only: the model receives neither integration
credentials nor executable tool definitions and returns no tool intents.
Hermes remains the production planning runtime.

Platform-wide reporting is separate from tenant portal queries. The server first
validates the session's platform-admin assignment, then creates a narrowly used
service client for aggregated customer, integration, health, and usage data.
Plan changes and entitlement overrides go back through platform-admin-only RPCs
that audit their tenant-scoped effects.

Provider adapters own:

- Google Calendar operations;
- Google Routes operations;
- Gmail search and drafts;
- WhatsApp, Telegram, and Slack delivery.

## Server-side modules

The security-critical modules are intentionally separate:

- src/lib/entitlements.ts resolves plan and customer override access.
- src/lib/permissions.ts resolves a role against an action.
- src/lib/approvals.ts resolves approval policy and safe defaults.
- src/lib/idempotency.ts prevents duplicate sensitive execution.
- src/lib/tool-gateway.ts enforces their order before running any tool.
- src/lib/tool-actions/runner.ts claims approved calendar and notification actions.
- src/lib/agent/inbound-runner.ts claims verified inbound agent runs and queues only proposed replies.
- src/lib/notifications/runner.ts delivers queued notifications after their controlled action is complete.
- src/lib/security/secret-encryption.ts protects token ciphertext before it reaches private database storage.
- src/lib/calendar/orchestrator.ts builds a selected-calendar schedule and
  requests route data only for relevant consecutive locations.
- src/lib/automation/scheduler.ts calculates recurring runs in the tenant's
  IANA timezone rather than the host timezone.

## Runtime modes

Development mode defaults to mock adapters. The UI labels mock data, no live external account is implied, and production-only routes reject unsafe unconfigured paths.

Production mode requires Supabase, server-only integration credentials, all protected queue workers, a shared rate-limit store, and a deployed Hermes bridge.
