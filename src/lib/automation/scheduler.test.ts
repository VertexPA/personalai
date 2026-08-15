import { describe, expect, it } from "vitest";

import {
  describeDailySchedule,
  getNextDailyRun,
} from "@/lib/automation/scheduler";

describe("tenant-aware daily scheduler", () => {
  it("skips a passed same-day run in the customer timezone", () => {
    const nextRun = getNextDailyRun(
      new Date("2026-08-11T00:15:00.000Z"),
      "Asia/Kuala_Lumpur",
      { time: "07:30", weekdays: [1, 2, 3, 4, 5] },
    );

    expect(nextRun.toISOString()).toBe("2026-08-11T23:30:00.000Z");
  });

  it("skips weekends for a weekday briefing", () => {
    const nextRun = getNextDailyRun(
      new Date("2026-08-14T12:00:00.000Z"),
      "Asia/Kuala_Lumpur",
      { time: "07:30", weekdays: [1, 2, 3, 4, 5] },
    );

    expect(nextRun.toISOString()).toBe("2026-08-16T23:30:00.000Z");
  });

  it("uses the post-DST offset for a future local run", () => {
    const nextRun = getNextDailyRun(
      new Date("2026-03-08T14:00:00.000Z"),
      "America/New_York",
      { time: "09:00" },
    );

    expect(nextRun.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("describes a weekday schedule clearly", () => {
    expect(
      describeDailySchedule({ time: "07:30", weekdays: [1, 2, 3, 4, 5] }),
    ).toBe("Weekdays at 07:30");
  });
});
