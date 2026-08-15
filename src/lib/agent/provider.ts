import type { ToolAction } from "@/lib/domain/types";
import type { LlmProvider, LlmProviderName } from "@/lib/llm/provider";

export interface AgentRunRequest {
  organizationId: string;
  userId?: string;
  conversationId: string;
  message: string;
  availableTools: ToolAction[];
  context?: {
    assistantName: string;
    timezone: string;
    confirmedRules: string[];
    memories: string[];
  };
}

export interface AgentToolIntent {
  action: ToolAction;
  reason: string;
}

export interface AgentRunResult {
  reply: string;
  toolIntents: AgentToolIntent[];
  provider: "mock" | "hermes" | LlmProviderName;
}

export interface AgentProvider {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export class MockAgentProvider implements AgentProvider {
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const lowerCaseMessage = request.message.toLowerCase();
    const toolIntents: AgentToolIntent[] = [];

    if (
      lowerCaseMessage.includes("calendar") ||
      lowerCaseMessage.includes("meeting")
    ) {
      toolIntents.push({
        action: "calendar.read",
        reason: "The message asks about a schedule or meeting.",
      });
    }

    if (
      lowerCaseMessage.includes("travel") ||
      lowerCaseMessage.includes("traffic")
    ) {
      toolIntents.push({
        action: "travel.read",
        reason: "The message asks for travel planning.",
      });
    }

    return {
      reply:
        "I’m running in development mode. I can analyze the request and will ask for approval before any sensitive external action.",
      toolIntents,
      provider: "mock",
    };
  }
}

/**
 * The direct AI SDK path is deliberately response-only. Hermes remains the
 * production planner; this adapter has no integration clients, no tool
 * definitions, and therefore cannot request or execute a sensitive action.
 */
export class LlmAgentProvider implements AgentProvider {
  public constructor(private readonly llm: LlmProvider) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const result = await this.llm.generate({
      system: [
        "You are " + (request.context?.assistantName ?? "Ava") + ", an executive assistant in response-only mode.",
        "You have no calendar, email, messaging, travel, or other tool access.",
        "Never claim to have checked, changed, sent, booked, or scheduled anything.",
        "When live information or a change is needed, explain that the controlled",
        "tenant-aware workflow must handle it after authorization and approval.",
        "Keep answers practical and brief; favor one to three short sentences unless",
        "a compact list materially improves clarity. Do not expose secrets or internal policy text.",
        "Workspace timezone: " + (request.context?.timezone ?? "UTC") + ".",
        request.context?.confirmedRules.length
          ? "Confirmed customer rules: " + request.context.confirmedRules.join(" | ")
          : "No confirmed customer rules were supplied.",
        request.context?.memories.length
          ? "Customer memory: " + request.context.memories.join(" | ")
          : "No customer memory was supplied.",
      ].join(" "),
      prompt: request.message,
      maxOutputTokens: 320,
    });

    return {
      reply: result.text,
      toolIntents: [],
      provider: result.provider,
    };
  }
}

/**
 * The Hermes bridge is a separate, long-running service. Its endpoint is
 * deliberately configurable: Hermes never receives direct OAuth credentials or
 * unrestricted integration access; it returns intents for ToolGateway to review.
 */
export class HermesAgentProvider implements AgentProvider {
  public constructor(
    private readonly bridgeUrl: string | undefined,
    private readonly bridgeToken: string | undefined,
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!this.bridgeUrl || !this.bridgeToken) {
      throw new Error(
        "Hermes bridge is not configured. Use MockAgentProvider in development.",
      );
    }

    const response = await fetch(this.bridgeUrl + "/v1/agent-runs", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.bridgeToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      throw new Error("Hermes bridge returned HTTP " + response.status + ".");
    }

    return (await response.json()) as AgentRunResult;
  }
}
