import { Clock3, Play, Workflow } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/data/dashboard";

export default async function AutomationsPage() {
  const dashboard = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          dashboard.isDemoMode ? "Development scheduler preview" : "Tenant-aware scheduler"
        }
        title="Automations"
        description="Schedules are stored with each customer’s IANA timezone, idempotency key, last run, next run, and failure state."
        actions={
          <Button disabled>
            <Workflow data-icon="inline-start" />
            New automation
          </Button>
        }
      />

      <div className="grid gap-4">
        {dashboard.automations.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
              {dashboard.hasWorkspace
                ? "No tenant automations are configured. Onboarding can create a morning brief schedule."
                : "Complete onboarding to configure tenant-aware automations."}
            </CardContent>
          </Card>
        ) : null}
        {dashboard.automations.map((automation) => (
          <Card className="border-border/80 shadow-none" key={automation.name}>
            <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/8 text-primary">
                <Clock3 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{automation.name}</CardTitle>
                  <Badge variant="secondary">{automation.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {automation.schedule} · {automation.timezone}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  {automation.nextRun}
                </p>
                <Button disabled size="sm" variant="outline">
                  <Play data-icon="inline-start" />
                  Run now
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Reusable job infrastructure</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          Morning brief, weekly schedule summary, travel reminders, and future
          follow-up automations all use the same tenant-aware execution model.
          The durable worker claims each scheduled run with an idempotency key
          before it sends a notification.
        </CardContent>
      </Card>
    </div>
  );
}
