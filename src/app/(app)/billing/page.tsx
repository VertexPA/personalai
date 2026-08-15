import { Check, CreditCard, LockKeyhole } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardData } from "@/data/dashboard";

const plans = [
  {
    name: "Personal",
    price: "RM399",
    detail: "Calendar, WhatsApp, Telegram, Morning Brief",
  },
  {
    name: "Executive",
    price: "RM699",
    detail: "Gmail, traffic, conflict detection, advanced memory",
  },
  {
    name: "Business",
    price: "RM1,299",
    detail: "Slack, teams, approvals, audit logs, analytics",
  },
];

export default async function BillingPage() {
  const dashboard = await getDashboardData();
  const currentPlan = dashboard.organization.plan.toLowerCase();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Billing provider intentionally decoupled"
        title="Plan & billing"
        description="This UI reads plan configuration and tenant entitlements. Payment processing is not connected until a billing provider is configured."
      />

      {!dashboard.hasWorkspace ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            Complete onboarding to assign a plan to a tenant workspace.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/20 bg-primary/[0.03] shadow-none">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <CreditCard className="size-5" />
            </span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{dashboard.organization.plan}</p>
                <Badge variant="secondary">{dashboard.organization.status}</Badge>
                {dashboard.isDemoMode ? (
                  <Badge variant="outline">Development preview</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Plan availability and individual feature overrides are checked on
                the server before any controlled tool runs.
              </p>
            </div>
            <Button disabled variant="outline">
              Manage billing
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrentPlan = currentPlan === plan.name.toLowerCase();
          return (
            <Card
              className={isCurrentPlan ? "border-primary shadow-sm" : "shadow-none"}
              key={plan.name}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {isCurrentPlan && dashboard.hasWorkspace ? (
                    <Badge>Current plan</Badge>
                  ) : null}
                </div>
                <p className="pt-2 text-3xl font-semibold">{plan.price}</p>
                <p className="text-sm text-muted-foreground">per month</p>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">{plan.detail}</p>
                <p className="mt-4 inline-flex items-center gap-2 text-sm">
                  <Check className="size-4 text-emerald-600" />
                  Feature-entitlement controlled
                </p>
              </CardContent>
              <CardFooter>
                <Button className="w-full" disabled variant="outline">
                  Select plan
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LockKeyhole className="size-3.5" />
        Plan changes and overrides are checked server-side before tool execution.
      </p>
    </div>
  );
}
