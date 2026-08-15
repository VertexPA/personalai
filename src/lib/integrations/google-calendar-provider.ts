import "server-only";

import type { CalendarEvent } from "@/lib/calendar/conflicts";
import type {
  CalendarEventMutation,
  CalendarProvider,
  ConnectedCalendar,
} from "@/lib/integrations/contracts";

const googleCalendarApiBaseUrl = "https://www.googleapis.com/calendar/v3";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class GoogleCalendarProviderError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleCalendarProviderError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseGoogleDateTime(value: unknown): Date | null {
  const record = asRecord(value);
  const dateTime = readString(record.dateTime);
  const date = readString(record.date);
  const parsed = new Date(dateTime ?? (date ? date + "T00:00:00.000Z" : ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toGoogleEventInput(
  input: CalendarEventMutation,
  includeProviderEventId = false,
): Record<string, unknown> {
  return {
    ...(includeProviderEventId && input.providerEventId
      ? { id: input.providerEventId }
      : {}),
    summary: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startsAt.toISOString() },
    end: { dateTime: input.endsAt.toISOString() },
    attendees: input.attendeeEmails?.map((email) => ({ email })),
  };
}

export function parseGoogleCalendarEvent(value: unknown): CalendarEvent | null {
  const record = asRecord(value);
  const id = readString(record.id);
  const startsAt = parseGoogleDateTime(record.start);
  const endsAt = parseGoogleDateTime(record.end);
  if (!id || !startsAt || !endsAt || endsAt <= startsAt) {
    return null;
  }

  return {
    id,
    title: readString(record.summary) ?? "Untitled event",
    startsAt,
    endsAt,
    location: readString(record.location) ?? undefined,
    isCancelled: record.status === "cancelled",
  };
}

function parseConnectedCalendar(value: unknown): ConnectedCalendar | null {
  const record = asRecord(value);
  const externalId = readString(record.id);
  const accessRole = readString(record.accessRole);
  if (!externalId || !accessRole || record.deleted === true) {
    return null;
  }

  return {
    externalId,
    name:
      readString(record.summaryOverride) ??
      readString(record.summary) ??
      "Unnamed calendar",
    timezone: readString(record.timeZone),
    canRead: accessRole !== "none",
    canWrite: accessRole === "owner" || accessRole === "writer",
    isPrimary: record.primary === true,
  };
}

/**
 * Google Calendar provider that runs only on the server. It receives a short
 * lived access token from the tenant credential service; browser clients never
 * receive credentials or arbitrary Google API access.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  public constructor(
    private readonly accessToken: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async requestJson(
    path: string,
    init: { method?: "GET" | "POST" | "PUT"; body?: Record<string, unknown> } = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.fetcher(googleCalendarApiBaseUrl + path, {
      method: init.method ?? "GET",
      headers: {
        Authorization: "Bearer " + this.accessToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = asRecord(await response.json().catch(() => null));
    if (!response.ok) {
      throw new GoogleCalendarProviderError(
        "Google Calendar request failed.",
        response.status,
      );
    }

    return payload;
  }

  private async listPage(
    path: string,
    limit = 20,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < limit; page += 1) {
      const requestPath = pageToken
        ? path +
          (path.includes("?") ? "&" : "?") +
          new URLSearchParams({ pageToken }).toString()
        : path;
      const payload = await this.requestJson(requestPath);
      results.push(...readArray(payload.items).map(asRecord));
      pageToken = readString(payload.nextPageToken);
      if (!pageToken) {
        return results;
      }
    }

    throw new GoogleCalendarProviderError(
      "Google Calendar returned too many result pages.",
      502,
    );
  }

  async listCalendars(): Promise<ConnectedCalendar[]> {
    const items = await this.listPage(
      "/users/me/calendarList?showDeleted=false&maxResults=250",
    );
    return items
      .map(parseConnectedCalendar)
      .filter((calendar): calendar is ConnectedCalendar => calendar !== null);
  }

  async listEventsForCalendars(
    externalCalendarIds: string[],
    range: { startsAt: Date; endsAt: Date },
  ): Promise<CalendarEvent[]> {
    const calendarIds = [...new Set(externalCalendarIds)].filter(Boolean);
    const results = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const parameters = new URLSearchParams({
          singleEvents: "true",
          orderBy: "startTime",
          timeMin: range.startsAt.toISOString(),
          timeMax: range.endsAt.toISOString(),
          maxResults: "250",
        });
        const items = await this.listPage(
          "/calendars/" +
            encodeURIComponent(calendarId) +
            "/events?" +
            parameters.toString(),
        );
        return items
          .map(parseGoogleCalendarEvent)
          .filter((event): event is CalendarEvent => event !== null);
      }),
    );

    return results.flat().sort(
      (first, second) => first.startsAt.getTime() - second.startsAt.getTime(),
    );
  }

  async listEvents(range: {
    startsAt: Date;
    endsAt: Date;
  }): Promise<CalendarEvent[]> {
    const calendars = await this.listCalendars();
    const primaryCalendar = calendars.find((calendar) => calendar.isPrimary);
    if (!primaryCalendar?.canRead) {
      return [];
    }

    return this.listEventsForCalendars([primaryCalendar.externalId], range);
  }

  async createEvent(input: CalendarEventMutation): Promise<CalendarEvent> {
    const payload = await this.requestJson(
      "/calendars/" + encodeURIComponent(input.externalCalendarId) + "/events",
      {
        method: "POST",
        body: toGoogleEventInput(input, true),
      },
    );
    const event = parseGoogleCalendarEvent(payload);
    if (!event) {
      throw new GoogleCalendarProviderError(
        "Google Calendar returned an invalid created event.",
        502,
      );
    }

    return event;
  }

  async updateEvent(
    input: Required<Pick<CalendarEventMutation, "externalEventId">> &
      CalendarEventMutation,
  ): Promise<CalendarEvent> {
    const payload = await this.requestJson(
      "/calendars/" +
        encodeURIComponent(input.externalCalendarId) +
        "/events/" +
        encodeURIComponent(input.externalEventId),
      {
        method: "PUT",
        body: toGoogleEventInput(input),
      },
    );
    const event = parseGoogleCalendarEvent(payload);
    if (!event) {
      throw new GoogleCalendarProviderError(
        "Google Calendar returned an invalid updated event.",
        502,
      );
    }

    return event;
  }

  async cancelEvent(input: {
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<void> {
    const response = await this.fetcher(
      googleCalendarApiBaseUrl +
        "/calendars/" +
        encodeURIComponent(input.externalCalendarId) +
        "/events/" +
        encodeURIComponent(input.externalEventId),
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + this.accessToken,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    // If a previous execution deleted this event but crashed before recording
    // completion, the desired state (event absent) has already been reached.
    if (!response.ok && response.status !== 204 && response.status !== 404) {
      throw new GoogleCalendarProviderError(
        "Google Calendar cancellation failed.",
        response.status,
      );
    }
  }
}
