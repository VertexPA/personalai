import { Clock3, MapPin } from "lucide-react";

import type { CalendarEvent } from "@/lib/calendar/conflicts";
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from "@/lib/timezone";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ScheduleCard({
  events,
  timeZone,
  referenceDate,
  isDemo = false,
}: {
  events: CalendarEvent[];
  timeZone: string;
  referenceDate?: Date;
  isDemo?: boolean;
}) {
  const scheduleDate = referenceDate ?? events[0]?.startsAt ?? new Date();

  return (
    <Card className="border-border/80 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">
            {isDemo ? "Sample schedule" : "Today&apos;s schedule"}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateInTimeZone(scheduleDate, timeZone)} · {timeZone}
          </p>
        </div>
        <Badge variant="secondary">{events.length} meetings</Badge>
      </CardHeader>
      <CardContent className="space-y-1">
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            No selected-calendar events are scheduled for today.
          </div>
        ) : null}
        {events.map((event) => (
          <div
            className="flex gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60"
            key={event.id}
          >
            <div className="w-20 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
              {formatTimeInTimeZone(event.startsAt, timeZone)}
            </div>
            <div className="min-w-0 flex-1 border-l border-primary/30 pl-3">
              <p className="truncate text-sm font-medium">{event.title}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="size-3" />
                  {formatTimeInTimeZone(event.startsAt, timeZone)} –{" "}
                  {formatTimeInTimeZone(event.endsAt, timeZone)}
                </span>
                {event.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {event.location}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
