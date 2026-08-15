export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zonedDateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedDateFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  zonedDateFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getZonedDateParts(
  instant: Date,
  timeZone: string,
): ZonedDateParts {
  if (!isSupportedTimeZone(timeZone)) {
    throw new Error("Unsupported IANA timezone: " + timeZone);
  }

  const parts = getFormatter(timeZone).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getOffsetMilliseconds(instant: Date, timeZone: string): number {
  const parts = getZonedDateParts(instant, timeZone);
  const formattedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return formattedAsUtc - instant.getTime();
}

/**
 * Converts a wall-clock value in an IANA timezone into an instant. Re-checking
 * the offset handles daylight-saving transitions without assuming the server
 * timezone. Ambiguous fall-back times choose the offset observed at the instant.
 */
export function zonedDateTimeToUtc(
  parts: ZonedDateParts,
  timeZone: string,
): Date {
  if (!isSupportedTimeZone(timeZone)) {
    throw new Error("Unsupported IANA timezone: " + timeZone);
  }

  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const firstPass = new Date(utcGuess - getOffsetMilliseconds(new Date(utcGuess), timeZone));
  const correctedOffset = getOffsetMilliseconds(firstPass, timeZone);

  return new Date(utcGuess - correctedOffset);
}

export function getZonedDayRange(
  instant: Date,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const day = getZonedDateParts(instant, timeZone);
  const nextDayAsUtc = new Date(
    Date.UTC(day.year, day.month - 1, day.day + 1, 0, 0, 0),
  );

  return {
    startsAt: zonedDateTimeToUtc(
      { ...day, hour: 0, minute: 0, second: 0 },
      timeZone,
    ),
    endsAt: zonedDateTimeToUtc(
      {
        year: nextDayAsUtc.getUTCFullYear(),
        month: nextDayAsUtc.getUTCMonth() + 1,
        day: nextDayAsUtc.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timeZone,
    ),
  };
}

export function formatTimeInTimeZone(
  instant: Date,
  timeZone: string,
  locale = "en-MY",
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

export function formatDateInTimeZone(
  instant: Date,
  timeZone: string,
  locale = "en-MY",
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}
