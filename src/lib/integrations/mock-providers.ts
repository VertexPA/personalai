import type { CalendarEvent } from "@/lib/calendar/conflicts";
import { demoSchedule } from "@/lib/demo/data";
import type {
  CalendarEventMutation,
  CalendarProvider,
  ConnectedCalendar,
  EmailProvider,
  EmailSearchResult,
} from "@/lib/integrations/contracts";

const demoCalendars: ConnectedCalendar[] = [
  {
    externalId: "personal",
    name: "Personal",
    timezone: "Asia/Kuala_Lumpur",
    canRead: true,
    canWrite: true,
    isPrimary: true,
  },
  {
    externalId: "company",
    name: "Company",
    timezone: "Asia/Kuala_Lumpur",
    canRead: true,
    canWrite: true,
    isPrimary: false,
  },
  {
    externalId: "family",
    name: "Family",
    timezone: "Asia/Kuala_Lumpur",
    canRead: true,
    canWrite: false,
    isPrimary: false,
  },
];

export class MockGoogleCalendarProvider implements CalendarProvider {
  async listCalendars(): Promise<ConnectedCalendar[]> {
    return demoCalendars;
  }

  async listEvents(range: {
    startsAt: Date;
    endsAt: Date;
  }): Promise<CalendarEvent[]> {
    void range;
    return demoSchedule;
  }

  async createEvent(input: CalendarEventMutation): Promise<CalendarEvent> {
    return {
      id: "mock-calendar-event",
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: input.location,
    };
  }

  async updateEvent(
    input: Required<Pick<CalendarEventMutation, "externalEventId">> &
      CalendarEventMutation,
  ): Promise<CalendarEvent> {
    return {
      id: input.externalEventId,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: input.location,
    };
  }

  async cancelEvent(input: {
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<void> {
    void input;
    return Promise.resolve();
  }
}

export class MockGmailProvider implements EmailProvider {
  async search(query: string): Promise<EmailSearchResult[]> {
    void query;
    return [
      {
        id: "mock-email-1",
        subject: "Supplier meeting confirmation",
        sender: "supplier@example.com",
        receivedAt: new Date("2026-08-10T17:20:00+08:00"),
        preview: "Looking forward to meeting tomorrow at 2:00 PM.",
      },
    ];
  }

  async draftReply(input: {
    threadId: string;
    body: string;
  }): Promise<{ draftId: string }> {
    void input;
    return { draftId: "mock-gmail-draft" };
  }
}

export class UnconfiguredProvider {
  constructor(private readonly providerName: string) {}

  unavailable(): never {
    throw new Error(
      this.providerName +
        " is not configured. Development mode intentionally uses a labelled mock adapter.",
    );
  }
}
