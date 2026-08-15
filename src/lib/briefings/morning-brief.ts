import type {
  CalendarEvent,
  ScheduleConflict,
} from "@/lib/calendar/conflicts";
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from "@/lib/timezone";

export interface MorningBriefInput {
  assistantName: string;
  recipientName: string;
  timeZone: string;
  date: Date;
  events: CalendarEvent[];
  conflicts: ScheduleConflict[];
}

export interface MorningBrief {
  title: string;
  summary: string;
  scheduleLines: string[];
  recommendations: string[];
}

function greetingForHour(hour: number): string {
  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

/**
 * Formats a tenant-local briefing from normalized, read-only schedule data.
 * Sending it through WhatsApp, Telegram, Slack, or web remains the
 * responsibility of the approval-aware notification layer.
 */
export function buildMorningBrief(input: MorningBriefInput): MorningBrief {
  const localHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(input.date),
  );
  const greeting =
    greetingForHour(localHour) +
    ", " +
    input.recipientName.split(" ")[0] +
    ".";
  const activeEvents = input.events
    .filter((event) => !event.isCancelled)
    .sort((first, second) => first.startsAt.getTime() - second.startsAt.getTime());
  const scheduleLines = activeEvents.map((event) => {
    const location = event.location ? " · " + event.location : "";
    return (
      formatTimeInTimeZone(event.startsAt, input.timeZone) +
      " — " +
      event.title +
      location
    );
  });
  const recommendations = input.conflicts.map((conflict) => conflict.message);
  const eventSummary =
    activeEvents.length === 0
      ? "Your selected calendars are clear."
      : "You have " +
        activeEvents.length +
        " " +
        (activeEvents.length === 1 ? "meeting" : "meetings") +
        " on your selected calendars.";

  return {
    title:
      input.assistantName +
      " · " +
      formatDateInTimeZone(input.date, input.timeZone),
    summary: greeting + " " + eventSummary,
    scheduleLines,
    recommendations,
  };
}
