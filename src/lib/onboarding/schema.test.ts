import { describe, expect, it } from "vitest";

import { onboardingSaveSchema } from "@/lib/onboarding/schema";

const validInput = {
  organizationId: null,
  organizationName: "Northstar Executive Office",
  workspaceSlug: "northstar-executive-office",
  timezone: "Asia/Kuala_Lumpur",
  planCode: "executive",
  currentStep: "organization",
  completedSteps: ["choose_plan"],
  state: {},
  workingHours: { days: [1, 2, 3, 4, 5], startsAt: "09:00", endsAt: "18:00" },
  assistantName: "Ava",
  assistantTone: "Calm and proactive",
  morningBriefEnabled: true,
  morningBriefTime: "07:30",
  meetingBufferMinutes: 30,
  travelBufferMinutes: 15,
  externalActionsRequireApproval: true,
  defaultLocationLabel: "",
  defaultLocationAddress: "",
  activate: false,
};

describe("onboarding schema", () => {
  it("normalizes a workspace slug and accepts tenant-safe defaults", () => {
    const result = onboardingSaveSchema.parse({
      ...validInput,
      workspaceSlug: "Northstar-Executive-Office",
    });

    expect(result.workspaceSlug).toBe("northstar-executive-office");
  });

  it("rejects working hours that end before they begin", () => {
    const result = onboardingSaveSchema.safeParse({
      ...validInput,
      workingHours: { days: [1], startsAt: "18:00", endsAt: "09:00" },
    });

    expect(result.success).toBe(false);
  });
});
