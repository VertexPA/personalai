import "server-only";

import { z } from "zod";

import { ControlledToolActionError } from "@/lib/tool-actions/errors";

export const calendarToolActionNames = [
  "calendar.create",
  "calendar.create_external",
  "calendar.move_external",
  "calendar.cancel",
] as const;

export type CalendarToolActionName = (typeof calendarToolActionNames)[number];

export function isCalendarToolActionName(
  value: string,
): value is CalendarToolActionName {
  return (calendarToolActionNames as readonly string[]).includes(value);
}

const shortTextSchema = z.string().trim().min(1).max(1_024);
const optionalLongTextSchema = z
  .string()
  .trim()
  .max(8_000)
  .optional()
  .transform((value) => value || undefined);
const dateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Date and time must be valid.",
  });
const attendeeEmailsSchema = z
  .array(z.string().trim().email().max(320))
  .max(100)
  .optional()
  .transform((emails) =>
    emails && emails.length > 0 ? [...new Set(emails.map((email) => email.toLowerCase()))] : undefined,
  );

const eventMutationPayloadSchema = z
  .object({
    externalCalendarId: shortTextSchema,
    title: z.string().trim().min(1).max(500),
    description: optionalLongTextSchema,
    location: optionalLongTextSchema,
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema,
    attendeeEmails: attendeeEmailsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(value.endsAt) <= new Date(value.startsAt)) {
      context.addIssue({
        code: "custom",
        message: "The event must end after it starts.",
        path: ["endsAt"],
      });
    }
  });

const updatePayloadSchema = eventMutationPayloadSchema
  .extend({ externalEventId: shortTextSchema })
  .strict();

const cancellationPayloadSchema = z
  .object({
    externalCalendarId: shortTextSchema,
    externalEventId: shortTextSchema,
  })
  .strict();

interface CalendarEventMutationInput {
  externalCalendarId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails?: string[];
}

export interface CalendarCreateToolActionInput extends CalendarEventMutationInput {
  kind: "create";
}

export interface CalendarUpdateToolActionInput
  extends CalendarEventMutationInput {
  kind: "update";
  externalEventId: string;
}

export interface CalendarCancelToolActionInput {
  kind: "cancel";
  externalCalendarId: string;
  externalEventId: string;
}

export type CalendarToolActionInput =
  | CalendarCreateToolActionInput
  | CalendarUpdateToolActionInput
  | CalendarCancelToolActionInput;

function invalidPayload(): never {
  throw new ControlledToolActionError("invalid_calendar_request");
}

/**
 * The worker parses payloads again even though the enqueue RPC validates them.
 * This protects the provider boundary if a row was created by an older version
 * of the app or manually repaired during an incident.
 */
export function parseCalendarToolActionInput(
  action: CalendarToolActionName,
  payload: unknown,
): CalendarToolActionInput {
  if (action === "calendar.cancel") {
    const parsed = cancellationPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return invalidPayload();
    }
    return { kind: "cancel", ...parsed.data };
  }

  if (action === "calendar.move_external") {
    const parsed = updatePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return invalidPayload();
    }
    return {
      kind: "update",
      ...parsed.data,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
    };
  }

  const parsed = eventMutationPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidPayload();
  }
  if (
    (action === "calendar.create" && parsed.data.attendeeEmails?.length) ||
    (action === "calendar.create_external" && !parsed.data.attendeeEmails?.length)
  ) {
    return invalidPayload();
  }

  return {
    kind: "create",
    ...parsed.data,
    startsAt: new Date(parsed.data.startsAt),
    endsAt: new Date(parsed.data.endsAt),
  };
}
