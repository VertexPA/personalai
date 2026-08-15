import { describe, expect, it } from "vitest";

import {
  GoogleCalendarProvider,
  parseGoogleCalendarEvent,
} from "@/lib/integrations/google-calendar-provider";

describe("GoogleCalendarProvider", () => {
  it("normalizes a Google event without exposing provider-specific fields", () => {
    const event = parseGoogleCalendarEvent({
      id: "event-1",
      summary: "Management meeting",
      location: "Kuala Lumpur",
      start: { dateTime: "2026-08-12T09:00:00+08:00" },
      end: { dateTime: "2026-08-12T10:00:00+08:00" },
    });

    expect(event).toMatchObject({
      id: "event-1",
      title: "Management meeting",
      location: "Kuala Lumpur",
    });
    expect(event?.startsAt.toISOString()).toBe("2026-08-12T01:00:00.000Z");
  });

  it("rejects malformed event timing", () => {
    expect(
      parseGoogleCalendarEvent({
        id: "event-1",
        start: { dateTime: "not a date" },
        end: { dateTime: "2026-08-12T10:00:00+08:00" },
      }),
    ).toBeNull();
  });

  it("paginates calendar discovery with the server-side bearer token", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const provider = new GoogleCalendarProvider(
      "server-only-token",
      async (url, init) => {
        calls.push({
          url,
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        if (calls.length === 1) {
          return Response.json({
            items: [
              {
                id: "primary",
                summary: "Primary",
                accessRole: "owner",
                primary: true,
              },
            ],
            nextPageToken: "page-2",
          });
        }

        return Response.json({
          items: [
            {
              id: "read-only",
              summary: "Read only",
              accessRole: "reader",
            },
          ],
        });
      },
    );

    const calendars = await provider.listCalendars();

    expect(calendars).toEqual([
      {
        externalId: "primary",
        name: "Primary",
        timezone: null,
        canRead: true,
        canWrite: true,
        isPrimary: true,
      },
      {
        externalId: "read-only",
        name: "Read only",
        timezone: null,
        canRead: true,
        canWrite: false,
        isPrimary: false,
      },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
    expect(calls[1]?.url).toContain("pageToken=page-2");
    expect(calls.every((call) => call.authorization === "Bearer server-only-token")).toBe(
      true,
    );
  });

  it("uses a caller-supplied provider-safe event ID for an idempotent create", async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new GoogleCalendarProvider(
      "server-only-token",
      async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: "avageneratedid",
          summary: "Planning session",
          start: { dateTime: "2026-08-12T09:00:00.000Z" },
          end: { dateTime: "2026-08-12T10:00:00.000Z" },
        });
      },
    );

    await provider.createEvent({
      externalCalendarId: "primary",
      providerEventId: "ava0123456789abcdef",
      title: "Planning session",
      startsAt: new Date("2026-08-12T09:00:00.000Z"),
      endsAt: new Date("2026-08-12T10:00:00.000Z"),
    });

    expect(body).toMatchObject({ id: "ava0123456789abcdef" });
  });
});
