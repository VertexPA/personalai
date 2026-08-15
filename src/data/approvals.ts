import "server-only";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ApprovalRequestView {
  id: string;
  action: string;
  summary: string;
  status: string;
  expiresAt: string | null;
  idempotencyKey: string;
  proposedMessage?: string;
  deliveryChannel?: "whatsapp" | "telegram";
}

interface ApprovalRequestRow {
  id: string;
  action: string;
  summary: string;
  status: string;
  expires_at: string | null;
  idempotency_key: string;
  tool_actions: { request_payload: unknown } | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getProposedReply(request: ApprovalRequestRow): Pick<
  ApprovalRequestView,
  "proposedMessage" | "deliveryChannel"
> {
  if (request.action !== "notification.send_external") {
    return {};
  }
  const payload = asRecord(request.tool_actions?.request_payload);
  const body = payload.body;
  const channel = payload.channel;
  if (
    typeof body !== "string" ||
    body.length === 0 ||
    body.length > 4000 ||
    (channel !== "whatsapp" && channel !== "telegram")
  ) {
    return {};
  }
  return { proposedMessage: body, deliveryChannel: channel };
}

const demoRequests: ApprovalRequestView[] = [
  {
    id: "demo-supplier-move",
    action: "calendar.move_external",
    summary:
      "Move the 2:00 PM Supplier Meeting to 2:30 PM and notify two external attendees. This prevents a predicted 7-minute travel shortfall.",
    status: "pending",
    expiresAt: "2026-08-12T07:00:00.000Z",
    idempotencyKey: "calendar-move-supplier-20260811",
  },
];

export async function getApprovalRequests(): Promise<{
  isDemoMode: boolean;
  hasWorkspace: boolean;
  requests: ApprovalRequestView[];
}> {
  if (!isSupabaseConfigured()) {
    return { isDemoMode: true, hasWorkspace: true, requests: demoRequests };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return { isDemoMode: false, hasWorkspace: false, requests: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { isDemoMode: false, hasWorkspace: true, requests: [] };
  }

  const { data, error } = await supabase
    .from("approval_requests")
    .select(
      "id, action, summary, status, expires_at, idempotency_key, tool_actions(request_payload)",
    )
    .eq("organization_id", workspace.organizationId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) {
    return { isDemoMode: false, hasWorkspace: true, requests: [] };
  }

  return {
    isDemoMode: false,
    hasWorkspace: true,
    requests: (data as unknown as ApprovalRequestRow[]).map((request) => ({
      id: request.id,
      action: request.action,
      summary: request.summary,
      status: request.status,
      expiresAt: request.expires_at,
      idempotencyKey: request.idempotency_key,
      ...getProposedReply(request),
    })),
  };
}
