import "server-only";

import type {
  ClaimedNotification,
  NotificationDeliveryRepository,
} from "@/lib/notifications/delivery";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface NotificationIdRow {
  notification_id: string;
}

interface ClaimedNotificationRow {
  id: string;
  organization_id: string;
  recipient_user_id: string | null;
  channel: ClaimedNotification["channel"];
  notification_type: string;
  subject: string | null;
  body: string;
  payload: unknown;
  idempotency_key: string | null;
  delivery_attempts: number;
}

export class SupabaseNotificationDeliveryRepository
  implements NotificationDeliveryRepository
{
  async failStaleDeliveries(startedBefore: Date): Promise<number> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc(
      "fail_stale_notification_deliveries",
      { p_started_before: startedBefore.toISOString() },
    );
    if (error) {
      throw new Error("Could not reconcile stale notification deliveries.");
    }
    return typeof data === "number" ? data : 0;
  }

  async listQueuedNotificationIds(limit: number): Promise<string[]> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc("list_queued_notification_ids", {
      p_limit: limit,
    });
    if (error) {
      throw new Error("Could not read queued notifications.");
    }
    return ((data as unknown as NotificationIdRow[] | null) ?? [])
      .map((row) => row.notification_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async claimQueuedNotification(
    notificationId: string,
  ): Promise<ClaimedNotification | null> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc("claim_queued_notification", {
      p_notification_id: notificationId,
    });
    if (error) {
      throw new Error("Could not claim queued notification.");
    }
    const row = (data as unknown as ClaimedNotificationRow[] | null)?.[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      recipientUserId: row.recipient_user_id,
      channel: row.channel,
      notificationType: row.notification_type,
      subject: row.subject,
      body: row.body,
      payload: row.payload,
      idempotencyKey: row.idempotency_key,
      deliveryAttempts: row.delivery_attempts,
    };
  }

  async completeDelivery(
    notificationId: string,
    outcome: "sent" | "delivered" | "failed",
    providerMessageId?: string,
    errorCode?: string,
  ): Promise<void> {
    const database = createSupabaseServiceClient();
    const { error } = await database.rpc("complete_notification_delivery", {
      p_notification_id: notificationId,
      p_outcome: outcome,
      p_provider_message_id: providerMessageId ?? null,
      p_error_code: errorCode ?? null,
    });
    if (error) {
      throw new Error("Could not finalize notification delivery.");
    }
  }
}
