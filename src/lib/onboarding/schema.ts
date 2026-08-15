import { z } from "zod";

import { isSupportedTimeZone } from "@/lib/timezone";

export const onboardingStepKeys = [
  "choose_plan",
  "organization",
  "timezone",
  "working_hours",
  "connect_google",
  "select_calendars",
  "connect_channels",
  "configure_assistant",
  "morning_brief",
  "meeting_rules",
  "approval_rules",
  "important_locations",
  "activate",
] as const;

export const onboardingSteps = [
  { key: "choose_plan", label: "Choose plan" },
  { key: "organization", label: "Organization" },
  { key: "timezone", label: "Timezone" },
  { key: "working_hours", label: "Working hours" },
  { key: "connect_google", label: "Connect Google" },
  { key: "select_calendars", label: "Select calendars" },
  { key: "connect_channels", label: "Connect channels" },
  { key: "configure_assistant", label: "Configure assistant" },
  { key: "morning_brief", label: "Morning brief" },
  { key: "meeting_rules", label: "Meeting rules" },
  { key: "approval_rules", label: "Approval rules" },
  { key: "important_locations", label: "Important locations" },
  { key: "activate", label: "Activate" },
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number]["key"];

export const planCodes = ["personal", "executive", "business"] as const;

const timeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 07:30.");

export const workingHoursSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startsAt: timeOfDaySchema,
  endsAt: timeOfDaySchema,
});

export const onboardingSaveSchema = z
  .object({
    organizationId: z.string().uuid().nullable().optional(),
    organizationName: z.string().trim().min(2).max(160),
    workspaceSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Use lowercase letters, numbers, and single hyphens only.",
      )
      .min(3)
      .max(63),
    timezone: z
      .string()
      .trim()
      .refine(isSupportedTimeZone, "Choose a supported IANA timezone."),
    planCode: z.enum(planCodes),
    currentStep: z.enum(onboardingStepKeys),
    completedSteps: z.array(z.enum(onboardingStepKeys)),
    state: z.record(z.string(), z.unknown()),
    workingHours: workingHoursSchema,
    assistantName: z.string().trim().min(1).max(60),
    assistantTone: z.string().trim().min(2).max(240),
    morningBriefEnabled: z.boolean(),
    morningBriefTime: timeOfDaySchema,
    meetingBufferMinutes: z.number().int().min(0).max(240),
    travelBufferMinutes: z.number().int().min(0).max(240),
    externalActionsRequireApproval: z.boolean(),
    defaultLocationLabel: z.string().trim().max(120),
    defaultLocationAddress: z.string().trim().max(400),
    activate: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.workingHours.startsAt >= value.workingHours.endsAt) {
      context.addIssue({
        code: "custom",
        message: "Working hours must end after they start.",
        path: ["workingHours", "endsAt"],
      });
    }

    if (
      value.defaultLocationLabel.length > 0 &&
      value.defaultLocationAddress.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Add an address for the default location.",
        path: ["defaultLocationAddress"],
      });
    }
  });

export type OnboardingSaveInput = z.infer<typeof onboardingSaveSchema>;
