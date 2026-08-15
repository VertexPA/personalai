import "server-only";

export interface ClaimedInboundAgentRun {
  id: string;
  organizationId: string;
  sessionId: string;
  inputMessageId: string;
  userId: string | null;
  channel: "whatsapp" | "telegram";
  externalConversationId: string | null;
  message: string;
  executionAttempts: number;
}

export interface InboundAgentReply {
  reply: string;
  provider: string;
  model?: string;
}

export interface InboundAgentRunRepository {
  failStaleRuns(startedBefore: Date): Promise<number>;
  listQueuedRunIds(limit: number): Promise<string[]>;
  claimQueuedRun(runId: string): Promise<ClaimedInboundAgentRun | null>;
  completeRun(
    runId: string,
    outcome: "succeeded" | "failed",
    reply?: InboundAgentReply,
    errorCode?: string,
  ): Promise<void>;
}

export interface InboundAgentRunHandler {
  execute(run: ClaimedInboundAgentRun): Promise<InboundAgentReply>;
}

export interface InboundAgentExecutionSummary {
  staleFailed: number;
  inspected: number;
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  finalizationFailures: number;
}

/**
 * The agent has no provider side effect. A claimed run can make one reasoning
 * request and its reply is then converted into a separate durable, low-risk
 * notification action. High-risk tool actions retain their approval gate.
 */
export class DurableInboundAgentRunExecutor {
  public constructor(
    private readonly repository: InboundAgentRunRepository,
    private readonly handler: InboundAgentRunHandler,
  ) {}

  async run(input: {
    now?: Date;
    limit?: number;
    staleAfterMs?: number;
    /**
     * A trusted caller may restrict execution to durable IDs it already
     * resolved for one tenant. Queue workers omit this and drain normally.
     */
    runIds?: readonly string[];
    /** Skip global stale-work reconciliation for a single-item fast path. */
    reconcileStale?: boolean;
  } = {}): Promise<InboundAgentExecutionSummary> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const staleAfterMs = input.staleAfterMs ?? 10 * 60_000;
    const staleFailed = input.reconcileStale === false
      ? 0
      : await this.repository.failStaleRuns(
          new Date(now.getTime() - staleAfterMs),
        );
    const ids = input.runIds
      ? [...new Set(input.runIds.filter((id) => id.length > 0))].slice(0, limit)
      : [...new Set(await this.repository.listQueuedRunIds(limit))];
    const summary: InboundAgentExecutionSummary = {
      staleFailed,
      inspected: ids.length,
      claimed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      finalizationFailures: 0,
    };

    for (const runId of ids) {
      const run = await this.repository.claimQueuedRun(runId);
      if (!run) {
        summary.skipped += 1;
        continue;
      }

      summary.claimed += 1;
      try {
        const reply = await this.handler.execute(run);
        await this.repository.completeRun(run.id, "succeeded", reply);
        summary.succeeded += 1;
      } catch {
        try {
          await this.repository.completeRun(
            run.id,
            "failed",
            undefined,
            "inbound_agent_execution_failed",
          );
        } catch {
          // The database stale-run transition fails closed rather than replaying
          // a reasoning request whose external provider outcome is unknown.
          summary.finalizationFailures += 1;
        }
        summary.failed += 1;
      }
    }

    return summary;
  }
}
