import "server-only";

import { EntitlementService } from "@/lib/entitlements";
import { SupabaseServiceEntitlementRepository } from "@/lib/entitlements/supabase-service-repository";
import type { FeatureKey } from "@/lib/domain/types";
import type { ClaimedNotification, NotificationHandler } from "@/lib/notifications/delivery";
import {
  DurableNotificationDeliveryExecutor,
  type NotificationDeliverySummary,
} from "@/lib/notifications/delivery";
import { NotificationDeliveryError } from "@/lib/notifications/errors";
import {
  TelegramNotificationProvider,
  WebNotificationProvider,
  WhatsAppCloudNotificationProvider,
} from "@/lib/notifications/providers";
import { SupabaseNotificationDeliveryRepository } from "@/lib/notifications/supabase-delivery-repository";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface ConversationRow {
  external_conversation_id: string | null;
}

interface WhatsAppIntegrationRow {
  external_account_id: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : undefined;
}

async function resolveRecipient(notification: ClaimedNotification): Promise<string> {
  const payloadRecipient = optionalText(asRecord(notification.payload).recipient, 512);
  if (payloadRecipient) {
    return payloadRecipient;
  }
  if (!notification.recipientUserId) {
    throw new NotificationDeliveryError("notification_recipient_unresolved");
  }

  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("conversation_sessions")
    .select("external_conversation_id")
    .eq("organization_id", notification.organizationId)
    .eq("user_id", notification.recipientUserId)
    .eq("channel", notification.channel)
    .eq("status", "active")
    .not("external_conversation_id", "is", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const conversation = (data as unknown as ConversationRow | null) ?? null;
  if (error || !conversation?.external_conversation_id) {
    throw new NotificationDeliveryError("notification_recipient_unresolved");
  }
  return conversation.external_conversation_id;
}

async function resolveWhatsAppSender(organizationId: string): Promise<string> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("integrations")
    .select("external_account_id")
    .eq("organization_id", organizationId)
    .eq("provider", "whatsapp")
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const integration =
    (data as unknown as WhatsAppIntegrationRow | null) ?? null;
  if (error || !integration?.external_account_id) {
    throw new NotificationDeliveryError("whatsapp_tenant_not_connected");
  }
  return integration.external_account_id;
}

function featureForChannel(channel: ClaimedNotification["channel"]): FeatureKey | null {
  if (channel === "whatsapp" || channel === "telegram" || channel === "slack") {
    return channel;
  }
  return null;
}

class TenantNotificationHandler implements NotificationHandler {
  private readonly entitlements = new EntitlementService(
    new SupabaseServiceEntitlementRepository(),
  );
  private readonly whatsapp = new WhatsAppCloudNotificationProvider();
  private readonly telegram = new TelegramNotificationProvider();
  private readonly web = new WebNotificationProvider();

  async deliver(notification: ClaimedNotification) {
    const feature = featureForChannel(notification.channel);
    if (feature && !(await this.entitlements.hasFeature(notification.organizationId, feature))) {
      throw new NotificationDeliveryError("notification_channel_not_enabled");
    }

    const payload = asRecord(notification.payload);
    const message = {
      organizationId: notification.organizationId,
      recipient:
        notification.channel === "web"
          ? notification.recipientUserId ?? notification.id
          : await resolveRecipient(notification),
      channel: notification.channel,
      body: notification.body,
      idempotencyKey: notification.idempotencyKey ?? notification.id,
      templateName: optionalText(payload.templateName, 512),
      templateLanguage: optionalText(payload.templateLanguage, 32),
    } as const;

    if (notification.channel === "whatsapp") {
      return this.whatsapp.send({
        ...message,
        senderId: await resolveWhatsAppSender(notification.organizationId),
      });
    }
    if (notification.channel === "telegram") {
      return this.telegram.send(message);
    }
    if (notification.channel === "web") {
      return this.web.send(message);
    }

    throw new NotificationDeliveryError("slack_delivery_not_configured");
  }
}

function createNotificationDeliveryExecutor(): DurableNotificationDeliveryExecutor {
  return new DurableNotificationDeliveryExecutor(
    new SupabaseNotificationDeliveryRepository(),
    new TenantNotificationHandler(),
  );
}

/** Runs from the protected notification job route or a VPS scheduler. */
export async function runQueuedNotificationDeliveries(
  now = new Date(),
): Promise<NotificationDeliverySummary> {
  return createNotificationDeliveryExecutor().run({ now });
}

export interface ImmediateTelegramReplyNotificationExecution {
  notificationId: string;
  summary: NotificationDeliverySummary;
}

/**
 * Delivers only the queued notification causally tied to one low-risk reply.
 * The tenant, agent run, channel, and idempotency key are all fixed before an
 * external Telegram request can be made.
 */
export async function runAutomaticTelegramReplyNotificationImmediately(input: {
  organizationId: string;
  agentRunId: string;
  toolActionId: string;
}): Promise<ImmediateTelegramReplyNotificationExecution | null> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("notifications")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("channel", "telegram")
    .eq("notification_type", "assistant_reply")
    .eq("status", "queued")
    .eq("idempotency_key", "controlled-notification:" + input.toolActionId)
    .contains("payload", { agentRunId: input.agentRunId })
    .maybeSingle();
  if (error) {
    throw new Error("Could not validate the immediate reply notification.");
  }
  if (!data?.id) {
    return null;
  }

  return {
    notificationId: data.id,
    summary: await createNotificationDeliveryExecutor().run({
      notificationIds: [data.id],
      limit: 1,
      reconcileStale: false,
    }),
  };
}
