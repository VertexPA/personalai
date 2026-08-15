import "server-only";

import { serverEnv } from "@/lib/env";
import { NotificationDeliveryError } from "@/lib/notifications/errors";
import type {
  NotificationDelivery,
  NotificationMessage,
  NotificationProvider,
} from "@/lib/notifications/service";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface WhatsAppCloudProviderConfig {
  accessToken: string;
  graphApiVersion: string;
}

/**
 * Server-only WhatsApp Cloud API adapter. The tenant-specific sender phone ID
 * is resolved by the delivery worker from a connected integration; this class
 * never chooses a tenant or exposes its access token to the browser.
 */
export class WhatsAppCloudNotificationProvider implements NotificationProvider {
  public readonly channel = "whatsapp" as const;

  public constructor(
    private readonly config: WhatsAppCloudProviderConfig | null =
      serverEnv.WHATSAPP_ACCESS_TOKEN && serverEnv.WHATSAPP_GRAPH_API_VERSION
        ? {
            accessToken: serverEnv.WHATSAPP_ACCESS_TOKEN,
            graphApiVersion: serverEnv.WHATSAPP_GRAPH_API_VERSION,
          }
        : null,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async send(
    message: NotificationMessage & { senderId?: string },
  ): Promise<NotificationDelivery> {
    if (!this.config || !message.senderId) {
      throw new NotificationDeliveryError("whatsapp_not_configured");
    }
    if (message.body.length === 0 || message.body.length > 4_096) {
      throw new NotificationDeliveryError("whatsapp_message_invalid");
    }

    if (message.templateName && !message.templateLanguage) {
      throw new NotificationDeliveryError("whatsapp_template_language_required");
    }

    const body = message.templateName
      ? {
          messaging_product: "whatsapp",
          to: message.recipient,
          type: "template",
          template: {
            name: message.templateName,
            language: { code: message.templateLanguage },
          },
        }
      : {
          messaging_product: "whatsapp",
          to: message.recipient,
          type: "text",
          text: { body: message.body, preview_url: false },
        };
    let response: Response;
    try {
      response = await this.fetcher(
        "https://graph.facebook.com/" +
          this.config.graphApiVersion +
          "/" +
          encodeURIComponent(message.senderId) +
          "/messages",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.config.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new NotificationDeliveryError("whatsapp_delivery_unavailable");
    }
    const payload = asRecord(await response.json().catch(() => null));
    if (!response.ok) {
      throw new NotificationDeliveryError("whatsapp_delivery_failed");
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const providerMessageId = asString(asRecord(messages[0]).id);
    if (!providerMessageId) {
      throw new NotificationDeliveryError("whatsapp_delivery_invalid_response");
    }

    return { providerMessageId, status: "sent", provider: "whatsapp" };
  }
}

export interface TelegramProviderConfig {
  botToken: string;
}

export class TelegramNotificationProvider implements NotificationProvider {
  public readonly channel = "telegram" as const;

  public constructor(
    private readonly config: TelegramProviderConfig | null =
      serverEnv.TELEGRAM_BOT_TOKEN
        ? { botToken: serverEnv.TELEGRAM_BOT_TOKEN }
        : null,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async send(message: NotificationMessage): Promise<NotificationDelivery> {
    if (!this.config) {
      throw new NotificationDeliveryError("telegram_not_configured");
    }
    if (message.body.length === 0 || message.body.length > 4_096) {
      throw new NotificationDeliveryError("telegram_message_invalid");
    }

    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.telegram.org/bot" + this.config.botToken + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: message.recipient, text: message.body }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new NotificationDeliveryError("telegram_delivery_unavailable");
    }
    const payload = asRecord(await response.json().catch(() => null));
    if (!response.ok || payload.ok !== true) {
      throw new NotificationDeliveryError("telegram_delivery_failed");
    }
    const messageId = asRecord(payload.result).message_id;
    if (typeof messageId !== "number" && typeof messageId !== "string") {
      throw new NotificationDeliveryError("telegram_delivery_invalid_response");
    }

    return {
      providerMessageId: String(messageId),
      status: "sent",
      provider: "telegram",
    };
  }
}

export class WebNotificationProvider implements NotificationProvider {
  public readonly channel = "web" as const;

  async send(message: NotificationMessage): Promise<NotificationDelivery> {
    return {
      providerMessageId: "web_" + message.idempotencyKey,
      status: "delivered",
      provider: "mock",
    };
  }
}
