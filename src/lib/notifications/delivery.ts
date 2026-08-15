import "server-only";

import type { NotificationDelivery } from "@/lib/notifications/service";
import { NotificationDeliveryError } from "@/lib/notifications/errors";

export interface ClaimedNotification {
  id: string;
  organizationId: string;
  recipientUserId: string | null;
  channel: "whatsapp" | "telegram" | "slack" | "web";
  notificationType: string;
  subject: string | null;
  body: string;
  payload: unknown;
  idempotencyKey: string | null;
  deliveryAttempts: number;
}

export interface NotificationDeliveryRepository {
  failStaleDeliveries(startedBefore: Date): Promise<number>;
  listQueuedNotificationIds(limit: number): Promise<string[]>;
  claimQueuedNotification(notificationId: string): Promise<ClaimedNotification | null>;
  completeDelivery(
    notificationId: string,
    outcome: "sent" | "delivered" | "failed",
    providerMessageId?: string,
    errorCode?: string,
  ): Promise<void>;
}

export interface NotificationHandler {
  deliver(notification: ClaimedNotification): Promise<NotificationDelivery>;
}

export interface NotificationDeliverySummary {
  staleFailed: number;
  inspected: number;
  claimed: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  finalizationFailures: number;
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof NotificationDeliveryError &&
    /^[a-z0-9_]{3,96}$/.test(error.code)
  ) {
    return error.code;
  }
  return "notification_delivery_failed";
}

/**
 * Durably delivers tenant notifications. Repository claims serialize workers;
 * a worker crash fails closed after the timeout instead of duplicating an
 * external message whose provider outcome is unknown.
 */
export class DurableNotificationDeliveryExecutor {
  public constructor(
    private readonly repository: NotificationDeliveryRepository,
    private readonly handler: NotificationHandler,
  ) {}

  async run(input: {
    now?: Date;
    limit?: number;
    staleAfterMs?: number;
    /**
     * A trusted caller may restrict execution to durable IDs it already
     * resolved for one tenant. Queue workers omit this and drain normally.
     */
    notificationIds?: readonly string[];
    /** Skip global stale-work reconciliation for a single-item fast path. */
    reconcileStale?: boolean;
  } = {}): Promise<NotificationDeliverySummary> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const staleAfterMs = input.staleAfterMs ?? 10 * 60_000;
    const staleFailed = input.reconcileStale === false
      ? 0
      : await this.repository.failStaleDeliveries(
          new Date(now.getTime() - staleAfterMs),
        );
    const ids = input.notificationIds
      ? [...new Set(input.notificationIds.filter((id) => id.length > 0))].slice(0, limit)
      : [...new Set(await this.repository.listQueuedNotificationIds(limit))];
    const summary: NotificationDeliverySummary = {
      staleFailed,
      inspected: ids.length,
      claimed: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      skipped: 0,
      finalizationFailures: 0,
    };

    for (const notificationId of ids) {
      const notification = await this.repository.claimQueuedNotification(
        notificationId,
      );
      if (!notification) {
        summary.skipped += 1;
        continue;
      }

      summary.claimed += 1;
      try {
        const delivery = await this.handler.deliver(notification);
        const outcome = delivery.status === "delivered" ? "delivered" : "sent";
        await this.repository.completeDelivery(
          notification.id,
          outcome,
          delivery.providerMessageId,
        );
        summary[outcome] += 1;
      } catch (error) {
        try {
          await this.repository.completeDelivery(
            notification.id,
            "failed",
            undefined,
            safeErrorCode(error),
          );
        } catch {
          summary.finalizationFailures += 1;
        }
        summary.failed += 1;
      }
    }

    return summary;
  }
}
