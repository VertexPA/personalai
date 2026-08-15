import "server-only";

import {
  executeGoogleCalendarToolAction,
} from "@/lib/integrations/google-calendar-service";
import {
  isCalendarToolActionName,
  parseCalendarToolActionInput,
} from "@/lib/tool-actions/calendar";
import { enqueueApprovedNotificationToolAction } from "@/lib/notifications/controlled-action";
import {
  DurableToolActionExecutor,
  type ClaimedToolAction,
  type ToolActionExecutionSummary,
  type ToolActionHandler,
} from "@/lib/tool-actions/executor";
import { ControlledToolActionError } from "@/lib/tool-actions/errors";
import { SupabaseToolActionExecutionRepository } from "@/lib/tool-actions/supabase-repository";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

class ProviderToolActionHandler implements ToolActionHandler {
  async execute(action: ClaimedToolAction): Promise<Record<string, unknown>> {
    if (
      action.toolName === "google_calendar" &&
      isCalendarToolActionName(action.action)
    ) {
      const input = parseCalendarToolActionInput(
        action.action,
        action.requestPayload,
      );
      return {
        ...(await executeGoogleCalendarToolAction(
          action.organizationId,
          input,
          action.idempotencyKey,
        )),
      };
    }

    if (
      action.toolName === "notification_delivery" &&
      action.action === "notification.send_external"
    ) {
      return enqueueApprovedNotificationToolAction(action.id);
    }

    throw new ControlledToolActionError("unsupported_tool_action");
  }
}

function createToolActionExecutor(): DurableToolActionExecutor {
  return new DurableToolActionExecutor(
    new SupabaseToolActionExecutionRepository(),
    new ProviderToolActionHandler(),
  );
}

/**
 * Runs from a bearer-protected route or a separate durable worker. The only
 * provider-capable path is this service-role worker, never a browser session or
 * LLM/Hermes process.
 */
export async function runApprovedToolActions(
  now = new Date(),
): Promise<ToolActionExecutionSummary> {
  return createToolActionExecutor().run({ now });
}

export interface ImmediateTelegramReplyActionExecution {
  toolActionId: string;
  summary: ToolActionExecutionSummary;
}

/**
 * Executes only the response-only action produced by one verified inbound
 * Telegram run. High-risk actions cannot satisfy this fixed low-risk query and
 * continue through their normal approval workflow.
 */
export async function runAutomaticTelegramReplyToolActionImmediately(input: {
  organizationId: string;
  agentRunId: string;
}): Promise<ImmediateTelegramReplyActionExecution | null> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("tool_actions")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("agent_run_id", input.agentRunId)
    .eq("action", "notification.send_external")
    .eq("tool_name", "notification_delivery")
    .eq("risk_level", "low")
    .eq("status", "approved")
    .eq("idempotency_key", "agent-reply:" + input.agentRunId)
    .maybeSingle();
  if (error) {
    throw new Error("Could not validate the immediate reply action.");
  }
  if (!data?.id) {
    return null;
  }

  return {
    toolActionId: data.id,
    summary: await createToolActionExecutor().run({
      actionIds: [data.id],
      limit: 1,
      reconcileStale: false,
    }),
  };
}
