import "server-only";

import { ControlledToolActionError } from "@/lib/tool-actions/errors";

export interface ClaimedToolAction {
  id: string;
  organizationId: string;
  action: string;
  toolName: string;
  riskLevel: string;
  idempotencyKey: string;
  requestPayload: unknown;
  requestedBy: string | null;
  executionAttempts: number;
}

export interface ToolActionExecutionRepository {
  failStaleExecutions(startedBefore: Date): Promise<number>;
  listApprovedActionIds(limit: number): Promise<string[]>;
  claimApprovedAction(actionId: string): Promise<ClaimedToolAction | null>;
  completeAction(
    actionId: string,
    outcome: "succeeded" | "failed",
    resultPayload: Record<string, unknown>,
    errorCode?: string,
  ): Promise<void>;
}

export interface ToolActionHandler {
  execute(action: ClaimedToolAction): Promise<Record<string, unknown>>;
}

export interface ToolActionExecutionSummary {
  staleFailed: number;
  inspected: number;
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  finalizationFailures: number;
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof ControlledToolActionError &&
    /^[a-z0-9_]{3,96}$/.test(error.code)
  ) {
    return error.code;
  }

  return "tool_execution_failed";
}

/**
 * A worker-agnostic durable executor. The repository must atomically claim an
 * approved row before the handler reaches a provider, so concurrent cron or
 * VPS deliveries cannot execute the same controlled action twice.
 */
export class DurableToolActionExecutor {
  public constructor(
    private readonly repository: ToolActionExecutionRepository,
    private readonly handler: ToolActionHandler,
  ) {}

  async run(input: {
    now?: Date;
    limit?: number;
    staleAfterMs?: number;
    /**
     * A trusted caller may restrict execution to durable IDs it already
     * resolved for one tenant. Queue workers omit this and drain normally.
     */
    actionIds?: readonly string[];
    /** Skip global stale-work reconciliation for a single-item fast path. */
    reconcileStale?: boolean;
  } = {}): Promise<ToolActionExecutionSummary> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const staleAfterMs = input.staleAfterMs ?? 10 * 60_000;
    const staleFailed = input.reconcileStale === false
      ? 0
      : await this.repository.failStaleExecutions(
          new Date(now.getTime() - staleAfterMs),
        );
    const ids = input.actionIds
      ? [...new Set(input.actionIds.filter((id) => id.length > 0))].slice(0, limit)
      : [...new Set(await this.repository.listApprovedActionIds(limit))];
    const summary: ToolActionExecutionSummary = {
      staleFailed,
      inspected: ids.length,
      claimed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      finalizationFailures: 0,
    };

    for (const actionId of ids) {
      const action = await this.repository.claimApprovedAction(actionId);
      if (!action) {
        summary.skipped += 1;
        continue;
      }

      summary.claimed += 1;
      try {
        const result = await this.handler.execute(action);
        await this.repository.completeAction(action.id, "succeeded", result);
        summary.succeeded += 1;
      } catch (error) {
        try {
          await this.repository.completeAction(
            action.id,
            "failed",
            {},
            safeErrorCode(error),
          );
        } catch {
          // Leave the action in executing state. The repository's stale-action
          // recovery marks it as an unknown outcome; it never replays it.
          summary.finalizationFailures += 1;
        }
        summary.failed += 1;
      }
    }

    return summary;
  }
}
