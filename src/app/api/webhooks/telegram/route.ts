import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { runImmediateTelegramReply } from "@/lib/agent/immediate-telegram-reply";
import { serverEnv } from "@/lib/env";
import { logWorkerFailure } from "@/lib/jobs/worker-error";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";

export const runtime = "nodejs";

const telegramWebhookSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({
        id: z.number().int(),
        type: z.enum(["private", "group", "supergroup", "channel"]).optional(),
      }),
      from: z
        .object({
          id: z.number().int().positive(),
          is_bot: z.boolean().optional(),
        })
        .optional(),
      date: z.number().int().optional(),
      text: z.string().max(8_000).optional(),
    })
    .optional(),
});

interface TenantConversation {
  id: string;
  organization_id: string;
  integration_id: string | null;
  user_id: string | null;
  telegram_user_id: number | null;
}

interface ProcessedWebhookRow {
  is_new: boolean;
  queued_agent_run_id: string | null;
}

interface TelegramLinkWebhookRow {
  is_new: boolean;
  linked: boolean;
}

interface RecordedWebhook {
  isNew: boolean;
  immediateReply: {
    organizationId: string;
    agentRunId: string;
  } | null;
}

function parseJson(rawPayload: string): unknown | null {
  try {
    return JSON.parse(rawPayload) as unknown;
  } catch {
    return null;
  }
}

function parsedTimestamp(timestamp: number | undefined): string | undefined {
  if (!timestamp || timestamp < 0) {
    return undefined;
  }
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function hasMatchingWebhookSecret(
  expected: string,
  provided: string | null,
): boolean {
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function telegramLinkToken(value: string | undefined): string | null {
  const match = /^\/start\s+([a-f0-9]{64})$/i.exec(value?.trim() ?? "");
  return match?.[1]?.toLowerCase() ?? null;
}

async function recordIgnoredWebhook(
  externalEventId: string,
  payloadHash: string,
): Promise<boolean> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("webhook_events")
    .upsert(
      {
        organization_id: null,
        integration_id: null,
        provider: "telegram",
        external_event_id: externalEventId,
        payload_hash: payloadHash,
        status: "ignored",
        metadata: {
          reason: "chat_not_linked_to_tenant",
        },
      },
      {
        onConflict: "provider,external_event_id",
        ignoreDuplicates: true,
      },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data !== null;
}

async function processInboundMessage(
  payload: z.infer<typeof telegramWebhookSchema>,
  conversation: TenantConversation,
  payloadHash: string,
): Promise<RecordedWebhook> {
  const message = payload.message;
  if (!message) {
    return { isNew: false, immediateReply: null };
  }
  const database = createSupabaseServiceClient();
  const { data, error } = await database.rpc("process_inbound_message", {
    p_provider: "telegram",
    p_external_event_id: String(payload.update_id),
    p_payload_hash: payloadHash,
    p_organization_id: conversation.organization_id,
    p_integration_id: conversation.integration_id,
    p_channel: "telegram",
    p_external_conversation_id: String(message.chat.id),
    p_external_message_id: String(message.message_id),
    p_body: message.text ?? null,
    p_sent_at: parsedTimestamp(message.date) ?? null,
    p_title: "Telegram chat",
    p_user_id: conversation.user_id,
    p_telegram_user_id: message.from?.id ?? null,
  });
  if (error) {
    throw error;
  }
  const row = (data as unknown as ProcessedWebhookRow[] | null)?.[0];
  const queuedAgentRunId = row?.queued_agent_run_id;
  return {
    isNew: row?.is_new === true,
    immediateReply:
      row?.is_new === true && typeof queuedAgentRunId === "string"
        ? {
            organizationId: conversation.organization_id,
            agentRunId: queuedAgentRunId,
          }
        : null,
  };
}

async function processTelegramLink(
  payload: z.infer<typeof telegramWebhookSchema>,
  token: string,
  payloadHash: string,
): Promise<boolean> {
  const message = payload.message;
  if (!message?.from) {
    return false;
  }

  const database = createSupabaseServiceClient();
  const { data, error } = await database.rpc("consume_telegram_link_token", {
    p_token: token,
    p_telegram_user_id: message.from.id,
    p_external_conversation_id: String(message.chat.id),
    p_external_event_id: String(payload.update_id),
    p_payload_hash: payloadHash,
  });
  if (error) {
    throw error;
  }

  const row = (data as unknown as TelegramLinkWebhookRow[] | null)?.[0];
  return row?.is_new === true;
}

async function recordWebhook(
  payload: z.infer<typeof telegramWebhookSchema>,
  payloadHash: string,
): Promise<RecordedWebhook> {
  const message = payload.message;
  if (
    !message?.from ||
    message.from.is_bot ||
    message.chat.type !== "private"
  ) {
    return {
      isNew: await recordIgnoredWebhook(String(payload.update_id), payloadHash),
      immediateReply: null,
    };
  }

  const linkToken = telegramLinkToken(message.text);
  if (linkToken) {
    return {
      isNew: await processTelegramLink(payload, linkToken, payloadHash),
      immediateReply: null,
    };
  }

  const externalConversationId = String(message.chat.id);
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("conversation_sessions")
    .select("id, organization_id, integration_id, user_id, telegram_user_id")
    .eq("channel", "telegram")
    .eq("external_conversation_id", externalConversationId)
    .eq("telegram_user_id", message.from.id)
    .eq("status", "active")
    .limit(2);
  if (error) {
    throw error;
  }
  const conversations = (data as unknown as TenantConversation[] | null) ?? [];
  if (
    conversations.length !== 1 ||
    !conversations[0]?.user_id ||
    !conversations[0]?.integration_id
  ) {
    return {
      isNew: await recordIgnoredWebhook(String(payload.update_id), payloadHash),
      immediateReply: null,
    };
  }

  return processInboundMessage(payload, conversations[0], payloadHash);
}

export async function POST(request: Request) {
  if (
    !serverEnv.TELEGRAM_WEBHOOK_SECRET ||
    !isSupabaseServiceConfigured()
  ) {
    return Response.json(
      {
        error:
          "Telegram webhook processing requires a configured webhook secret and Supabase project.",
      },
      { status: 503 },
    );
  }

  const providedSecret = request.headers.get(
    "x-telegram-bot-api-secret-token",
  );
  if (!hasMatchingWebhookSecret(serverEnv.TELEGRAM_WEBHOOK_SECRET, providedSecret)) {
    return Response.json({ error: "Invalid webhook secret." }, { status: 401 });
  }

  const rawPayload = await request.text();
  const payload = parseJson(rawPayload);
  if (payload === null) {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const parsed = telegramWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid Telegram payload." }, { status: 400 });
  }

  try {
    const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
    const recorded = await recordWebhook(parsed.data, payloadHash);
    if (recorded.immediateReply) {
      try {
        const result = await runImmediateTelegramReply(recorded.immediateReply);
        if (result.status === "failed") {
          logWorkerFailure(
            "telegram_immediate_reply",
            new Error("Immediate Telegram reply processing failed."),
          );
        }
      } catch (error) {
        // The inbound message is already durable. Return Telegram a success so
        // it does not repeatedly post the same update; the normal queue worker
        // can claim any stage that was not completed by this fast path.
        logWorkerFailure("telegram_immediate_reply", error);
      }
    }
    return Response.json({ received: true, duplicate: !recorded.isNew });
  } catch {
    return Response.json(
      { error: "Webhook could not be recorded safely." },
      { status: 500 },
    );
  }
}
