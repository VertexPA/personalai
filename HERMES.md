# Hermes integration

## Role

Hermes is the primary reasoning and conversation runtime. It is replaceable through the AgentProvider contract and is deliberately not the security authority for the SaaS.

Hermes may:

- reason about conversations;
- plan responses;
- use customer-approved memory context;
- propose a tool action;
- help compose scheduled briefs.

Hermes may not:

- access integration OAuth credentials;
- access Supabase service-role credentials;
- execute a calendar modification directly;
- send email, WhatsApp, Telegram, or Slack messages directly;
- bypass plan entitlements, organization permissions, approval policy, or idempotency.

## Bridge contract

The Next.js application calls:

    POST HERMES_BRIDGE_URL/v1/agent-runs

with a bearer token from HERMES_BRIDGE_TOKEN and a narrow request body:

- organization ID;
- linked user ID when one exists;
- conversation ID;
- message;
- allowed tool action names.

The bridge returns:

- a natural-language reply;
- zero or more proposed tool intents;
- provider metadata.

The SaaS ToolGateway independently validates each intent before it can execute. A
verified WhatsApp or Telegram message reaches Hermes only through the protected
inbound-agent queue, with confirmed rules and bounded memory but no credentials
or raw webhook payload. Hermes's natural-language reply becomes a proposed
external message; a tenant administrator must approve it before the controlled
notification and delivery workers can send it.

## VPS deployment

1. Build the Hermes bridge into a minimal container image.
2. Run it behind a TLS reverse proxy with a private hostname.
3. Restrict ingress to the SaaS application or a private network.
4. Use a long random bridge token and rotate it without downtime.
5. Configure liveness and readiness endpoints.
6. Emit structured logs without user credentials, OAuth tokens, or raw sensitive message contents.
7. Use a durable worker or queue for long agent tasks; do not hold a browser request open for an extended run.
8. Test timeout, malformed intent, bridge outage, retry, and duplicate-delivery paths.

## Model providers

The SaaS includes a server-only `LlmProvider` abstraction backed by the AI SDK
for OpenAI, Anthropic, and OpenRouter. It requires an explicit provider key and
model ID; it does not select a surprise default model. The direct SaaS use is
response-only and intentionally has no tools or integration credentials.

The Hermes bridge may use the same provider choices behind its own abstraction.
It should return normalized results to the SaaS. Pricing, token usage, and
provider attribution can be recorded in agent_runs and usage_records without
exposing platform-wide costs to normal customers.
