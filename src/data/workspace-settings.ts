import "server-only";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface WorkspaceSettingsView {
  mode: "demo" | "live";
  hasWorkspace: boolean;
  canManage: boolean;
  timezone: string;
  assistantName: string;
  assistantTone: string;
  workingHours: {
    days: number[];
    startsAt: string;
    endsAt: string;
  };
  morningBriefEnabled: boolean;
  morningBriefTime: string;
  meetingBufferMinutes: number;
  travelBufferMinutes: number;
  externalActionsRequireApproval: boolean;
}

const defaults: Omit<WorkspaceSettingsView, "mode" | "hasWorkspace" | "canManage"> = {
  timezone: "Asia/Kuala_Lumpur",
  assistantName: "Ava",
  assistantTone: "Calm, proactive, and executive.",
  workingHours: { days: [1, 2, 3, 4, 5], startsAt: "09:00", endsAt: "18:00" },
  morningBriefEnabled: true,
  morningBriefTime: "07:30",
  meetingBufferMinutes: 30,
  travelBufferMinutes: 15,
  externalActionsRequireApproval: true,
};

interface PreferenceRow {
  assistant_name: string;
  tone: string;
  timezone: string;
  working_hours: unknown;
  morning_brief_enabled: boolean;
  morning_brief_time: string;
  default_meeting_buffer_minutes: number;
  default_travel_buffer_minutes: number;
}

interface OnboardingProgressRow {
  state: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTime(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.slice(0, 5) : "";
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : fallback;
}

function asWorkingHours(value: unknown): WorkspaceSettingsView["workingHours"] {
  const record = asRecord(value);
  const values = Array.isArray(record.days)
    ? record.days.filter(
        (day): day is number =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6,
      )
    : [];
  const days = [...new Set(values)];

  return {
    days: days.length > 0 ? days : defaults.workingHours.days,
    startsAt: asTime(record.startsAt, defaults.workingHours.startsAt),
    endsAt: asTime(record.endsAt, defaults.workingHours.endsAt),
  };
}

export async function getWorkspaceSettings(): Promise<WorkspaceSettingsView> {
  if (!isSupabaseConfigured()) {
    return { mode: "demo", hasWorkspace: true, canManage: true, ...defaults };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return { mode: "live", hasWorkspace: false, canManage: false, ...defaults };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      mode: "live",
      hasWorkspace: true,
      canManage: false,
      ...defaults,
      timezone: workspace.timezone,
    };
  }

  const [preferencesResult, progressResult] = await Promise.all([
    supabase
      .from("assistant_preferences")
      .select(
        "assistant_name, tone, timezone, working_hours, morning_brief_enabled, morning_brief_time, default_meeting_buffer_minutes, default_travel_buffer_minutes",
      )
      .eq("organization_id", workspace.organizationId)
      .maybeSingle(),
    supabase
      .from("onboarding_progress")
      .select("state")
      .eq("organization_id", workspace.organizationId)
      .maybeSingle(),
  ]);

  const preferences =
    (preferencesResult.data as unknown as PreferenceRow | null) ?? null;
  const progress =
    (progressResult.data as unknown as OnboardingProgressRow | null) ?? null;
  const progressState = asRecord(progress?.state);

  return {
    mode: "live",
    hasWorkspace: true,
    canManage: canPerformAction(workspace.role, "organization.manage"),
    timezone: preferences?.timezone ?? workspace.timezone,
    assistantName: preferences?.assistant_name ?? defaults.assistantName,
    assistantTone: preferences?.tone ?? defaults.assistantTone,
    workingHours: asWorkingHours(preferences?.working_hours),
    morningBriefEnabled:
      preferences?.morning_brief_enabled ?? defaults.morningBriefEnabled,
    morningBriefTime: asTime(
      preferences?.morning_brief_time,
      defaults.morningBriefTime,
    ),
    meetingBufferMinutes:
      preferences?.default_meeting_buffer_minutes ?? defaults.meetingBufferMinutes,
    travelBufferMinutes:
      preferences?.default_travel_buffer_minutes ?? defaults.travelBufferMinutes,
    externalActionsRequireApproval:
      typeof progressState.externalActionsRequireApproval === "boolean"
        ? progressState.externalActionsRequireApproval
        : defaults.externalActionsRequireApproval,
  };
}
