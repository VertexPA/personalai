import type { CalendarEvent } from "@/lib/calendar/conflicts";

export interface ConnectedCalendar {
  externalId: string;
  name: string;
  timezone: string | null;
  canRead: boolean;
  canWrite: boolean;
  isPrimary: boolean;
}

export interface CalendarEventMutation {
  externalCalendarId: string;
  externalEventId?: string;
  /** A provider-safe stable event identifier for a create retry. */
  providerEventId?: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails?: string[];
}

export interface CalendarProvider {
  listCalendars(): Promise<ConnectedCalendar[]>;
  listEvents(range: { startsAt: Date; endsAt: Date }): Promise<CalendarEvent[]>;
  createEvent(input: CalendarEventMutation): Promise<CalendarEvent>;
  updateEvent(input: Required<Pick<CalendarEventMutation, "externalEventId">> & CalendarEventMutation): Promise<CalendarEvent>;
  cancelEvent(input: {
    externalCalendarId: string;
    externalEventId: string;
  }): Promise<void>;
}

export interface EmailSearchResult {
  id: string;
  subject: string;
  sender: string;
  receivedAt: Date;
  preview: string;
}

export interface EmailProvider {
  search(query: string): Promise<EmailSearchResult[]>;
  draftReply(input: {
    threadId: string;
    body: string;
  }): Promise<{ draftId: string }>;
}

export interface ChatChannelProvider {
  sendText(input: {
    recipientId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<{ providerMessageId: string }>;
}
