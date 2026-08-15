import { describe, expect, it } from "vitest";

import {
  DurableInboundAgentRunExecutor,
  type ClaimedInboundAgentRun,
  type InboundAgentRunRepository,
} from "@/lib/agent/inbound-executor";

const run: ClaimedInboundAgentRun = {
  id: "agent-run-1",
  organizationId: "organization-1",
  sessionId: "session-1",
  inputMessageId: "message-1",
  userId: null,
  channel: "telegram",
  externalConversationId: "12345",
  message: "Can you summarize my day?",
  executionAttempts: 1,
};

class FakeRepository implements InboundAgentRunRepository {
  public ids: string[] = [];
  public claimed = new Map<string, ClaimedInboundAgentRun>();
  public staleBefore: Date | null = null;
  public completions: Array<{
    id: string;
    outcome: "succeeded" | "failed";
    reply?: { reply: string; provider: string; model?: string };
    errorCode?: string;
  }> = [];

  async failStaleRuns(startedBefore: Date): Promise<number> {
    this.staleBefore = startedBefore;
    return 1;
  }

  async listQueuedRunIds(): Promise<string[]> {
    return this.ids;
  }

  async claimQueuedRun(id: string): Promise<ClaimedInboundAgentRun | null> {
    const claimed = this.claimed.get(id) ?? null;
    this.claimed.delete(id);
    return claimed;
  }

  async completeRun(
    id: string,
    outcome: "succeeded" | "failed",
    reply?: { reply: string; provider: string; model?: string },
    errorCode?: string,
  ): Promise<void> {
    this.completions.push({ id, outcome, reply, errorCode });
  }
}

describe("DurableInboundAgentRunExecutor", () => {
  it("claims a queued inbound message once and creates one approval-gated reply", async () => {
    const repository = new FakeRepository();
    repository.ids = [run.id, run.id];
    repository.claimed.set(run.id, run);
    let executions = 0;

    const summary = await new DurableInboundAgentRunExecutor(repository, {
      async execute(claimed) {
        executions += 1;
        expect(claimed.message).toBe("Can you summarize my day?");
        return { reply: "Here is your day at a glance.", provider: "mock" };
      },
    }).run({ now: new Date("2026-08-12T00:00:00.000Z") });

    expect(executions).toBe(1);
    expect(summary).toMatchObject({
      staleFailed: 1,
      inspected: 1,
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(repository.staleBefore?.toISOString()).toBe(
      "2026-08-11T23:50:00.000Z",
    );
    expect(repository.completions).toEqual([
      {
        id: run.id,
        outcome: "succeeded",
        reply: { reply: "Here is your day at a glance.", provider: "mock" },
        errorCode: undefined,
      },
    ]);
  });

  it("fails closed with a safe code when the agent cannot reply", async () => {
    const repository = new FakeRepository();
    repository.ids = [run.id];
    repository.claimed.set(run.id, run);

    const summary = await new DurableInboundAgentRunExecutor(repository, {
      async execute() {
        throw new Error("Provider response contains implementation detail");
      },
    }).run();

    expect(summary).toMatchObject({ failed: 1, finalizationFailures: 0 });
    expect(repository.completions).toEqual([
      {
        id: run.id,
        outcome: "failed",
        reply: undefined,
        errorCode: "inbound_agent_execution_failed",
      },
    ]);
  });

  it("can execute only a trusted fast-path run without reconciling global work", async () => {
    const repository = new FakeRepository();
    repository.ids = ["unrelated-run"];
    repository.claimed.set(run.id, run);

    const summary = await new DurableInboundAgentRunExecutor(repository, {
      async execute() {
        return { reply: "Fast reply.", provider: "mock" };
      },
    }).run({ runIds: [run.id, run.id], reconcileStale: false });

    expect(summary).toMatchObject({
      staleFailed: 0,
      inspected: 1,
      claimed: 1,
      succeeded: 1,
    });
    expect(repository.staleBefore).toBeNull();
    expect(repository.completions).toHaveLength(1);
  });
});
