"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasWorkspaceFeature } from "@/data/entitlements";
import { getActiveTenantWorkspace } from "@/data/tenant";
import {
  GoogleCalendarCredentialsError,
  syncGoogleCalendarCatalog,
  syncSelectedGoogleCalendarEvents,
} from "@/lib/integrations/google-calendar-service";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const calendarSelectionSchema = z
  .object({
    calendarConnectionId: z.string().uuid(),
    selectedCalendarIds: z
      .array(z.string().trim().min(1).max(1_024))
      .max(25)
      .refine(
        (calendarIds) => new Set(calendarIds).size === calendarIds.length,
        "A calendar can only be selected once.",
      ),
    primaryCalendarExternalId: z.string().trim().min(1).max(1_024).nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.selectedCalendarIds.length > 0 &&
      !value.primaryCalendarExternalId
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose a primary calendar.",
        path: ["primaryCalendarExternalId"],
      });
    }

    if (
      value.primaryCalendarExternalId &&
      !value.selectedCalendarIds.includes(value.primaryCalendarExternalId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The primary calendar must also be selected.",
        path: ["primaryCalendarExternalId"],
      });
    }
  });

export type GoogleCalendarActionResult =
  | { status: "saved" | "synced"; message: string }
  | { status: "error"; message: string };

async function getAuthorizedCalendarWorkspace() {
  if (!isSupabaseConfigured()) {
    return { workspace: null, message: "Google Calendar is unavailable in the development preview." };
  }

  const workspace = await getActiveTenantWorkspace();
  if (
    !workspace ||
    !canPerformAction(workspace.role, "integration.manage")
  ) {
    return {
      workspace: null,
      message: "Only a workspace owner or admin can manage calendars.",
    };
  }

  const hasCalendar = await hasWorkspaceFeature(
    workspace.organizationId,
    "calendar",
  );
  if (!hasCalendar) {
    return {
      workspace: null,
      message: "Google Calendar is not enabled for this workspace plan.",
    };
  }

  return { workspace, message: null };
}

function messageForGoogleCalendarError(error: unknown): string {
  if (error instanceof GoogleCalendarCredentialsError) {
    return error.message;
  }

  return "Google Calendar could not be synchronized. Check the connection and try again.";
}

export async function syncGoogleCalendarCatalogAction(): Promise<GoogleCalendarActionResult> {
  const authorization = await getAuthorizedCalendarWorkspace();
  if (!authorization.workspace) {
    return { status: "error", message: authorization.message ?? "Not authorized." };
  }

  try {
    const result = await syncGoogleCalendarCatalog(
      authorization.workspace.organizationId,
    );
    revalidatePath("/integrations");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return {
      status: "synced",
      message:
        result.calendarCount === 1
          ? "Synchronized 1 calendar. Select it before events are shown."
          : "Synchronized " +
            result.calendarCount +
            " calendars. Select the calendars Ava may use.",
    };
  } catch (error) {
    return { status: "error", message: messageForGoogleCalendarError(error) };
  }
}

export async function saveGoogleCalendarSelection(
  input: unknown,
): Promise<GoogleCalendarActionResult> {
  const parsed = calendarSelectionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Calendar selection is invalid.",
    };
  }

  const authorization = await getAuthorizedCalendarWorkspace();
  if (!authorization.workspace) {
    return { status: "error", message: authorization.message ?? "Not authorized." };
  }

  const hasMultipleCalendars = await hasWorkspaceFeature(
    authorization.workspace.organizationId,
    "multi_calendar",
  );
  if (!hasMultipleCalendars) {
    return {
      status: "error",
      message: "Calendar selection is not enabled for this workspace plan.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const { error } = await supabase.rpc("save_google_calendar_selection", {
    p_calendar_connection_id: parsed.data.calendarConnectionId,
    p_selected_calendar_ids: parsed.data.selectedCalendarIds,
    p_primary_calendar_external_id: parsed.data.primaryCalendarExternalId,
  });
  if (error) {
    if (error.code === "42501") {
      return {
        status: "error",
        message: "You cannot manage this calendar selection.",
      };
    }

    if (error.code === "22023") {
      return {
        status: "error",
        message:
          "The selected calendars are unavailable or exceed the workspace plan limit.",
      };
    }

    return {
      status: "error",
      message: "Could not save the selected calendars.",
    };
  }

  revalidatePath("/integrations");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return {
    status: "saved",
    message:
      "Calendar selection saved. Synchronize selected events to refresh Ava’s schedule.",
  };
}

export async function syncSelectedGoogleCalendarEventsAction(): Promise<GoogleCalendarActionResult> {
  const authorization = await getAuthorizedCalendarWorkspace();
  if (!authorization.workspace) {
    return { status: "error", message: authorization.message ?? "Not authorized." };
  }

  try {
    const now = new Date();
    const result = await syncSelectedGoogleCalendarEvents(
      authorization.workspace.organizationId,
      {
        startsAt: new Date(now.getTime() - 24 * 60 * 60_000),
        endsAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
      },
    );
    revalidatePath("/integrations");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return {
      status: "synced",
      message:
        result.eventCount === 1
          ? "Synchronized 1 event from the selected calendars."
          : "Synchronized " +
            result.eventCount +
            " events from the selected calendars.",
    };
  } catch (error) {
    return { status: "error", message: messageForGoogleCalendarError(error) };
  }
}
