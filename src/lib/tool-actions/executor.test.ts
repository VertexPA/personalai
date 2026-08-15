import { describe, expect, it } from "vitest";

import {
  DurableToolActionExecutor,
  type ClaimedToolAction,
  type ToolActionExecutionRepository,
} from "@/lib/tool-actions/executor";
import { ControlledToolActionError } from "@/lib/tool-actions/errors";

const action: ClaimedToolAction = {
  id: "action-1",
  organizationId: "organization-1",
  action: "calendar.create",
  toolName: "google_calendar",
  riskLevel: "medium",
  idempotencyKey: "action-request-1",
  requestPayload: {},
  requestedBy: "user-1",
  executionAttempts: 1,
};

class FakeRepository implements ToolActionExecutionRepository {
  public staleBefore: Date | null = null;
  public completed: Array<{
    id: string;
    outcome: "succeeded" | "failed";
    result: Record<string, unknown>;
    errorCode?: string;
  }> = [];
  public claimed = new Map<string, ClaimedToolAction>();
  public ids: string[] = [];

  async failStaleExecutions(startedBefore: Date): Promise<number> {
    this.staleBefore = startedBefore;
    return 2;
  }

  async listApprovedActionIds(): Promise<string[]> {
    return this.ids;
  }

  async claimApprovedAction(actionId: string): Promise<ClaimedToolAction | null> {
    const claimed = this.claimed.get(actionId) ?? null;
    this.claimed.delete(actionId);
    return claimed;
  }

  async completeAction(
    id: string,
    outcome: "succeeded" | "failed",
    result: Record<string, unknown>,
    errorCode?: string,
  ): Promise<void> {
    this.completed.push({ id, outcome, result, errorCode });
  }
}

describe("DurableToolActionExecutor", () => {
  it("claims one durable action before executing and finalizes a safe result", async () => {
    const repository = new FakeRepository();
    repository.ids = [action.id, action.id];
    repository.claimed.set(action.id, action);
    let executions = 0;

    const summary = await new DurableToolActionExecutor(repository, {
      async execute(claimed) {
        executions += 1;
        expect(claimed.idempotencyKey).toBe("action-request-1");
        return { external_event_id: "google-event-1", cache_synced: true };
      },
    }).run({ now: new Date("2026-08-12T00:00:00.000Z") });

    expect(executions).toBe(1);
    expect(summary).toMatchObject({
      staleFailed: 2,
      inspected: 1,
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(repository.staleBefore?.toISOString()).toBe(
      "2026-08-11T23:50:00.000Z",
    );
    expect(repository.completed).toEqual([
      {
        id: action.id,
        outcome: "succeeded",
        result: { external_event_id: "google-event-1", cache_synced: true },
        errorCode: undefined,
      },
    ]);
  });

  it("does not execute an action another worker already claimed", async () => {
    const repository = new FakeRepository();
    repository.ids = [action.id];
    let executions = 0;

    const summary = await new DurableToolActionExecutor(repository, {
      async execute() {
        executions += 1;
        return {};
      },
    }).run();

    expect(executions).toBe(0);
    expect(summary).toMatchObject({ claimed: 0, skipped: 1 });
    expect(repository.completed).toEqual([]);
  });

  it("records only a safe failure code and never provider error text", async () => {
    const repository = new FakeRepository();
    repository.ids = [action.id];
    repository.claimed.set(action.id, action);

    const summary = await new DurableToolActionExecutor(repository, {
      async execute() {
        throw new ControlledToolActionError(
          "calendar_not_selected_or_writable",
          "Provider detail that must not be persisted.",
        );
      },
    }).run();

    expect(summary).toMatchObject({ failed: 1, finalizationFailures: 0 });
    expect(repository.completed).toEqual([
      {
        id: action.id,
        outcome: "failed",
        result: {},
        errorCode: "calendar_not_selected_or_writable",
      },
    ]);
  });

  it("can execute only a trusted fast-path action without reconciling global work", async () => {
    const repository = new FakeRepository();
    repository.ids = ["unrelated-action"];
    repository.claimed.set(action.id, action);

    const summary = await new DurableToolActionExecutor(repository, {
      async execute() {
        return { notificationId: "notification-1" };
      },
    }).run({ actionIds: [action.id, action.id], reconcileStale: false });

    expect(summary).toMatchObject({
      staleFailed: 0,
      inspected: 1,
      claimed: 1,
      succeeded: 1,
    });
    expect(repository.staleBefore).toBeNull();
    expect(repository.completed).toHaveLength(1);
  });
});
