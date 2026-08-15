"use server";

import { revalidatePath } from "next/cache";

import {
  onboardingSaveSchema,
  type OnboardingSaveInput,
} from "@/lib/onboarding/schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OnboardingActionResult =
  | {
      status: "saved";
      organizationId: string;
      completed: boolean;
      message: string;
    }
  | {
      status: "demo";
      message: string;
    }
  | {
      status: "unauthenticated" | "validation_error" | "error";
      message: string;
    };

interface OnboardingRpcRow {
  organization_id: string;
  onboarding_completed: boolean;
}

function messageForDatabaseError(error: { code?: string }): string {
  if (error.code === "23505") {
    return "That workspace slug is already in use. Choose another one.";
  }

  if (error.code === "42501") {
    return "You no longer have permission to update this workspace.";
  }

  if (error.code === "22023") {
    return "One or more onboarding details are invalid. Review this step and try again.";
  }

  return "We could not save this onboarding step. Please try again.";
}

export async function saveOnboardingStep(
  input: OnboardingSaveInput,
): Promise<OnboardingActionResult> {
  const parsed = onboardingSaveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the onboarding details.",
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "demo",
      message:
        "Saved in this development preview only. Configure Supabase to persist a real customer workspace.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return {
      status: "unauthenticated",
      message: "Sign in again before saving onboarding.",
    };
  }

  const values = parsed.data;
  const { data, error } = await supabase.rpc("save_onboarding_state", {
    p_organization_id: values.organizationId ?? null,
    p_organization_name: values.organizationName,
    p_workspace_slug: values.workspaceSlug,
    p_timezone: values.timezone,
    p_plan_code: values.planCode,
    p_current_step: values.currentStep,
    p_completed_steps: values.completedSteps,
    p_state: {
      ...values.state,
      channels: values.state.channels ?? ["whatsapp", "telegram"],
      externalActionsRequireApproval: values.externalActionsRequireApproval,
    },
    p_working_hours: values.workingHours,
    p_assistant_name: values.assistantName,
    p_assistant_tone: values.assistantTone,
    p_morning_brief_enabled: values.morningBriefEnabled,
    p_morning_brief_time: values.morningBriefTime,
    p_meeting_buffer_minutes: values.meetingBufferMinutes,
    p_travel_buffer_minutes: values.travelBufferMinutes,
    p_external_actions_require_approval: values.externalActionsRequireApproval,
    p_default_location_label: values.defaultLocationLabel || null,
    p_default_location_address: values.defaultLocationAddress || null,
    p_activate: values.activate,
  });

  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  const row = (data as unknown as OnboardingRpcRow[] | null)?.[0];
  if (!row) {
    return {
      status: "error",
      message: "The workspace could not be confirmed after saving.",
    };
  }

  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/automations");

  return {
    status: "saved",
    organizationId: row.organization_id,
    completed: row.onboarding_completed,
    message: row.onboarding_completed
      ? "Assistant activation is saved. Connect the required accounts before enabling live actions."
      : "This onboarding step is saved securely.",
  };
}
