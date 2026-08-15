import "server-only";

import { serverEnv } from "@/lib/env";

const secretValues = [
  serverEnv.SUPABASE_SERVICE_ROLE_KEY,
  serverEnv.CRON_SECRET,
  serverEnv.OPENROUTER_API_KEY,
  serverEnv.TELEGRAM_BOT_TOKEN,
  serverEnv.TELEGRAM_WEBHOOK_SECRET,
  serverEnv.HERMES_BRIDGE_TOKEN,
  serverEnv.INTEGRATION_ENCRYPTION_KEY,
  serverEnv.WHATSAPP_APP_SECRET,
  serverEnv.WHATSAPP_VERIFY_TOKEN,
  serverEnv.WHATSAPP_ACCESS_TOKEN,
  serverEnv.GOOGLE_OAUTH_CLIENT_SECRET,
  serverEnv.GOOGLE_ROUTES_API_KEY,
].filter((value): value is string => Boolean(value));

function redactWorkerError(error: unknown): string {
  let message = error instanceof Error ? error.message : "Unknown worker failure.";
  for (const secret of secretValues) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message.slice(0, 500);
}

/** Logs an operationally useful, secret-redacted worker failure server-side. */
export function logWorkerFailure(worker: string, error: unknown): void {
  console.error("ava_worker_failure", {
    worker,
    error: redactWorkerError(error),
  });
}
