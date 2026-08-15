"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupportedTimeZone } from "@/lib/timezone";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const timeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 07:30.");

const workspaceSettingsSchema = z
  .object({
    assistantName: z.string().trim().min(1).max(60),
    assistantTone: z.string().trim().min(2).max(240),
    timezone: z
      .string()
      .trim()
      .refine(isSupportedTimeZone, "Choose a supported IANA timezone."),
    workingHours: z.object({
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length, "Working days cannot repeat."),
      startsAt: timeOfDaySchema,
      endsAt: timeOfDaySchema,
    }),
    morningBriefEnabled: z.boolean(),
    morningBriefTime: timeOfDaySchema,
    meetingBufferMinutes: z.number().int().min(0).max(240),
    travelBufferMinutes: z.number().int().min(0).max(240),
    externalActionsRequireApproval: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.workingHours.startsAt >= value.workingHours.endsAt) {
      context.addIssue({
        code: "custom",
        message: "Working hours must end after they start.",
        path: ["workingHours", "endsAt"],
      });
    }
  });

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;

export type WorkspaceSettingsActionResult =
  | { status: "saved" | "demo"; message: string }
  | { status: "error"; message: string };

function messageForDatabaseError(error: { code?: string }): string {
  if (error.code === "42501") {
    return "Only a workspace owner or admin can update these settings.";
  }

  if (error.code === "22023") {
    return "One or more settings are invalid. Review the values and try again.";
  }

  if (error.code === "P0002") {
    return "This workspace is no longer available.";
  }

  return "We could not save these workspace settings. Please try again.";
}

/**
 * The organization ID comes from the verified active membership, not from the
 * form. The RPC repeats the tenant-admin check and updates preferences,
 * timezone-aware automations, approval defaults, and audit history atomically.
 */
export async function saveWorkspaceSettings(
  input: unknown,
): Promise<WorkspaceSettingsActionResult> {
  const parsed = workspaceSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Workspace settings are invalid.",
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "demo",
      message:
        "Development preview: settings are not persisted until Supabase is configured.",
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace || !canPerformAction(workspace.role, "organization.manage")) {
    return {
      status: "error",
      message: "Only a workspace owner or admin can update these settings.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const values = parsed.data;
  const { error } = await supabase.rpc("save_workspace_preferences", {
    p_organization_id: workspace.organizationId,
    p_assistant_name: values.assistantName,
    p_tone: values.assistantTone,
    p_timezone: values.timezone,
    p_working_hours: values.workingHours,
    p_morning_brief_enabled: values.morningBriefEnabled,
    p_morning_brief_time: values.morningBriefTime,
    p_meeting_buffer_minutes: values.meetingBufferMinutes,
    p_travel_buffer_minutes: values.travelBufferMinutes,
    p_external_actions_require_approval: values.externalActionsRequireApproval,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/automations");
  revalidatePath("/approvals");

  return {
    status: "saved",
    message:
      "Workspace settings were saved and the audit trail was updated. Future automation runs use the selected timezone.",
  };
}
