# Ava Executive Assistant SaaS

Ava is a multi-tenant AI Executive Assistant SaaS built with Next.js App Router, TypeScript, Tailwind, shadcn/ui, and Supabase. It is designed for repeated customer onboarding: every organization has isolated memberships, integrations, calendars, preferences, memory, rules, approvals, usage, and billing state.

The development experience works without third-party credentials. It displays clearly labelled mock data and mock providers; it does not represent those integrations as live.

## What is included

- Multi-tenant Supabase schema with UUID keys, RLS, membership roles, plans, feature entitlements, customer overrides, audit logs, approvals, idempotency, automations, usage, and integration credential isolation.
- Server-side entitlement, authorization, approval, idempotency, calendar conflict, travel conflict, notification, and agent-provider abstractions.
- Google Calendar OAuth, encrypted service-only token retrieval/refresh, calendar catalog selection, selected-event synchronization, and a durable approval-gated executor; Gmail, travel, WhatsApp, Telegram, Slack, and Hermes-compatible provider contracts with development-safe mocks.
- Transactional approval decisions that atomically update the approval, controlled-action queue, and audit record. Approved calendar changes and external replies are materialized by service-only workers exactly once.
- A server-only AI SDK provider layer for explicit OpenAI, Anthropic, or OpenRouter model selection. Without Hermes it is deliberately response-only and receives no tools or integration credentials.
- Persisted workspace settings and user-controlled memory edit/delete flows, each backed by tenant-checked, audited database RPCs rather than browser table writes.
- A platform-admin console with server-gated customer reporting, plan assignment, and customer-specific entitlement overrides. Every platform mutation is validated again by an authenticated database RPC and logged against the affected tenant.
- Verified WhatsApp and Telegram webhook endpoints that remain disabled until their secrets and Supabase configuration exist. A verified inbound message is deduplicated, mapped to a tenant conversation, queued for bounded agent reasoning, and converted into an approval-gated external reply.
- Customer portal, platform-admin demonstration view, authenticated/resumable tenant onboarding, authentication screens, operational health endpoint, and a polished responsive dashboard.
- Unit tests for entitlements, permission checks, approval defaults, calendar/travel conflicts, timezone handling, scheduler behavior, morning brief composition, webhook signatures, and durable tool, agent, and notification execution.

## Local development

1. Copy .env.example to .env.local.
2. Install dependencies with npm install.
3. Start the application with npm run dev.
4. Open http://localhost:3000.

Without Supabase environment values, the dashboard launches in Development demo mode. This is intentional and visible in the interface.

## Verification

Run:

    npm run lint
    npm test
    npm run build

For a real database, initialize a Supabase project and apply every migration in supabase/migrations. See DATABASE.md and DEPLOYMENT.md.

## Documentation

- ARCHITECTURE.md: application boundaries and controlled tool flow.
- DATABASE.md: schema, RLS, role, plan, and data-isolation design.
- INTEGRATIONS.md: OAuth, messaging, provider, and mock-mode design.
- DEPLOYMENT.md: Supabase, Vercel, and Hermes VPS rollout.
- SECURITY.md: production security controls and review checklist.
- ENVIRONMENT.md: complete environment variable checklist.
- HERMES.md: Hermes bridge contract and VPS deployment notes.
- FIGMA_DESIGN_SYSTEM.md: reusable UI tokens and Figma handoff workflow.

## Customer onboarding

The first customer follows:

Create account → Choose plan → Configure organization and timezone → Connect accounts → Select calendars → Set assistant preferences → Configure approvals → Activate.

The second customer uses the same flow. Do not copy the repository or deploy a second application. Create a new organization, assign a plan, connect accounts, configure preferences, and activate.
