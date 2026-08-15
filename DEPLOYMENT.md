# Deployment

## Supabase setup

1. Create one Supabase project for this SaaS, not one per customer.
2. Copy the project URL and publishable key into the Vercel environment.
3. Store the service-role key only as a server-side environment variable.
4. Link the local repository:

       npx supabase login
       npx supabase link --project-ref YOUR_PROJECT_REF

5. Apply and review the migration:

       npx supabase db push

6. Verify RLS plus authenticated approval/calendar-selection RPCs and service-only queue RPCs with the SQL editor or local test database. Run database advisors and resolve any warning before production.
7. Configure Supabase Auth site URL and exact redirect URLs for the production Vercel domain and local development.

## Google Cloud setup

1. Create a Google Cloud project and enable Google Calendar API, Gmail API, and Routes API only if required.
2. Configure an OAuth consent screen and restrict it to the minimum required scopes.
3. Create separate OAuth clients for local and production callback URLs.
4. Register the Google Calendar OAuth callback as:

       https://YOUR_DOMAIN/api/integrations/google/callback

5. Put client secrets and Maps keys only in server-side environment configuration.
6. Use the Integrations page to refresh the calendar catalog, select the calendars Ava may read, select a primary calendar, and sync selected events.
7. Verify token refresh, revoked access, selected-calendar permissions, plan limits, and failed API responses before enabling a customer integration.

## Meta and WhatsApp setup

1. Create a Meta app and add WhatsApp Cloud API.
2. Record the App Secret, phone number ID, business account ID, access token, and explicit Graph API version in server-only Vercel variables.
3. Configure the webhook callback:

       https://YOUR_DOMAIN/api/webhooks/whatsapp

4. Set the Verify Token to the exact value used in WHATSAPP_VERIFY_TOKEN.
5. Subscribe only to required fields.
6. Validate both webhook verification and signed POST delivery before enabling customer traffic.
7. Create and approve templates for proactive morning briefs where WhatsApp policy requires them, including the language code configured in the notification payload.
8. Create one connected tenant integration record per permitted sender phone ID. Do not attach the same sender to multiple tenants.

## Telegram setup

1. Create a bot through BotFather.
2. Store TELEGRAM_BOT_TOKEN and a strong TELEGRAM_WEBHOOK_SECRET in server-only variables.
3. Register:

       https://YOUR_DOMAIN/api/webhooks/telegram

4. Confirm the configured secret token is sent and rejected when invalid.
5. Link the chat to an authenticated tenant before agent processing. Confirm an inbound text creates one conversation message, one agent run, and one approval request before approving any delivery.

## Hermes VPS deployment

Run Hermes as a separate service on a Linux VPS or container platform. It should expose a private HTTPS endpoint that the SaaS can call with HERMES_BRIDGE_URL and HERMES_BRIDGE_TOKEN.

The bridge must accept user message context and allowed tool intents, then return a proposed reply and tool intents. It must not hold Supabase service-role keys, Google refresh tokens, WhatsApp tokens, or Maps keys.

Use a reverse proxy, TLS, an allowlist for SaaS egress, container health checks, structured logs, and process restart policy. See HERMES.md.

## Vercel deployment

1. Create a Vercel project connected to this repository.
2. Add all environment variables from ENVIRONMENT.md, separating Development, Preview, and Production values. Production must include both `SUPABASE_SERVICE_ROLE_KEY` and a unique 32+-character `CRON_SECRET`; worker routes intentionally return 503 until both are present.
3. Set APP_URL to the deployed canonical URL.
4. Deploy a preview and run authentication, Google callback, onboarding, webhooks, and health endpoint checks.
5. Promote only after the production security checklist is complete.

Set NEXT_SERVER_ACTIONS_ENCRYPTION_KEY to one stable base64-encoded 32-byte value across all deployment instances. If a reverse proxy serves the app from a different origin, configure the exact allowed Server Action origins in next.config.ts.

For a Vercel Hobby deployment, `vercel.json` intentionally does not register
high-frequency Vercel Cron entries. The Supabase Free pg_cron and pg_net
extensions dispatch the same four protected worker routes every five minutes,
with the canonical production URL and bearer value stored only in Supabase
Vault. Set a long random `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in the
Vercel Production environment before enabling that schedule. Review each job
response and its tenant audit records before enabling customer traffic.

Long-running workers, queue consumers, and Hermes should not be deployed as Vercel request handlers. Use a VPS or durable job platform for those workloads.
