# Integrations

## Development mode

The application runs without external credentials by using labelled mock providers:

- MockGoogleCalendarProvider
- MockGmailProvider
- MockTravelProvider
- MockNotificationProvider
- MockAgentProvider

Mocks are a development aid only. They never claim that a calendar, WhatsApp account, Telegram bot, Gmail mailbox, Slack workspace, Maps account, or Hermes service is connected.

## Google Calendar and Gmail

Use a Google Cloud OAuth client with minimum scopes:

- Calendar read and write scopes only when calendar editing is purchased and approved.
- Gmail readonly and compose scopes for search and drafts.
- Gmail send only when sending is enabled and the approval policy allows it.

Google Calendar onboarding is implemented as a server-side OAuth flow:

1. An organization administrator opens /api/integrations/google/start.
2. The server stores only a hashed, short-lived OAuth state in private.oauth_states.
3. Google redirects to /api/integrations/google/callback.
4. The callback consumes the state exactly once, exchanges the authorization code on the server, encrypts the token bundle with INTEGRATION_ENCRYPTION_KEY, and writes the connection through a tenant-checked RPC.

OAuth access and refresh tokens are encrypted before storage in private.integration_credentials. Never put a token into a browser response.

After a connection, the server-only Google Calendar service decrypts credentials only through a service_role-restricted RPC, refreshes expiring access tokens, and persists the rotated encrypted token bundle. A workspace administrator can refresh the Google calendar catalog, select read-permitted calendars, choose a primary calendar, and sync events. The calendar-selection RPC enforces the effective multi_calendar plan or add-on limit before writing.

The provider supports tenant-scoped calendar discovery, selected-calendar event synchronization, and create, update, and cancellation contracts. Calendar mutations use a deterministic provider-safe event identifier derived from the controlled-action idempotency key, so a provider call is never made directly from the browser or agent runtime.

## Google Routes

The travel provider is selected behind the TravelProvider interface. Cache tenant-scoped route results by origin, destination, departure-time bucket, and provider until expiry. Do not call Maps for every render.

Live traffic must remain feature-gated. Basic duration may be available on lower plans, while traffic-aware duration requires live_traffic.

## WhatsApp

Use the official WhatsApp Business Platform Cloud API.

- GET /api/webhooks/whatsapp performs Meta verification with WHATSAPP_VERIFY_TOKEN.
- POST /api/webhooks/whatsapp validates x-hub-signature-256 using WHATSAPP_APP_SECRET.
- The server resolves exactly one connected tenant integration by phone number ID. A verified text message is atomically deduplicated, persisted to its tenant conversation, and queued for bounded agent reasoning; an unknown or ambiguous sender is recorded as ignored.
- The agent may only create a proposed reply. A workspace administrator must approve its controlled `notification.send_external` action before the delivery worker calls WhatsApp.
- The outbound adapter uses an explicit Graph API version and a tenant-linked sender ID. Proactive sends must provide an approved template name and language when required by the WhatsApp conversation window; the worker never invents a template language or falls back to another tenant's sender.

Never call WhatsApp directly from the agent runtime.

## Telegram

Telegram is suitable as the simpler early testing channel.

- POST /api/webhooks/telegram validates x-telegram-bot-api-secret-token.
- A linked active conversation session resolves the tenant from chat ID.
- A verified text message follows the same durable inbound-agent and approval path as WhatsApp. Unknown or ambiguous chat IDs are recorded as ignored rather than routed to an arbitrary tenant.
- Telegram delivery uses the configured bot token and the tenant conversation's explicit chat ID; no browser code receives the token.

Use a unique webhook secret per deployed bot configuration. Production should store any per-integration secret hashes in the private schema.

## Slack

Slack is an optional Business module. Add a Slack OAuth installation, team/workspace ID mapping, channel and DM permissions, and a server-side event signature verifier only after Slack credentials are configured.

The entitlement check for slack occurs before exposing connection UI or registering a tool.

## Provider readiness

| Provider | Architecture | Live credentials in repository |
| --- | --- | --- |
| Google Calendar | OAuth, encrypted service-only token retrieval/refresh, catalog and selected-event sync, contract and mock | No |
| Gmail | Contract and mock | No |
| Google Routes | Contract and mock | No |
| WhatsApp | Signed inbound mapping, approval-gated reply queue, durable Cloud API delivery | No |
| Telegram | Secret-token inbound mapping, approval-gated reply queue, durable bot delivery | No |
| Slack | Optional contract boundary | No |
| Hermes | Configurable bridge contract | No |

Do not mark any provider as live until the corresponding OAuth, callback, webhook, outbound request, and failure-path checks have been verified.
