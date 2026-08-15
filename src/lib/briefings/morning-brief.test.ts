import { describe, expect, it } from "vitest";

import { buildMorningBrief } from "@/lib/briefings/morning-brief";

describe("morning briefing", () => {
  it("formats tenant-local schedule details and conflict recommendations", () => {
    const brief = buildMorningBrief({
      assistantName: "Ava",
      recipientName: "John Tan",
      timeZone: "Asia/Kuala_Lumpur",
      date: new Date("2026-08-11T00:00:00.000Z"),
      events: [
        {
          id: "meeting",
          title: "Supplier meeting",
          startsAt: new Date("2026-08-11T06:00:00.000Z"),
          endsAt: new Date("2026-08-11T07:00:00.000Z"),
          location: "KL Eco City",
        },
      ],
      conflicts: [
        {
          kind: "travel",
          previous: {
            id: "lunch",
            title: "Lunch",
            startsAt: new Date("2026-08-11T03:30:00.000Z"),
            endsAt: new Date("2026-08-11T05:15:00.000Z"),
          },
          next: {
            id: "meeting",
            title: "Supplier meeting",
            startsAt: new Date("2026-08-11T06:00:00.000Z"),
            endsAt: new Date("2026-08-11T07:00:00.000Z"),
          },
          severity: "warning",
          shortfallMinutes: 8,
          message: "Lunch does not leave enough time to travel to Supplier meeting.",
        },
      ],
    });

    expect(brief.summary).toContain("Good morning, John.");
    expect(brief.scheduleLines).toEqual(["2:00 pm — Supplier meeting · KL Eco City"]);
    expect(brief.recommendations).toHaveLength(1);
  });
});
