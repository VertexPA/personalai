import "server-only";

import { cache } from "react";

import {
  onboardingStepKeys,
  type OnboardingSaveInput,
  type OnboardingStep,
} from "@/lib/onboarding/schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface OnboardingSeed {
  mode: "demo" | "live" | "not_authenticated";
  organizationId: string | null;
  organizationName: string;
  workspaceSlug: string;
  timezone: string;
  planCode: OnboardingSaveInput["planCode"];
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  workingHours: OnboardingSaveInput["workingHours"];
  assistantName: string;
  assistantTone: string;
  morningBriefEnabled: boolean;
  morningBriefTime: string;
  meetingBufferMinutes: number;
  travelBufferMinutes: number;
  externalActionsRequireApproval: boolean;
  defaultLocationLabel: string;
  defaultLocationAddress: string;
  state: Record<string, unknown>;
  completed: boolean;
}

const defaultSeed: Omit<OnboardingSeed, "mode"> = {
  organizationId: null,
  organizationName: "Tan Executive Office",
  workspaceSlug: "tan-executive-office",
  timezone: "Asia/Kuala_Lumpur",
  planCode: "executive",
  currentStep: "choose_plan",
  completedSteps: [],
  workingHours: {
    days: [1, 2, 3, 4, 5],
    startsAt: "09:00",
    endsAt: "18:00",
  },
  assistantName: "Ava",
  assistantTone: "Calm, proactive, and executive.",
  morningBriefEnabled: true,
  morningBriefTime: "07:30",
  meetingBufferMinutes: 30,
  travelBufferMinutes: 15,
  externalActionsRequireApproval: true,
  defaultLocationLabel: "",
  defaultLocationAddress: "",
  state: {},
  completed: false,
};

interface MembershipRow {
  organization_id: string;
  organizations: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  } | null;
}

interface OnboardingProgressRow {
  current_step: string;
  completed_steps: unknown;
  state: unknown;
  completed_at: string | null;
}

interface AssistantPreferencesRow {
  assistant_name: string;
  tone: string;
  timezone: string;
  working_hours: unknown;
  morning_brief_enabled: boolean;
  morning_brief_time: string;
  default_meeting_buffer_minutes: number;
  default_travel_buffer_minutes: number;
}

interface BillingAccountRow {
  plans: { code: string } | null;
}

interface ImportantLocationRow {
  label: string;
  address: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asStep(value: unknown): OnboardingStep | null {
  return typeof value === "string" &&
    onboardingStepKeys.includes(value as OnboardingStep)
    ? (value as OnboardingStep)
    : null;
}

function asStepArray(value: unknown): OnboardingStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asStep)
    .filter((step): step is OnboardingStep => step !== null);
}

function asPlanCode(
  value: unknown,
): OnboardingSaveInput["planCode"] | null {
  return value === "personal" || value === "executive" || value === "business"
    ? value
    : null;
}

function asTime(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.slice(0, 5) : "";
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asWorkingHours(
  value: unknown,
): OnboardingSaveInput["workingHours"] {
  const record = asRecord(value);
  const days = Array.isArray(record.days)
    ? record.days.filter(
        (day): day is number =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6,
      )
    : [];

  return {
    days: days.length > 0 ? days : defaultSeed.workingHours.days,
    startsAt: asTime(record.startsAt, defaultSeed.workingHours.startsAt),
    endsAt: asTime(record.endsAt, defaultSeed.workingHours.endsAt),
  };
}

export const getOnboardingSeed = cache(async (): Promise<OnboardingSeed> => {
  if (!isSupabaseConfigured()) {
    return { mode: "demo", ...defaultSeed };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { mode: "demo", ...defaultSeed };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { mode: "not_authenticated", ...defaultSeed };
  }

  const { data: membershipData, error: membershipError } = await supabase
    .from("memberships")
    .select(
      "organization_id, organizations!inner(id, name, slug, timezone)",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .in("role", ["customer_owner", "customer_admin"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !membershipData) {
    return { mode: "live", ...defaultSeed };
  }

  const membership = membershipData as unknown as MembershipRow;
  if (!membership.organizations) {
    return { mode: "live", ...defaultSeed };
  }

  const organization = membership.organizations;
  const [progressResult, preferencesResult, billingResult, locationResult] =
    await Promise.all([
      supabase
        .from("onboarding_progress")
        .select("current_step, completed_steps, state, completed_at")
        .eq("organization_id", organization.id)
        .maybeSingle(),
      supabase
        .from("assistant_preferences")
        .select(
          "assistant_name, tone, timezone, working_hours, morning_brief_enabled, morning_brief_time, default_meeting_buffer_minutes, default_travel_buffer_minutes",
        )
        .eq("organization_id", organization.id)
        .maybeSingle(),
      supabase
        .from("billing_accounts")
        .select("plans(code)")
        .eq("organization_id", organization.id)
        .maybeSingle(),
      supabase
        .from("important_locations")
        .select("label, address")
        .eq("organization_id", organization.id)
        .eq("is_default_origin", true)
        .maybeSingle(),
    ]);

  const progress =
    (progressResult.data as unknown as OnboardingProgressRow | null) ?? null;
  const preferences =
    (preferencesResult.data as unknown as AssistantPreferencesRow | null) ??
    null;
  const billing =
    (billingResult.data as unknown as BillingAccountRow | null) ?? null;
  const location =
    (locationResult.data as unknown as ImportantLocationRow | null) ?? null;
  const state = asRecord(progress?.state);

  return {
    mode: "live",
    organizationId: organization.id,
    organizationName: organization.name,
    workspaceSlug: organization.slug,
    timezone: preferences?.timezone ?? organization.timezone,
    planCode: asPlanCode(billing?.plans?.code) ?? defaultSeed.planCode,
    currentStep: asStep(progress?.current_step) ?? defaultSeed.currentStep,
    completedSteps: asStepArray(progress?.completed_steps),
    workingHours: asWorkingHours(preferences?.working_hours),
    assistantName: preferences?.assistant_name ?? defaultSeed.assistantName,
    assistantTone: preferences?.tone ?? defaultSeed.assistantTone,
    morningBriefEnabled:
      preferences?.morning_brief_enabled ?? defaultSeed.morningBriefEnabled,
    morningBriefTime: asTime(
      preferences?.morning_brief_time,
      defaultSeed.morningBriefTime,
    ),
    meetingBufferMinutes:
      preferences?.default_meeting_buffer_minutes ??
      defaultSeed.meetingBufferMinutes,
    travelBufferMinutes:
      preferences?.default_travel_buffer_minutes ??
      defaultSeed.travelBufferMinutes,
    externalActionsRequireApproval:
      asBoolean(
        state.externalActionsRequireApproval,
        defaultSeed.externalActionsRequireApproval,
      ),
    defaultLocationLabel: location?.label ?? defaultSeed.defaultLocationLabel,
    defaultLocationAddress:
      location?.address ?? defaultSeed.defaultLocationAddress,
    state,
    completed: progress?.completed_at !== null && progress?.completed_at !== undefined,
  };
});
