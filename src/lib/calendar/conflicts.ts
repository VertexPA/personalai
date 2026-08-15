export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string;
  isCancelled?: boolean;
}

export interface ScheduleConflict {
  kind: "overlap" | "travel";
  previous: CalendarEvent;
  next: CalendarEvent;
  severity: "warning" | "critical";
  shortfallMinutes: number;
  message: string;
}

export function detectCalendarConflicts(
  events: CalendarEvent[],
  meetingBufferMinutes = 0,
): ScheduleConflict[] {
  const activeEvents = events
    .filter((event) => !event.isCancelled)
    .sort((first, second) => first.startsAt.getTime() - second.startsAt.getTime());
  const conflicts: ScheduleConflict[] = [];

  for (let index = 1; index < activeEvents.length; index += 1) {
    const previous = activeEvents[index - 1];
    const next = activeEvents[index];
    const availableMilliseconds =
      next.startsAt.getTime() - previous.endsAt.getTime();
    const requiredMilliseconds = meetingBufferMinutes * 60 * 1000;

    if (availableMilliseconds < requiredMilliseconds) {
      const shortfallMinutes = Math.ceil(
        (requiredMilliseconds - availableMilliseconds) / 60_000,
      );
      conflicts.push({
        kind: "overlap",
        previous,
        next,
        severity: availableMilliseconds < 0 ? "critical" : "warning",
        shortfallMinutes,
        message:
          availableMilliseconds < 0
            ? previous.title + " overlaps " + next.title + "."
            : previous.title +
              " leaves " +
              shortfallMinutes +
              " minutes less than the required meeting buffer before " +
              next.title +
              ".",
      });
    }
  }

  return conflicts;
}

export function detectTravelConflict(
  previous: CalendarEvent,
  next: CalendarEvent,
  travelDurationSeconds: number,
  travelBufferMinutes = 0,
): ScheduleConflict | null {
  const availableMilliseconds = next.startsAt.getTime() - previous.endsAt.getTime();
  const requiredMilliseconds =
    travelDurationSeconds * 1000 + travelBufferMinutes * 60 * 1000;

  if (availableMilliseconds >= requiredMilliseconds) {
    return null;
  }

  const shortfallMinutes = Math.ceil(
    (requiredMilliseconds - availableMilliseconds) / 60_000,
  );
  return {
    kind: "travel",
    previous,
    next,
    severity: availableMilliseconds < 0 ? "critical" : "warning",
    shortfallMinutes,
    message:
      previous.title + " does not leave enough time to travel to " + next.title + ".",
  };
}

export function getRecommendedDeparture(
  event: CalendarEvent,
  travelDurationSeconds: number,
  travelBufferMinutes = 0,
): Date {
  return new Date(
    event.startsAt.getTime() -
      (travelDurationSeconds + travelBufferMinutes * 60) * 1000,
  );
}
