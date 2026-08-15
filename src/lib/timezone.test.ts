import { describe, expect, it } from "vitest";

import {
  getZonedDateParts,
  getZonedDayRange,
  isSupportedTimeZone,
  zonedDateTimeToUtc,
} from "@/lib/timezone";

describe("timezone helpers", () => {
  it("recognizes IANA timezones without relying on the server timezone", () => {
    expect(isSupportedTimeZone("Asia/Kuala_Lumpur")).toBe(true);
    expect(isSupportedTimeZone("Not/A_Timezone")).toBe(false);
  });

  it("returns the correct local day boundaries for Kuala Lumpur", () => {
    const range = getZonedDayRange(
      new Date("2026-08-11T17:00:00.000Z"),
      "Asia/Kuala_Lumpur",
    );

    expect(range.startsAt.toISOString()).toBe("2026-08-11T16:00:00.000Z");
    expect(range.endsAt.toISOString()).toBe("2026-08-12T16:00:00.000Z");
  });

  it("re-evaluates the offset across a daylight-saving transition", () => {
    const beforeTransition = zonedDateTimeToUtc(
      {
        year: 2026,
        month: 3,
        day: 7,
        hour: 9,
        minute: 0,
        second: 0,
      },
      "America/New_York",
    );
    const afterTransition = zonedDateTimeToUtc(
      {
        year: 2026,
        month: 3,
        day: 9,
        hour: 9,
        minute: 0,
        second: 0,
      },
      "America/New_York",
    );

    expect(beforeTransition.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(afterTransition.toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(getZonedDateParts(afterTransition, "America/New_York")).toMatchObject({
      hour: 9,
      minute: 0,
    });
  });
});
