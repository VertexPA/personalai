export type NotificationChannel = "whatsapp" | "telegram" | "slack" | "web";

export interface NotificationMessage {
  organizationId: string;
  recipient: string;
  channel: NotificationChannel;
  body: string;
  idempotencyKey: string;
  templateName?: string;
  templateLanguage?: string;
}

export interface NotificationDelivery {
  providerMessageId: string;
  status: "queued" | "sent" | "delivered" | "failed";
  provider: "mock" | "whatsapp" | "telegram" | "slack";
}

export interface NotificationProvider {
  channel: NotificationChannel;
  send(message: NotificationMessage): Promise<NotificationDelivery>;
}

export class NotificationService {
  private readonly providers = new Map<NotificationChannel, NotificationProvider>();

  register(provider: NotificationProvider): void {
    this.providers.set(provider.channel, provider);
  }

  async send(message: NotificationMessage): Promise<NotificationDelivery> {
    const provider = this.providers.get(message.channel);
    if (!provider) {
      throw new Error(
        "No notification provider registered for " + message.channel + ".",
      );
    }

    return provider.send(message);
  }
}

export class MockNotificationProvider implements NotificationProvider {
  public constructor(public readonly channel: NotificationChannel) {}

  async send(message: NotificationMessage): Promise<NotificationDelivery> {
    return {
      providerMessageId: "mock_" + this.channel + "_" + message.idempotencyKey,
      status: "sent",
      provider: "mock",
    };
  }
}
