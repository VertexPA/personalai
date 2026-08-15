import "server-only";

import { runInboundTelegramAgentRunImmediately } from "@/lib/agent/inbound-runner";
import {
  runAutomaticTelegramReplyNotificationImmediately,
} from "@/lib/notifications/runner";
import {
  runAutomaticTelegramReplyToolActionImmediately,
} from "@/lib/tool-actions/runner";

export type ImmediateTelegramReplyStatus = "sent" | "queued" | "failed";

export interface ImmediateTelegramReplyResult {
  status: ImmediateTelegramReplyStatus;
}

/**
 * Completes the ordinary response-only Telegram path within the verified
 * webhook request: one scoped agent run, its fixed low-risk delivery action,
 * and its fixed notification. Each stage still atomically claims durable work,
 * so the five-minute workers remain a safe fallback rather than a dependency
 * on the normal conversation latency.
 */
export async function runImmediateTelegramReply(input: {
  organizationId: string;
  agentRunId: string;
}): Promise<ImmediateTelegramReplyResult> {
  const agentRun = await runInboundTelegramAgentRunImmediately(input);
  if (!agentRun) {
    return { status: "queued" };
  }
  if (agentRun.failed > 0 || agentRun.finalizationFailures > 0) {
    return { status: "failed" };
  }
  if (agentRun.succeeded !== 1) {
    return { status: "queued" };
  }

  const action = await runAutomaticTelegramReplyToolActionImmediately(input);
  if (!action) {
    return { status: "queued" };
  }
  if (action.summary.failed > 0 || action.summary.finalizationFailures > 0) {
    return { status: "failed" };
  }
  if (action.summary.succeeded !== 1) {
    return { status: "queued" };
  }

  const notification = await runAutomaticTelegramReplyNotificationImmediately({
    ...input,
    toolActionId: action.toolActionId,
  });
  if (!notification) {
    return { status: "queued" };
  }
  if (
    notification.summary.failed > 0 ||
    notification.summary.finalizationFailures > 0
  ) {
    return { status: "failed" };
  }
  if (notification.summary.sent + notification.summary.delivered !== 1) {
    return { status: "queued" };
  }

  return { status: "sent" };
}
