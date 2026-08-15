"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasWorkspaceFeature } from "@/data/entitlements";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getZonedDateParts, zonedDateTimeToUtc } from "@/lib/timezone";

const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a valid date and time.");
const shortTextSchema = z.string().trim().min(1).max(1_024);
const attendeeEmailsSchema = z.array(z.string().trim().email().max(320)).max(100);
const eventActionFields = {
  idempotencyKey: z.string().uuid(),
  externalCalendarId: shortTextSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(8_000).optional(),
  location: z.string().trim().max(8_000).optional(),
  startsAt: localDateTimeSchema,
  endsAt: localDateTimeSchema,
  attendeeEmails: attendeeEmailsSchema.optional(),
};

const calendarToolActionRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), ...eventActionFields }),
  z.object({
    operation: z.literal("update"),
    ...eventActionFields,
    externalEventId: shortTextSchema,
  }),
  z.object({
    operation: z.literal("cancel"),
    idempotencyKey: z.string().uuid(),
    externalCalendarId: shortTextSchema,
    externalEventId: shortTextSchema,
  }),
]);

interface CalendarToolActionRpcRow {
  tool_action_id: string;
  approval_request_id: string | null;
  action: string;
  tool_action_status: string;
  approval_status: string | null;
}

export type CalendarToolActionRequestResult =
  | {
      status: "approval_required" | "queued" | "already_processed";
      action: string;
      message: string;
    }
  | { status: "error"; message: string };

function toWorkspaceInstant(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  try {
    const instant = zonedDateTimeToUtc(parts, timeZone);
    const normalized = getZonedDateParts(instant, timeZone);
    return normalized.year === parts.year &&
      normalized.month === parts.month &&
      normalized.day === parts.day &&
      normalized.hour === parts.hour &&
      normalized.minute === parts.minute
      ? instant
      : null;
  } catch {
    return null;
  }
}

function requestFingerprint(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeSummary(
  operation: "create" | "update" | "cancel",
  title: string | null,
  startsAt: Date | null,
  attendeeCount: number,
): string {
  const verb =
    operation === "create"
      ? "Create"
      : operation === "update"
        ? "Update"
        : "Cancel";
  const timing = startsAt ? " at " + startsAt.toISOString() : "";
  const attendees = attendeeCount > 0 ? " with " + attendeeCount + " attendee(s)" : "";
  return (verb + " " + (title ? '“' + title + '”' : "this meeting") + timing + attendees)
    .slice(0, 500);
}

function userFacingRpcError(error: { code?: string }): string {
  if (error.code === "42501") {
    return "Calendar management is not enabled for this workspace or your role cannot make this change.";
  }
  if (error.code === "22023") {
    return "Check the selected calendar, event details, and requested time.";
  }
  if (error.code === "P0001") {
    return "This idempotency key was already used for a different request.";
  }
  return "We could not queue this calendar action. Please try again.";
}

/**
 * Queues a tenant-scoped calendar mutation. This is a request boundary only:
 * it never receives Google credentials and never calls a provider directly.
 */
export async function requestCalendarToolAction(
  input: unknown,
): Promise<CalendarToolActionRequestResult> {
  const parsed = calendarToolActionRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Calendar action is invalid.",
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message: "Calendar changes are unavailable in the development preview.",
    };
  }

  const workspace = await getActiveTenantWorkspace();
  const requiredAction =
    parsed.data.operation === "create"
      ? "calendar.create"
      : parsed.data.operation === "update"
        ? "calendar.update"
        : "calendar.cancel";
  if (!workspace || !canPerformAction(workspace.role, requiredAction)) {
    return {
      status: "error",
      message: "Your workspace role cannot make this calendar change.",
    };
  }

  if (!(await hasWorkspaceFeature(workspace.organizationId, "calendar_management"))) {
    return {
      status: "error",
      message: "Calendar management is not enabled for this workspace plan.",
    };
  }

  let payload: Record<string, unknown>;
  let title: string | null = null;
  let startsAt: Date | null = null;
  let attendeeCount = 0;
  if (parsed.data.operation === "cancel") {
    payload = {
      externalCalendarId: parsed.data.externalCalendarId,
      externalEventId: parsed.data.externalEventId,
    };
  } else {
    const start = toWorkspaceInstant(parsed.data.startsAt, workspace.timezone);
    const end = toWorkspaceInstant(parsed.data.endsAt, workspace.timezone);
    if (!start || !end || end <= start) {
      return {
        status: "error",
        message: "Choose a valid start and end time in the workspace timezone.",
      };
    }
    title = parsed.data.title;
    startsAt = start;
    attendeeCount = parsed.data.attendeeEmails?.length ?? 0;
    payload = {
      externalCalendarId: parsed.data.externalCalendarId,
      ...(parsed.data.operation === "update"
        ? { externalEventId: parsed.data.externalEventId }
        : {}),
      title: parsed.data.title,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      ...(parsed.data.location ? { location: parsed.data.location } : {}),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      ...(attendeeCount > 0
        ? { attendeeEmails: parsed.data.attendeeEmails }
        : {}),
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const { data, error } = await supabase.rpc("request_calendar_tool_action", {
    p_organization_id: workspace.organizationId,
    p_operation: parsed.data.operation,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_request_payload: payload,
    p_request_fingerprint: requestFingerprint(payload),
    p_summary: makeSummary(parsed.data.operation, title, startsAt, attendeeCount),
    p_expires_at: null,
  });
  if (error) {
    return { status: "error", message: userFacingRpcError(error) };
  }

  const row = (data as unknown as CalendarToolActionRpcRow[] | null)?.[0];
  if (!row) {
    return {
      status: "error",
      message: "The calendar action could not be confirmed.",
    };
  }

  revalidatePath("/calendar");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (row.tool_action_status === "awaiting_approval") {
    return {
      status: "approval_required",
      action: row.action,
      message: "Approval is required before this external calendar change can run.",
    };
  }
  if (row.tool_action_status === "approved") {
    return {
      status: "queued",
      action: row.action,
      message: "Calendar action queued for the controlled executor.",
    };
  }

  return {
    status: "already_processed",
    action: row.action,
    message: "This idempotent calendar request was already processed.",
  };
}
