import { Bot, ShieldCheck } from "lucide-react";

import { AssistantConsole } from "@/components/assistant/assistant-console";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { serverEnv } from "@/lib/env";
import { getConfiguredLlmProviderName } from "@/lib/llm/provider";

export default function AssistantPage() {
  const hermesConfigured = Boolean(
    serverEnv.HERMES_BRIDGE_URL && serverEnv.HERMES_BRIDGE_TOKEN,
  );
  const directLlmProvider = getConfiguredLlmProviderName();
  const runtimeProvider = hermesConfigured
    ? "HermesAgentProvider"
    : directLlmProvider
      ? directLlmProvider + " response-only"
      : "MockAgentProvider";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hermes-compatible agent boundary"
        title="Assistant"
        description="Ava can reason over your schedule, preferences, and permitted integration context. Sensitive execution stays outside the agent runtime."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.7fr)]">
        <AssistantConsole />
        <div className="space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4 text-primary" />
                Runtime status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Agent provider</span>
                <Badge variant="outline">{runtimeProvider}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Hermes bridge</span>
                <Badge variant={hermesConfigured ? "secondary" : "outline"}>
                  {hermesConfigured ? "Configured" : "Not configured"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tool access</span>
                <Badge variant="secondary">Gateway only</Badge>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardContent className="flex gap-3 p-4">
              <ShieldCheck className="mt-0.5 size-5 text-emerald-600" />
              <p className="text-sm leading-6 text-muted-foreground">
                Any meeting move, cancellation, email send, or external message
                must pass tenant entitlement, role, approval, and idempotency checks.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
