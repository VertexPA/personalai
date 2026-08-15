import { serverEnv, isProduction } from "@/lib/env";
import { isCronWorkerConfigured } from "@/lib/jobs/cron-auth";
import { getConfiguredLlmProviderName } from "@/lib/llm/provider";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET() {
  const llmProvider = getConfiguredLlmProviderName();
  const hermesConfigured = Boolean(
    serverEnv.HERMES_BRIDGE_URL && serverEnv.HERMES_BRIDGE_TOKEN,
  );
  const telegramConfigured = Boolean(
    serverEnv.TELEGRAM_BOT_TOKEN && serverEnv.TELEGRAM_WEBHOOK_SECRET,
  );
  const database = isSupabaseConfigured() ? "configured" : "development_mock";
  const agent = hermesConfigured
    ? "configured_hermes"
    : llmProvider
      ? "configured_" + llmProvider
      : "development_mock";
  const scheduler = isCronWorkerConfigured()
    ? "configured"
    : "not_configured";
  const integrations = telegramConfigured
    ? "configured_telegram"
    : "not_configured";
  const liveDependenciesReady =
    database === "configured" &&
    agent !== "development_mock" &&
    scheduler === "configured" &&
    integrations === "configured_telegram";

  return Response.json({
    status: isProduction() && !liveDependenciesReady ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    components: {
      application: "healthy",
      database,
      agent,
      integrations,
      scheduler,
    },
  });
}
