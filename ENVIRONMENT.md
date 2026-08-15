# Environment variables

Copy .env.example to .env.local for local development. Do not commit local environment files.

## Required for a live application

| Variable | Scope | Purpose |
| --- | --- | --- |
| APP_URL | Server | Canonical app URL for redirects |
| NEXT_SERVER_ACTIONS_ENCRYPTION_KEY | Server only | Stable base64 key for Server Actions across multiple instances |
| NEXT_PUBLIC_SUPABASE_URL | Browser and server | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Browser and server | Supabase browser key |
| SUPABASE_SERVICE_ROLE_KEY | Server only | Privileged server-side data access; required together with `CRON_SECRET` for every live worker |
| INTEGRATION_ENCRYPTION_KEY | Server only | Base64 32-byte AES-256 key for integration token ciphertext |
| CRON_SECRET | Server only | Unique 32+-character value required with `SUPABASE_SERVICE_ROLE_KEY` to invoke live protected worker routes |

## Agent

| Variable | Scope | Purpose |
| --- | --- | --- |
| HERMES_BRIDGE_URL | Server only | Private Hermes bridge URL |
| HERMES_BRIDGE_TOKEN | Server only | Bridge authentication |

## Google

| Variable | Scope | Purpose |
| --- | --- | --- |
| GOOGLE_OAUTH_CLIENT_ID | Server only | OAuth client ID |
| GOOGLE_OAUTH_CLIENT_SECRET | Server only | OAuth client secret |
| GOOGLE_ROUTES_API_KEY | Server only | Google Routes API key restricted by server egress or API policy |

## Communication

| Variable | Scope | Purpose |
| --- | --- | --- |
| WHATSAPP_APP_SECRET | Server only | Webhook HMAC validation |
| WHATSAPP_VERIFY_TOKEN | Server only | Meta webhook verification |
| WHATSAPP_ACCESS_TOKEN | Server only | WhatsApp Cloud API outbound calls |
| WHATSAPP_PHONE_NUMBER_ID | Server only | Provisioning reference for a tenant sender identity |
| WHATSAPP_BUSINESS_ACCOUNT_ID | Server only | Provisioning reference for WhatsApp business configuration |
| WHATSAPP_GRAPH_API_VERSION | Server only | Explicit Graph API version required for outbound calls, for example `vNN.N` |
| TELEGRAM_BOT_TOKEN | Server only | Telegram outbound API access |
| TELEGRAM_WEBHOOK_SECRET | Server only | Telegram signed webhook validation |

## LLM provider layer

The direct response-only layer supports OpenAI, Anthropic, and OpenRouter via
the AI SDK. Hermes remains the primary production intent and planning runtime.
Set `LLM_PROVIDER` to exactly one of `openai`, `anthropic`, or `openrouter`,
then configure that provider's API key and explicit model ID:

| Provider | Key | Model |
| --- | --- | --- |
| OpenAI | OPENAI_API_KEY | OPENAI_MODEL |
| Anthropic | ANTHROPIC_API_KEY | ANTHROPIC_MODEL |
| OpenRouter | OPENROUTER_API_KEY | OPENROUTER_MODEL |

All LLM configuration is server-only. Do not use `NEXT_PUBLIC_` variables for
provider keys or model-routing configuration. The application deliberately has
no default model; choose and pin a production model during deployment based on
current provider availability, data requirements, cost, and capability. Do not
use a rotating or free-provider alias such as `openrouter/free` for ordinary production
traffic.

SLACK_CLIENT_ID and SLACK_CLIENT_SECRET also stay server-only.

## Scheduled automations

On plans that support Vercel Cron, the protected automation, controlled-action,
inbound-agent, and notification-delivery routes run every five minutes. This
project's Vercel Hobby deployment instead uses the existing Supabase Free
pg_cron and pg_net extensions to POST to those same routes. The production URL
and the `CRON_SECRET` bearer value are stored only in Supabase Vault. The
worker also needs `SUPABASE_SERVICE_ROLE_KEY`; the health endpoint reports
`scheduler: "not_configured"` and job routes return 503 until both server-only
Vercel variables are present. Never make a worker endpoint public.

## Key generation

Generate an encryption key with a cryptographically secure system command, store it in the deployment secret manager, and retain a key version for rotation. Do not reuse the encryption key as an OAuth secret, webhook secret, or JWT secret.
