import { describe, expect, it } from "vitest";

import {
  TelegramNotificationProvider,
  WhatsAppCloudNotificationProvider,
} from "@/lib/notifications/providers";

describe("outbound notification providers", () => {
  it("sends WhatsApp through a tenant-supplied sender ID without exposing the token", async () => {
    let request: { url: string; body: Record<string, unknown>; authorization: string | null } | null = null;
    const provider = new WhatsAppCloudNotificationProvider(
      { accessToken: "server-only-token", graphApiVersion: "v99.0" },
      async (url, init) => {
        request = {
          url,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          authorization: new Headers(init?.headers).get("Authorization"),
        };
        return Response.json({ messages: [{ id: "wamid.123" }] });
      },
    );

    const result = await provider.send({
      organizationId: "organization-1",
      channel: "whatsapp",
      recipient: "60123456789",
      body: "Your meeting starts soon.",
      idempotencyKey: "message-1",
      senderId: "phone-number-id",
    });

    expect(result).toEqual({
      provider: "whatsapp",
      providerMessageId: "wamid.123",
      status: "sent",
    });
    expect(request).toMatchObject({
      url: "https://graph.facebook.com/v99.0/phone-number-id/messages",
      body: { to: "60123456789", type: "text" },
      authorization: "Bearer server-only-token",
    });
  });

  it("requires an explicit language for a WhatsApp template", async () => {
    const provider = new WhatsAppCloudNotificationProvider({
      accessToken: "server-only-token",
      graphApiVersion: "v99.0",
    });

    await expect(
      provider.send({
        organizationId: "organization-1",
        channel: "whatsapp",
        recipient: "60123456789",
        body: "Morning brief",
        idempotencyKey: "message-1",
        senderId: "phone-number-id",
        templateName: "morning_brief",
      }),
    ).rejects.toMatchObject({ code: "whatsapp_template_language_required" });
  });

  it("sends Telegram messages through the server-only bot endpoint", async () => {
    let requestUrl = "";
    const provider = new TelegramNotificationProvider(
      { botToken: "server-only-bot" },
      async (url) => {
        requestUrl = url;
        return Response.json({ ok: true, result: { message_id: 41 } });
      },
    );

    const result = await provider.send({
      organizationId: "organization-1",
      channel: "telegram",
      recipient: "123456",
      body: "Your briefing",
      idempotencyKey: "message-2",
    });

    expect(result).toEqual({ provider: "telegram", providerMessageId: "41", status: "sent" });
    expect(requestUrl).toBe("https://api.telegram.org/botserver-only-bot/sendMessage");
  });
});
