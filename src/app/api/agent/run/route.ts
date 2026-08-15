import { z } from "zod";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { getAssistantRuntimeContext } from "@/data/agent-context";
import {
  HermesAgentProvider,
  LlmAgentProvider,
  MockAgentProvider,
} from "@/lib/agent/provider";
import { demoOrganization, demoUser } from "@/lib/demo/data";
import { serverEnv } from "@/lib/env";
import { getServerLlmProvider } from "@/lib/llm/provider";
import { canPerformAction } from "@/lib/permissions";
import { checkInMemoryRateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { toolActions } from "@/lib/domain/types";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
});

function getRequestIdentifier(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function POST(request: Request) {
  const rateLimit = checkInMemoryRateLimit({
    identifier: "agent-run:" + getRequestIdentifier(request),
    limit: 20,
    windowMilliseconds: 60_000,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "A message between 1 and 4,000 characters is required." },
      { status: 400 },
    );
  }

  if (isSupabaseConfigured()) {
    const workspace = await getActiveTenantWorkspace();
    if (!workspace) {
      return Response.json(
        { error: "Create or select a workspace before using the assistant." },
        { status: 409 },
      );
    }

    if (!canPerformAction(workspace.role, "assistant.use")) {
      return Response.json(
        { error: "Your organization role cannot use the assistant." },
        { status: 403 },
      );
    }

    try {
      const hermesConfigured = Boolean(
        serverEnv.HERMES_BRIDGE_URL && serverEnv.HERMES_BRIDGE_TOKEN,
      );
      const configuredLlm = hermesConfigured ? null : getServerLlmProvider();
      const agent = hermesConfigured
          ? new HermesAgentProvider(
              serverEnv.HERMES_BRIDGE_URL,
              serverEnv.HERMES_BRIDGE_TOKEN,
            )
          : configuredLlm
            ? new LlmAgentProvider(configuredLlm)
            : new MockAgentProvider();
      const context = await getAssistantRuntimeContext(
        workspace.organizationId,
        workspace.userId,
        { assistantName: "Ava", timezone: workspace.timezone },
      );
      const result = await agent.run({
        organizationId: workspace.organizationId,
        userId: workspace.userId,
        conversationId: "web:" + workspace.userId,
        message: parsed.data.message,
        availableTools: [...toolActions],
        context,
      });

      return Response.json({
        ...result,
        mode:
          result.provider === "hermes"
            ? "live_intent"
            : result.provider === "mock"
              ? "mock_intent"
              : "live_response_only",
        notice:
          result.provider === "hermes"
            ? "The agent returns proposed intents only. Every external action must still pass the tenant-aware ToolGateway."
            : result.provider === "mock"
              ? "No external action was executed. A production agent returns intents to the controlled ToolGateway."
              : "This configured language model is response-only and has no tools or integration credentials. Every external action still requires the tenant-aware ToolGateway.",
      });
    } catch {
      return Response.json(
        { error: "The assistant runtime is temporarily unavailable." },
        { status: 502 },
      );
    }
  }

  const agent = new MockAgentProvider();
  const result = await agent.run({
    organizationId: demoOrganization.id,
    userId: demoUser.id,
    conversationId: "development-conversation",
    message: parsed.data.message,
    availableTools: [...toolActions],
  });

  return Response.json({
    ...result,
    mode: "mock",
    notice:
      "No external action was executed. A production agent returns intents to the controlled ToolGateway.",
  });
}
