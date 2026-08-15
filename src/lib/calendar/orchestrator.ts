import {
  detectCalendarConflicts,
  detectTravelConflict,
  type CalendarEvent,
  type ScheduleConflict,
} from "@/lib/calendar/conflicts";
import type { TravelProvider } from "@/lib/travel/provider";

export interface CalendarSource {
  id: string;
  name: string;
  isSelected: boolean;
  canRead: boolean;
}

export interface UnifiedCalendarEvent extends CalendarEvent {
  calendarId: string;
  calendarName: string;
}

export interface CalendarOrchestratorInput {
  calendars: CalendarSource[];
  events: UnifiedCalendarEvent[];
  meetingBufferMinutes: number;
  travelBufferMinutes: number;
  trafficAware: boolean;
}

export interface UnifiedSchedule {
  events: UnifiedCalendarEvent[];
  conflicts: ScheduleConflict[];
}

function routeCacheKey(
  previous: CalendarEvent,
  next: CalendarEvent,
  trafficAware: boolean,
): string {
  return [
    previous.location ?? "",
    next.location ?? "",
    previous.endsAt.toISOString().slice(0, 13),
    trafficAware ? "traffic" : "standard",
  ].join("|");
}

/**
 * Produces a read-only tenant schedule from already-authorized calendars. It
 * never writes to a provider and only requests travel data for consecutive,
 * distinct locations where the result can affect a recommendation.
 */
export class CalendarOrchestrator {
  private readonly travelCache = new Map<
    string,
    Awaited<ReturnType<TravelProvider["getTravelTime"]>>
  >();

  public constructor(private readonly travelProvider: TravelProvider) {}

  async buildSchedule(
    input: CalendarOrchestratorInput,
  ): Promise<UnifiedSchedule> {
    const readableSelectedCalendarIds = new Set(
      input.calendars
        .filter((calendar) => calendar.isSelected && calendar.canRead)
        .map((calendar) => calendar.id),
    );
    const events = input.events
      .filter(
        (event) =>
          readableSelectedCalendarIds.has(event.calendarId) &&
          !event.isCancelled,
      )
      .sort((first, second) => first.startsAt.getTime() - second.startsAt.getTime());
    const conflicts = detectCalendarConflicts(events, input.meetingBufferMinutes);

    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1];
      const next = events[index];
      if (
        !previous.location ||
        !next.location ||
        previous.location.trim().toLowerCase() === next.location.trim().toLowerCase()
      ) {
        continue;
      }

      const key = routeCacheKey(previous, next, input.trafficAware);
      let travel = this.travelCache.get(key);
      if (!travel || travel.expiresAt <= new Date()) {
        travel = await this.travelProvider.getTravelTime({
          origin: previous.location,
          destination: next.location,
          departureTime: previous.endsAt,
          trafficAware: input.trafficAware,
        });
        this.travelCache.set(key, travel);
      }

      const durationSeconds =
        input.trafficAware && travel.trafficDurationSeconds !== null
          ? travel.trafficDurationSeconds
          : travel.durationSeconds;
      const travelConflict = detectTravelConflict(
        previous,
        next,
        durationSeconds,
        input.travelBufferMinutes,
      );
      if (travelConflict) {
        conflicts.push(travelConflict);
      }
    }

    return { events, conflicts };
  }
}
