import {
  getZonedDateParts,
  isSupportedTimeZone,
  zonedDateTimeToUtc,
} from "@/lib/timezone";

export interface DailyAutomationSchedule {
  time: string;
  weekdays?: number[];
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error("Automation time must use HH:mm.");
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function getCalendarDate(
  year: number,
  month: number,
  day: number,
  offsetDays: number,
): { year: number; month: number; day: number; weekday: number } {
  const value = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    weekday: value.getUTCDay(),
  };
}

/**
 * Returns the next tenant-local daily occurrence after an instant. It uses IANA
 * timezone conversion for every candidate day, so a scheduler never assumes the
 * Vercel region or Hermes host timezone matches the customer.
 */
export function getNextDailyRun(
  after: Date,
  timeZone: string,
  schedule: DailyAutomationSchedule,
): Date {
  if (!isSupportedTimeZone(timeZone)) {
    throw new Error("Unsupported IANA timezone: " + timeZone);
  }

  const { hour, minute } = parseTime(schedule.time);
  const validWeekdays = new Set(schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
  if (validWeekdays.size === 0 || [...validWeekdays].some((day) => day < 0 || day > 6)) {
    throw new Error("Weekdays must contain JavaScript day indexes from 0 to 6.");
  }

  const localAfter = getZonedDateParts(after, timeZone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidateDay = getCalendarDate(
      localAfter.year,
      localAfter.month,
      localAfter.day,
      offset,
    );
    if (!validWeekdays.has(candidateDay.weekday)) {
      continue;
    }

    const candidate = zonedDateTimeToUtc(
      {
        year: candidateDay.year,
        month: candidateDay.month,
        day: candidateDay.day,
        hour,
        minute,
        second: 0,
      },
      timeZone,
    );
    if (candidate > after) {
      return candidate;
    }
  }

  throw new Error("Could not calculate the next automation run.");
}

export function describeDailySchedule(
  schedule: DailyAutomationSchedule,
): string {
  const weekdays = schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  const isWeekdays =
    weekdays.length === 5 &&
    [1, 2, 3, 4, 5].every((day) => weekdays.includes(day));

  return (isWeekdays ? "Weekdays" : "Daily") + " at " + schedule.time;
}
