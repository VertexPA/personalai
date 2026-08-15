import { describe, expect, it } from "vitest";

import {
  detectCalendarConflicts,
  detectTravelConflict,
  getRecommendedDeparture,
} from "@/lib/calendar/conflicts";

const firstMeeting = {
  id: "first",
  title: "Lunch",
  startsAt: new Date("2026-08-11T11:30:00+08:00"),
  endsAt: new Date("2026-08-11T13:15:00+08:00"),
};

const secondMeeting = {
  id: "second",
  title: "Supplier",
  startsAt: new Date("2026-08-11T14:00:00+08:00"),
  endsAt: new Date("2026-08-11T15:00:00+08:00"),
};

describe("calendar conflict detection", () => {
  it("detects insufficient meeting buffer", () => {
    const conflicts = detectCalendarConflicts(
      [firstMeeting, secondMeeting],
      60,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "overlap",
      shortfallMinutes: 15,
    });
  });

  it("detects travel conflict when route duration exceeds available time", () => {
    const conflict = detectTravelConflict(
      firstMeeting,
      secondMeeting,
      38 * 60,
      15,
    );

    expect(conflict).toMatchObject({
      kind: "travel",
      shortfallMinutes: 8,
    });
  });

  it("calculates a recommended departure time", () => {
    expect(
      getRecommendedDeparture(secondMeeting, 38 * 60, 15).toISOString(),
    ).toBe("2026-08-11T05:07:00.000Z");
  });
});
