import { createHash } from "node:crypto";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { verifyHmacSha256 } from "@/lib/webhooks/signatures";

const whatsAppWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z
            .object({
              metadata: z
                .object({
                  phone_number_id: z.string(),
                })
                .optional(),
              messages: z
                .array(
                  z.object({
                    id: z.string().min(1).max(1024),
                    from: z.string().min(1).max(512),
                    timestamp: z.string().regex(/^\d{1,16}$/).optional(),
                    type: z.string().max(64).optional(),
                    text: z
                      .object({
                        body: z.string().max(8000),
                      })
                      .optional(),
                  }).passthrough(),
                )
                .optional(),
            })
            .passthrough(),
        }),
      ),
    }),
  ),
});

type WhatsAppWebhookPayload = z.infer<typeof whatsAppWebhookSchema>;
type WhatsAppMessage = NonNullable<
  WhatsAppWebhookPayload["entry"][number]["changes"][number]["value"]["messages"]
>[number];

interface TenantIntegration {
  id: string;
  organization_id: string;
}

interface ProcessedWebhookRow {
  is_new: boolean;
}

function parseJson(rawPayload: string): unknown | null {
  try {
    return JSON.parse(rawPayload) as unknown;
  } catch {
    return null;
  }
}

function parsedTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp) {
    return undefined;
  }
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function resolveIntegration(
  phoneNumberId: string,
): Promise<TenantIntegration | null> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("integrations")
    .select("id, organization_id")
    .eq("provider", "whatsapp")
    .eq("external_account_id", phoneNumberId)
    .eq("status", "connected")
    .limit(2);
  if (error) {
    throw error;
  }
  const integrations = (data as unknown as TenantIntegration[] | null) ?? [];
  return integrations.length === 1 ? integrations[0] : null;
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
        provider: "whatsapp",
        external_event_id: externalEventId,
        payload_hash: payloadHash,
        status: "ignored",
        metadata: {
          reason: "no_unique_connected_integration",
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
  integration: TenantIntegration,
  message: WhatsAppMessage,
  payloadHash: string,
): Promise<boolean> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database.rpc("process_inbound_message", {
    p_provider: "whatsapp",
    p_external_event_id: message.id,
    p_payload_hash: payloadHash,
    p_organization_id: integration.organization_id,
    p_integration_id: integration.id,
    p_channel: "whatsapp",
    p_external_conversation_id: message.from,
    p_external_message_id: message.id,
    p_body: message.text?.body ?? null,
    p_sent_at: parsedTimestamp(message.timestamp) ?? null,
    p_title: "WhatsApp chat",
  });
  if (error) {
    throw error;
  }
  const row = (data as unknown as ProcessedWebhookRow[] | null)?.[0];
  return row?.is_new === true;
}

async function recordWebhook(
  payload: WhatsAppWebhookPayload,
  payloadHash: string,
): Promise<number> {
  let recorded = 0;

  for (const [entryIndex, entry] of payload.entry.entries()) {
    for (const [changeIndex, change] of entry.changes.entries()) {
      const messages = change.value.messages ?? [];
      const phoneNumberId = change.value.metadata?.phone_number_id;
      const integration = phoneNumberId
        ? await resolveIntegration(phoneNumberId)
        : null;

      if (messages.length === 0) {
        const wasRecorded = await recordIgnoredWebhook(
          payloadHash + ":" + entryIndex + ":" + changeIndex,
          payloadHash,
        );
        recorded += wasRecorded ? 1 : 0;
        continue;
      }

      for (const message of messages) {
        const wasRecorded = integration
          ? await processInboundMessage(integration, message, payloadHash)
          : await recordIgnoredWebhook(message.id, payloadHash);
        recorded += wasRecorded ? 1 : 0;
      }
    }
  }

  return recorded;
}

export async function GET(request: Request) {
  if (!serverEnv.WHATSAPP_VERIFY_TOKEN) {
    return Response.json(
      { error: "WhatsApp webhook is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    verifyToken === serverEnv.WHATSAPP_VERIFY_TOKEN &&
    challenge
  ) {
    return new Response(challenge, { status: 200 });
  }

  return Response.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  if (!serverEnv.WHATSAPP_APP_SECRET || !isSupabaseConfigured()) {
    return Response.json(
      {
        error:
          "WhatsApp webhook processing requires a configured app secret and Supabase project.",
      },
      { status: 503 },
    );
  }

  const rawPayload = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyHmacSha256(rawPayload, serverEnv.WHATSAPP_APP_SECRET, signature)) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const payload = parseJson(rawPayload);
  if (payload === null) {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const parsed = whatsAppWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid WhatsApp payload." }, { status: 400 });
  }

  try {
    const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
    const recorded = await recordWebhook(parsed.data, payloadHash);
    return Response.json({ received: true, duplicate: recorded === 0 });
  } catch {
    return Response.json(
      { error: "Webhook could not be recorded safely." },
      { status: 500 },
    );
  }
}
