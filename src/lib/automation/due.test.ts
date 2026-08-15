import { describe, expect, it } from "vitest";

import { getAutomationDuePlan } from "@/lib/automation/due";

const weekdayAutomation = {
  id: "morning-brief",
  timeZone: "Asia/Kuala_Lumpur",
  schedule: "Weekdays at 07:30",
  configuration: { time: "07:30" },
  lastRunAt: null,
  nextRunAt: null,
};

describe("getAutomationDuePlan", () => {
  it("runs a tenant-local weekday briefing after its scheduled time", () => {
    const plan = getAutomationDuePlan(
      weekdayAutomation,
      new Date("2026-08-12T00:00:00.000Z"),
    );

    expect(plan.state).toBe("due");
    expect(plan.idempotencyKey).toBe("2026-08-12");
    expect(plan.nextRunAt.toISOString()).toBe("2026-08-12T23:30:00.000Z");
  });

  it("does not rerun a briefing that already ran on the tenant-local date", () => {
    const plan = getAutomationDuePlan(
      {
        ...weekdayAutomation,
        lastRunAt: "2026-08-11T23:45:00.000Z",
      },
      new Date("2026-08-12T00:00:00.000Z"),
    );

    expect(plan.state).toBe("not_due");
  });

  it("skips a missed previous-day briefing rather than delivering stale content", () => {
    const plan = getAutomationDuePlan(
      {
        ...weekdayAutomation,
        nextRunAt: "2026-08-10T23:30:00.000Z",
      },
      new Date("2026-08-12T00:00:00.000Z"),
    );

    expect(plan.state).toBe("missed");
    expect(plan.idempotencyKey).toBe("2026-08-11");
    expect(plan.nextRunAt.toISOString()).toBe("2026-08-12T23:30:00.000Z");
  });
});
