import { describe, expect, it } from "vitest";

import { CalendarOrchestrator } from "@/lib/calendar/orchestrator";
import type { TravelProvider } from "@/lib/travel/provider";

function createTravelProvider(durationSeconds: number): TravelProvider & {
  calls: number;
} {
  return {
    calls: 0,
    async getTravelTime() {
      this.calls += 1;
      return {
        durationSeconds,
        distanceMeters: 12_000,
        trafficDurationSeconds: durationSeconds,
        source: "mock",
        expiresAt: new Date(Date.now() + 60_000),
      };
    },
  };
}

describe("CalendarOrchestrator", () => {
  it("only includes events from selected readable calendars", async () => {
    const provider = createTravelProvider(30 * 60);
    const orchestrator = new CalendarOrchestrator(provider);

    const schedule = await orchestrator.buildSchedule({
      calendars: [
        { id: "personal", name: "Personal", isSelected: true, canRead: true },
        { id: "private", name: "Private", isSelected: false, canRead: true },
      ],
      events: [
        {
          id: "included",
          calendarId: "personal",
          calendarName: "Personal",
          title: "Included",
          startsAt: new Date("2026-08-11T09:00:00+08:00"),
          endsAt: new Date("2026-08-11T10:00:00+08:00"),
        },
        {
          id: "excluded",
          calendarId: "private",
          calendarName: "Private",
          title: "Excluded",
          startsAt: new Date("2026-08-11T11:00:00+08:00"),
          endsAt: new Date("2026-08-11T12:00:00+08:00"),
        },
      ],
      meetingBufferMinutes: 0,
      travelBufferMinutes: 0,
      trafficAware: false,
    });

    expect(schedule.events.map((event) => event.id)).toEqual(["included"]);
    expect(provider.calls).toBe(0);
  });

  it("uses one cached travel lookup to identify a travel conflict", async () => {
    const provider = createTravelProvider(45 * 60);
    const orchestrator = new CalendarOrchestrator(provider);
    const input = {
      calendars: [
        { id: "work", name: "Work", isSelected: true, canRead: true },
      ],
      events: [
        {
          id: "first",
          calendarId: "work",
          calendarName: "Work",
          title: "Lunch",
          startsAt: new Date("2026-08-11T11:30:00+08:00"),
          endsAt: new Date("2026-08-11T13:15:00+08:00"),
          location: "Bangsar",
        },
        {
          id: "second",
          calendarId: "work",
          calendarName: "Work",
          title: "Supplier meeting",
          startsAt: new Date("2026-08-11T14:00:00+08:00"),
          endsAt: new Date("2026-08-11T15:00:00+08:00"),
          location: "KL Eco City",
        },
      ],
      meetingBufferMinutes: 0,
      travelBufferMinutes: 15,
      trafficAware: true,
    };

    const first = await orchestrator.buildSchedule(input);
    const second = await orchestrator.buildSchedule(input);

    expect(first.conflicts).toMatchObject([
      { kind: "travel", shortfallMinutes: 15 },
    ]);
    expect(second.conflicts).toHaveLength(1);
    expect(provider.calls).toBe(1);
  });
});
