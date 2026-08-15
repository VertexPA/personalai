import {
  getNextDailyRun,
  type DailyAutomationSchedule,
} from "@/lib/automation/scheduler";
import { getZonedDateParts, zonedDateTimeToUtc } from "@/lib/timezone";

export interface AutomationTiming {
  id: string;
  timeZone: string;
  schedule: string;
  configuration: unknown;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export type AutomationDueState = "due" | "not_due" | "missed";

export interface AutomationDuePlan {
  state: AutomationDueState;
  idempotencyKey: string;
  nextRunAt: Date;
}

function readScheduleTime(configuration: unknown, schedule: string): string {
  if (typeof configuration === "object" && configuration !== null) {
    const time = (configuration as Record<string, unknown>).time;
    if (typeof time === "string") {
      return time;
    }
  }

  const match = /(?:^|\s)([01]\d|2[0-3]):[0-5]\d(?:\s|$)/.exec(schedule);
  if (!match) {
    throw new Error("Automation schedule must include an HH:mm time.");
  }

  return match[0].trim();
}

function getSchedule(schedule: string, configuration: unknown): DailyAutomationSchedule {
  return {
    time: readScheduleTime(configuration, schedule),
    weekdays: schedule.startsWith("Weekdays") ? [1, 2, 3, 4, 5] : undefined,
  };
}

function localDateKey(instant: Date, timeZone: string): string {
  const parts = getZonedDateParts(instant, timeZone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function scheduledInstantForToday(
  now: Date,
  timeZone: string,
  schedule: DailyAutomationSchedule,
): Date | null {
  const localNow = getZonedDateParts(now, timeZone);
  const [hour, minute] = schedule.time.split(":").map(Number);
  const weekdays = new Set(schedule.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
  const weekday = new Date(
    Date.UTC(localNow.year, localNow.month - 1, localNow.day),
  ).getUTCDay();
  if (!weekdays.has(weekday) || hour === undefined || minute === undefined) {
    return null;
  }

  return zonedDateTimeToUtc(
    {
      year: localNow.year,
      month: localNow.month,
      day: localNow.day,
      hour,
      minute,
      second: 0,
    },
    timeZone,
  );
}

/**
 * Evaluates an automation against its tenant-local calendar. A missed morning
 * briefing is advanced instead of being delivered a day late, while each valid
 * local date has a deterministic idempotency key for safe duplicate handling.
 */
export function getAutomationDuePlan(
  automation: AutomationTiming,
  now = new Date(),
): AutomationDuePlan {
  const schedule = getSchedule(automation.schedule, automation.configuration);
  const todayKey = localDateKey(now, automation.timeZone);
  const nextRunAt =
    automation.nextRunAt && !Number.isNaN(new Date(automation.nextRunAt).getTime())
      ? new Date(automation.nextRunAt)
      : null;
  const nextScheduledRun = getNextDailyRun(now, automation.timeZone, schedule);

  if (nextRunAt) {
    if (nextRunAt > now) {
      return {
        state: "not_due",
        idempotencyKey: localDateKey(nextRunAt, automation.timeZone),
        nextRunAt,
      };
    }

    const scheduledDateKey = localDateKey(nextRunAt, automation.timeZone);
    return {
      state: scheduledDateKey === todayKey ? "due" : "missed",
      idempotencyKey: scheduledDateKey,
      nextRunAt: nextScheduledRun,
    };
  }

  const scheduledToday = scheduledInstantForToday(
    now,
    automation.timeZone,
    schedule,
  );
  const lastRunToday =
    automation.lastRunAt &&
    !Number.isNaN(new Date(automation.lastRunAt).getTime()) &&
    localDateKey(new Date(automation.lastRunAt), automation.timeZone) === todayKey;

  return {
    state:
      scheduledToday && scheduledToday <= now && !lastRunToday
        ? "due"
        : "not_due",
    idempotencyKey: todayKey,
    nextRunAt: nextScheduledRun,
  };
}
