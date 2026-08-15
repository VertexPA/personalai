import {
  Building2,
  CalendarCheck2,
  Clock3,
  Route,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/dashboard/metric-card";
import { ScheduleCard } from "@/components/dashboard/schedule-card";
import { TravelWarning } from "@/components/dashboard/travel-warning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/data/dashboard";

export default async function DashboardPage() {
  const dashboard = await getDashboardData();

  if (!dashboard.hasWorkspace) {
    return (
      <section className="mx-auto max-w-2xl py-10">
        <Card className="border-border/80 shadow-none">
          <CardContent className="p-7">
            <Badge variant="outline">Workspace required</Badge>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              Set up your first executive workspace.
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              A workspace isolates its calendars, integrations, preferences,
              automations, approvals, usage, and billing from every other customer.
            </p>
            <Button asChild className="mt-6">
              <Link href="/onboarding">
                <Building2 data-icon="inline-start" />
                Start onboarding
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const meetingCount = dashboard.schedule.length;
  const scheduledMinutes = dashboard.schedule.reduce(
    (total, event) =>
      total + (event.endsAt.getTime() - event.startsAt.getTime()) / 60_000,
    0,
  );
  const scheduledHours = Math.round((scheduledMinutes / 60) * 10) / 10;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{dashboard.organization.plan} plan</Badge>
            {dashboard.isDemoMode ? (
              <Badge variant="outline">Clearly labelled mock data</Badge>
            ) : null}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Good morning, {dashboard.organization.userName.split(" ")[0]}.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {dashboard.isDemoMode
              ? "The development workspace includes a sample schedule and travel warning. No external account is connected."
              : meetingCount > 0
              ? "You have " +
                meetingCount +
                " " +
                (meetingCount === 1 ? "meeting" : "meetings") +
                " in your selected calendars today."
              : "Your selected calendars are clear for today."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/calendar">Open calendar</Link>
          </Button>
          <Button asChild>
            <Link href="/assistant">
              <Sparkles data-icon="inline-start" />
              Ask Ava
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail={
            meetingCount > 0
              ? "From selected calendars"
              : "Connect Google Calendar to sync events"
          }
          icon={CalendarCheck2}
          label={dashboard.isDemoMode ? "Sample meetings" : "Meetings today"}
          value={String(meetingCount)}
        />
        <MetricCard
          detail={
            scheduledHours > 0
              ? "Across selected calendars"
              : "No scheduled events today"
          }
          icon={Clock3}
          label="Scheduled time"
          value={scheduledHours > 0 ? scheduledHours + " hrs" : "—"}
        />
        <MetricCard
          detail={
            dashboard.travelWarning
              ? "Review before executing changes"
              : "No calendar conflict detected"
          }
          icon={Route}
          label="Travel risk"
          value={dashboard.travelWarning ? "1" : "0"}
        />
        <MetricCard
          detail={
            dashboard.isDemoMode
              ? "No sensitive action executed"
              : "Controlled tool access"
          }
          icon={Sparkles}
          label="Assistant recommendations"
          value={dashboard.travelWarning ? "1" : "0"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
        <ScheduleCard
          events={dashboard.schedule}
          isDemo={dashboard.isDemoMode}
          timeZone={dashboard.organization.timezone}
        />
        <div className="space-y-6">
          {dashboard.travelWarning ? (
            <TravelWarning
              isDemo={dashboard.travelWarning.isDemo}
              message={dashboard.travelWarning.message}
              recommendation={dashboard.travelWarning.recommendation}
            />
          ) : null}
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recommended next step</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                {dashboard.travelWarning
                  ? "Review the detected schedule conflict and request approval before changing an external meeting."
                  : "Connect a calendar and ask Ava to review scheduling, travel, and meeting-buffer recommendations."}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button asChild size="sm">
                  <Link href="/approvals">Review request</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/assistant">Ask for alternatives</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/80 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Integration health</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/integrations">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.integrations.length === 0 ? (
              <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">
                No integrations are connected to this workspace yet.
              </div>
            ) : null}
            {dashboard.integrations.slice(0, 4).map((integration) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2.5"
                key={integration.name}
              >
                <div>
                  <p className="text-sm font-medium">{integration.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {integration.detail}
                  </p>
                </div>
                <Badge
                  variant={
                    integration.status === "connected" ? "secondary" : "outline"
                  }
                >
                  {integration.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Automations</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/automations">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.automations.length === 0 ? (
              <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">
                No tenant automations are configured yet.
              </div>
            ) : null}
            {dashboard.automations.map((automation) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2.5"
                key={automation.name}
              >
                <div>
                  <p className="text-sm font-medium">{automation.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {automation.schedule}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">
                  {automation.nextRun}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
