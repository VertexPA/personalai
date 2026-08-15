# Security

## Current controls

- Row Level Security is enabled on every application table.
- Tenant membership is checked by private schema helper functions.
- Plans and feature overrides are server-side entitlements, not hidden-button checks.
- Sensitive tools pass entitlement, permission, approval, and idempotency checks.
- Integration credential ciphertext belongs to private.integration_credentials, not public browser-visible tables.
- Google OAuth state is hashed, short-lived, tenant-bound, and consumed once before token exchange.
- Encrypted Google credential retrieval and rotation RPCs are executable only by service_role, never an authenticated browser session.
- Calendar selection is a tenant-admin transaction that enforces selected-calendar access and plan limits.
- Approval decisions lock and update the request, controlled-action state, and audit record in one transaction.
- Controlled-action, inbound-agent, and notification workers claim durable rows with service-only RPCs. Stale claims fail closed rather than replaying a provider call.
- Workspace settings are written only by a tenant-admin RPC that validates IANA timezone, working hours, buffers, and approval-default changes before auditing the transaction.
- Memory edits and deletes are tenant-bound, owner-scoped for ordinary members, and audited; no browser RLS write policy grants broad memory mutation.
- Public tenant-mutation RPCs are `SECURITY INVOKER` entry points. Their existing, tenant-checking privileged implementations live in the non-exposed `app_private` schema, and anonymous callers have no execute grant.
- Direct OpenAI, Anthropic, and OpenRouter configuration is server-only. The no-Hermes fallback supplies no tools or integration credentials to the model.
- Platform-wide reporting creates a service-role query only after the current session passes the authenticated platform-admin role check. Platform plan and entitlement changes are independently checked in database RPCs and written to the affected tenant audit log.
- WhatsApp webhooks validate an HMAC signature.
- Telegram webhooks validate a configured secret token.
- Verified inbound messages are tenant- and feature-checked, deduplicated, persisted with their conversation, and queued without exposing raw webhook payloads to the agent runtime.
- Agent-generated external replies become pending approval requests. Only an approved controlled action can queue delivery, and accepted provider sends are recorded back to the tenant conversation.
- Sensitive actions have tool action, approval request, idempotency, and audit schema records.
- Browser code only receives NEXT_PUBLIC Supabase configuration.

## Production checklist

- Set secure, unique production values for all secrets.
- Use a managed KMS or secret manager to rotate the integration encryption key; version encrypted records.
- Confirm no service-role key, OAuth credential, webhook secret, Maps key, or Hermes token exists in browser bundles, Git, logs, or error messages.
- Enforce a strong Supabase Auth password policy, email confirmation, MFA for privileged users, and production SMTP.
- Configure exact Auth redirect URLs and review every OAuth provider callback.
- Set a stable NEXT_SERVER_ACTIONS_ENCRYPTION_KEY across every production instance.
- Run Supabase database advisors and correct all RLS, function-search-path, and exposed-table warnings.
- Test cross-tenant select, update, delete, and direct RPC attempts under authenticated user sessions.
- Test simultaneous approval decisions and expired requests to confirm exactly one terminal action state is committed.
- Test duplicate WhatsApp and Telegram deliveries to confirm exactly one webhook event, conversation message, agent run, approval request, controlled action, and provider notification are created.
- Test an inbound agent timeout, tool-action timeout, and notification timeout; each must fail closed without a blind provider replay.
- Test Google catalog refresh, selected-calendar limits, token refresh, revoked access, and reconnect behavior with a non-production tenant before enabling live calendar tools.
- Test customer-member attempts to modify an owner’s memory and to change workspace settings; both must be rejected by authenticated RPCs.
- Test customer-owner and customer-admin attempts to call each platform-admin RPC directly; both must be rejected even if they discover an RPC name.
- Move API rate limits from the in-memory development fallback to a shared durable store.
- Review application logs for secrets before enabling integrations.
- Enforce signed webhook validation before parsing or processing every external request.
- Set HTTPS, HSTS, CSP, secure cookies, and appropriate CORS/CSRF protections for the deployed domain.
- Configure backups, recovery drills, alerting, and audit retention policy.

## Sensitive action policy

Reads, recommendations, and travel analysis do not require approval by default. Meeting changes with external attendees, cancellations, email sends, and outbound messages require approval by default. Customers can tighten their own policies; no policy should silently broaden execution beyond the tenant’s entitlement and role.

## Incident response

If an integration token may be exposed, revoke the provider token immediately, mark its integration status as needs_reauth or revoked, invalidate relevant sessions, rotate the application secret, inspect audit logs, and notify affected customers according to the incident policy.
