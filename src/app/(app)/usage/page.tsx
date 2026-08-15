import { Coins } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUsageMetrics } from "@/data/usage";

export default async function UsagePage() {
  const usage = await getUsageMetrics();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={usage.isDemoMode ? "Development usage preview" : "Tenant-scoped usage"}
        title="Usage & cost controls"
        description="Normal customer users only see their own organization’s usage. Platform-wide costs remain restricted to platform administrators."
      />

      {!usage.hasWorkspace ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            Complete onboarding to start tracking tenant usage.
          </CardContent>
        </Card>
      ) : null}

      {usage.hasWorkspace && usage.metrics.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            No usage records are available for this workspace yet.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {usage.metrics.map((item) => {
          const percentage =
            item.limit === null ? null : Math.round((item.used / item.limit) * 100);
          return (
            <Card className="border-border/80 shadow-none" key={item.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">{item.label}</CardTitle>
                <Badge variant="outline">
                  {percentage === null ? "Tracked" : percentage + "%"}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">
                    {item.used}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {item.limit === null
                      ? item.unit
                      : "of " + item.limit + " " + item.unit}
                  </span>
                </div>
                {percentage !== null ? (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: Math.min(100, percentage) + "%" }}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border/80 shadow-none">
        <CardContent className="flex gap-3 p-5">
          <Coins className="size-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">Cost observability</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The schema records LLM usage, Maps calls, messages, calendar
              operations, and scheduled runs with estimated cost metadata.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
