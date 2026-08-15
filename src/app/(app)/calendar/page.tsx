import { MapPin, Route } from "lucide-react";

import { CalendarMeetingComposer } from "@/components/calendar/calendar-meeting-composer";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDashboardData } from "@/data/dashboard";
import { hasWorkspaceFeature } from "@/data/entitlements";
import { getGoogleCalendarConnection } from "@/data/google-calendar";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from "@/lib/timezone";

export default async function CalendarPage() {
  const [dashboard, googleCalendar, workspace] = await Promise.all([
    getDashboardData(),
    getGoogleCalendarConnection(),
    getActiveTenantWorkspace(),
  ]);
  const hasCalendarManagement = workspace
    ? await hasWorkspaceFeature(workspace.organizationId, "calendar_management")
    : false;
  const events = dashboard.schedule;
  const timeZone = dashboard.organization.timezone;
  const writableCalendars =
    googleCalendar.connection?.calendars
      .filter((calendar) => calendar.isSelected && calendar.canWrite)
      .map((calendar) => ({
        externalId: calendar.externalId,
        name: calendar.name,
        timezone: calendar.timezone,
      })) ?? [];
  const canCreateMeeting = Boolean(
    workspace &&
      hasCalendarManagement &&
      canPerformAction(workspace.role, "calendar.create"),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          dashboard.isDemoMode
            ? "3 connected calendars · development data"
            : "Tenant-scoped selected calendars"
        }
        title="Unified calendar"
        description="A normalized tenant schedule across permitted calendars. Calendar writes are routed through the approval-aware tool gateway."
        actions={
          <CalendarMeetingComposer
            calendars={writableCalendars}
            canCreate={canCreateMeeting}
            isDemoMode={dashboard.isDemoMode}
            timeZone={timeZone}
          />
        }
      />

      {!dashboard.hasWorkspace ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            Complete workspace onboarding before connecting and viewing a calendar.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/80 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {dashboard.isDemoMode ? "Sample schedule · " : ""}
              {formatDateInTimeZone(events[0]?.startsAt ?? new Date(), timeZone)}
            </CardTitle>
            <Badge variant="secondary">{timeZone}</Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Calendar</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="py-10 text-center text-sm text-muted-foreground"
                      colSpan={5}
                    >
                      No events from selected calendars today.
                    </TableCell>
                  </TableRow>
                ) : null}
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs">
                      {formatTimeInTimeZone(event.startsAt, timeZone)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{event.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatTimeInTimeZone(event.startsAt, timeZone)} –{" "}
                        {formatTimeInTimeZone(event.endsAt, timeZone)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {event.location ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" />
                          {event.location}
                        </span>
                      ) : (
                        "No location"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      Selected calendar
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">On track</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/15 bg-primary/[0.03] shadow-none">
        <CardContent className="flex gap-3 p-4">
          <Route className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">Calendar intelligence</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Event conflicts, buffers, working hours, locations, and permitted
              calendars are considered before Ava recommends a change. External
              changes remain approval-aware.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
