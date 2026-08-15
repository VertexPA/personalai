import "server-only";

import { getAssistantRuntimeContextForService } from "@/data/agent-context";
import {
  HermesAgentProvider,
  LlmAgentProvider,
  MockAgentProvider,
  type AgentProvider,
} from "@/lib/agent/provider";
import {
  DurableInboundAgentRunExecutor,
  type ClaimedInboundAgentRun,
  type InboundAgentReply,
  type InboundAgentRunHandler,
  type InboundAgentRunRepository,
  type InboundAgentExecutionSummary,
} from "@/lib/agent/inbound-executor";
import { toolActions } from "@/lib/domain/types";
import { serverEnv } from "@/lib/env";
import { getServerLlmProvider } from "@/lib/llm/provider";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface AgentRunIdRow {
  agent_run_id: string;
}

interface ClaimedAgentRunRow {
  id: string;
  organization_id: string;
  session_id: string;
  input_message_id: string;
  user_id: string | null;
  channel: "whatsapp" | "telegram";
  external_conversation_id: string | null;
  message_body: string;
  execution_attempts: number;
}

class SupabaseInboundAgentRunRepository implements InboundAgentRunRepository {
  async failStaleRuns(startedBefore: Date): Promise<number> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc("fail_stale_inbound_agent_runs", {
      p_started_before: startedBefore.toISOString(),
    });
    if (error) {
      throw new Error("Could not reconcile stale inbound agent runs.");
    }
    return typeof data === "number" ? data : 0;
  }

  async listQueuedRunIds(limit: number): Promise<string[]> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc(
      "list_queued_inbound_agent_run_ids",
      { p_limit: limit },
    );
    if (error) {
      throw new Error("Could not read queued inbound agent runs.");
    }
    return ((data as unknown as AgentRunIdRow[] | null) ?? [])
      .map((row) => row.agent_run_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async claimQueuedRun(runId: string): Promise<ClaimedInboundAgentRun | null> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc("claim_queued_inbound_agent_run", {
      p_agent_run_id: runId,
    });
    if (error) {
      throw new Error("Could not claim inbound agent run.");
    }
    const row = (data as unknown as ClaimedAgentRunRow[] | null)?.[0];
    if (!row || (row.channel !== "whatsapp" && row.channel !== "telegram")) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      sessionId: row.session_id,
      inputMessageId: row.input_message_id,
      userId: row.user_id,
      channel: row.channel,
      externalConversationId: row.external_conversation_id,
      message: row.message_body,
      executionAttempts: row.execution_attempts,
    };
  }

  async completeRun(
    runId: string,
    outcome: "succeeded" | "failed",
    reply?: InboundAgentReply,
    errorCode?: string,
  ): Promise<void> {
    const database = createSupabaseServiceClient();
    const { error } = await database.rpc("complete_inbound_agent_run", {
      p_agent_run_id: runId,
      p_outcome: outcome,
      p_reply: reply?.reply ?? null,
      p_provider: reply?.provider ?? null,
      p_model: reply?.model ?? null,
      p_error_code: errorCode ?? null,
    });
    if (error) {
      throw new Error("Could not finalize inbound agent run.");
    }
  }
}

function createInboundAgentProvider(): AgentProvider {
  if (serverEnv.HERMES_BRIDGE_URL && serverEnv.HERMES_BRIDGE_TOKEN) {
    return new HermesAgentProvider(
      serverEnv.HERMES_BRIDGE_URL,
      serverEnv.HERMES_BRIDGE_TOKEN,
    );
  }

  const llm = getServerLlmProvider();
  return llm ? new LlmAgentProvider(llm) : new MockAgentProvider();
}

function createInboundAgentExecutor(): DurableInboundAgentRunExecutor {
  return new DurableInboundAgentRunExecutor(
    new SupabaseInboundAgentRunRepository(),
    new InboundAgentHandler(),
  );
}

class InboundAgentHandler implements InboundAgentRunHandler {
  private readonly agent = createInboundAgentProvider();

  async execute(run: ClaimedInboundAgentRun): Promise<InboundAgentReply> {
    const context = await getAssistantRuntimeContextForService(
      run.organizationId,
      run.userId,
      { assistantName: "Ava", timezone: "UTC" },
    );
    const result = await this.agent.run({
      organizationId: run.organizationId,
      userId: run.userId ?? undefined,
      conversationId: run.sessionId,
      message: run.message,
      availableTools: [...toolActions],
      context,
    });
    const reply = result.reply.trim();
    if (reply.length === 0 || reply.length > 4000) {
      throw new Error("Inbound agent reply is invalid.");
    }
    return { reply, provider: result.provider };
  }
}

/** Executes protected inbound-message reasoning and queues only proposed replies. */
export async function runQueuedInboundAgentRuns(
  now = new Date(),
): Promise<InboundAgentExecutionSummary> {
  return createInboundAgentExecutor().run({ now });
}

/**
 * Runs exactly one Telegram-originated agent run after the webhook has already
 * resolved the linked tenant and user. The scoped lookup prevents this fast
 * path from becoming a general service-role queue drain; the subsequent claim
 * remains atomic against the fallback worker.
 */
export async function runInboundTelegramAgentRunImmediately(input: {
  organizationId: string;
  agentRunId: string;
}): Promise<InboundAgentExecutionSummary | null> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("agent_runs")
    .select("id")
    .eq("id", input.agentRunId)
    .eq("organization_id", input.organizationId)
    .eq("provider", "inbound_queue")
    .eq("status", "queued")
    .maybeSingle();
  if (error) {
    throw new Error("Could not validate the immediate inbound agent run.");
  }
  if (!data?.id) {
    return null;
  }

  return createInboundAgentExecutor().run({
    runIds: [data.id],
    limit: 1,
    reconcileStale: false,
  });
}
