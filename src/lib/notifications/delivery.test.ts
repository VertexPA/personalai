import { describe, expect, it } from "vitest";

import {
  DurableNotificationDeliveryExecutor,
  type ClaimedNotification,
  type NotificationDeliveryRepository,
} from "@/lib/notifications/delivery";
import { NotificationDeliveryError } from "@/lib/notifications/errors";

const notification: ClaimedNotification = {
  id: "notification-1",
  organizationId: "organization-1",
  recipientUserId: "user-1",
  channel: "telegram",
  notificationType: "morning_brief",
  subject: "Good morning",
  body: "Your briefing",
  payload: {},
  idempotencyKey: "brief-1",
  deliveryAttempts: 1,
};

class FakeRepository implements NotificationDeliveryRepository {
  public ids: string[] = [];
  public claimed = new Map<string, ClaimedNotification>();
  public staleBefore: Date | null = null;
  public completions: Array<{
    id: string;
    outcome: "sent" | "delivered" | "failed";
    providerMessageId?: string;
    errorCode?: string;
  }> = [];

  async failStaleDeliveries(startedBefore: Date): Promise<number> {
    this.staleBefore = startedBefore;
    return 1;
  }

  async listQueuedNotificationIds(): Promise<string[]> {
    return this.ids;
  }

  async claimQueuedNotification(id: string): Promise<ClaimedNotification | null> {
    const claimed = this.claimed.get(id) ?? null;
    this.claimed.delete(id);
    return claimed;
  }

  async completeDelivery(
    id: string,
    outcome: "sent" | "delivered" | "failed",
    providerMessageId?: string,
    errorCode?: string,
  ): Promise<void> {
    this.completions.push({ id, outcome, providerMessageId, errorCode });
  }
}

describe("DurableNotificationDeliveryExecutor", () => {
  it("claims once and records the provider acceptance", async () => {
    const repository = new FakeRepository();
    repository.ids = [notification.id, notification.id];
    repository.claimed.set(notification.id, notification);
    let deliveries = 0;

    const summary = await new DurableNotificationDeliveryExecutor(repository, {
      async deliver() {
        deliveries += 1;
        return {
          provider: "telegram",
          providerMessageId: "telegram-123",
          status: "sent",
        };
      },
    }).run({ now: new Date("2026-08-12T00:00:00.000Z") });

    expect(deliveries).toBe(1);
    expect(summary).toMatchObject({ staleFailed: 1, claimed: 1, sent: 1 });
    expect(repository.staleBefore?.toISOString()).toBe(
      "2026-08-11T23:50:00.000Z",
    );
    expect(repository.completions).toEqual([
      {
        id: notification.id,
        outcome: "sent",
        providerMessageId: "telegram-123",
        errorCode: undefined,
      },
    ]);
  });

  it("fails closed without persisting a provider error message", async () => {
    const repository = new FakeRepository();
    repository.ids = [notification.id];
    repository.claimed.set(notification.id, notification);

    const summary = await new DurableNotificationDeliveryExecutor(repository, {
      async deliver() {
        throw new NotificationDeliveryError(
          "telegram_not_configured",
          "Secret configuration detail",
        );
      },
    }).run();

    expect(summary).toMatchObject({ failed: 1, finalizationFailures: 0 });
    expect(repository.completions).toEqual([
      {
        id: notification.id,
        outcome: "failed",
        providerMessageId: undefined,
        errorCode: "telegram_not_configured",
      },
    ]);
  });

  it("can deliver only a trusted fast-path notification without reconciling global work", async () => {
    const repository = new FakeRepository();
    repository.ids = ["unrelated-notification"];
    repository.claimed.set(notification.id, notification);

    const summary = await new DurableNotificationDeliveryExecutor(repository, {
      async deliver() {
        return {
          provider: "telegram",
          providerMessageId: "telegram-456",
          status: "sent",
        };
      },
    }).run({
      notificationIds: [notification.id, notification.id],
      reconcileStale: false,
    });

    expect(summary).toMatchObject({
      staleFailed: 0,
      inspected: 1,
      claimed: 1,
      sent: 1,
    });
    expect(repository.staleBefore).toBeNull();
    expect(repository.completions).toHaveLength(1);
  });
});
