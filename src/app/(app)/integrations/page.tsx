import {
  CalendarDays,
  ExternalLink,
  Mail,
  Map,
  MessageCircleMore,
  Send,
} from "lucide-react";
import Link from "next/link";

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
import { getGoogleCalendarConnection } from "@/data/google-calendar";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { GoogleCalendarManager } from "@/components/integrations/google-calendar-manager";
import { TelegramLinkForm } from "@/components/integrations/telegram-link-form";
import { canPerformAction } from "@/lib/permissions";

const integrationCatalog = [
  {
    name: "Google Calendar",
    provider: "google_calendar",
    detail: "OAuth connection, selected calendars, encrypted refresh token storage.",
    icon: CalendarDays,
  },
  {
    name: "WhatsApp",
    provider: "whatsapp",
    detail: "Signed Cloud API webhook and outbound notification adapter.",
    icon: MessageCircleMore,
  },
  {
    name: "Telegram",
    provider: "telegram",
    detail: "Secret-token webhook and tenant-linked conversation adapter.",
    icon: Send,
  },
  {
    name: "Gmail",
    provider: "gmail",
    detail: "Entitlement-gated server-side email search and drafting adapter.",
    icon: Mail,
  },
  {
    name: "Slack",
    provider: "slack",
    detail: "Business-plan channel and future workspace integration adapter.",
    icon: MessageCircleMore,
  },
  {
    name: "Google Routes",
    provider: "google_routes",
    detail: "Cached travel duration and traffic-aware routing provider.",
    icon: Map,
  },
] as const;

export default async function IntegrationsPage() {
  const [dashboard, workspace, googleCalendar] = await Promise.all([
    getDashboardData(),
    getActiveTenantWorkspace(),
    getGoogleCalendarConnection(),
  ]);
  const canManageIntegrations = Boolean(
    workspace && canPerformAction(workspace.role, "integration.manage"),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Server-side OAuth and token storage"
        title="Integrations"
        description="Connection status is visible here, but OAuth credentials are encrypted in a private schema and never returned to the browser."
      />

      {!dashboard.hasWorkspace ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            Complete workspace onboarding before connecting tenant integrations.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrationCatalog.map((entry) => {
          const connectedIntegration = dashboard.integrations.find(
            (integration) => integration.provider === entry.provider,
          );
          const status = connectedIntegration?.status ?? "not_connected";
          const isConnected = status === "connected";
          const detail = dashboard.isDemoMode
            ? connectedIntegration?.detail ?? entry.detail
            : connectedIntegration?.detail ?? entry.detail;
          const Icon = entry.icon;
          const canStartGoogleOAuth =
            entry.provider === "google_calendar" &&
            !dashboard.isDemoMode &&
            dashboard.hasWorkspace &&
            canManageIntegrations &&
            !isConnected;
          const canLinkTelegram =
            entry.provider === "telegram" &&
            !dashboard.isDemoMode &&
            dashboard.hasWorkspace &&
            canManageIntegrations;

          return (
            <Card className="border-border/80 shadow-none" key={entry.provider}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/8 text-primary">
                  <Icon className="size-5" />
                </span>
                <Badge variant={isConnected ? "secondary" : "outline"}>
                  {status.replaceAll("_", " ")}
                </Badge>
              </CardHeader>
              <CardContent>
                <CardTitle className="text-base">{entry.name}</CardTitle>
                <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">
                  {detail}
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                {canLinkTelegram ? (
                  <TelegramLinkForm />
                ) : canStartGoogleOAuth ? (
                  <Button asChild size="sm">
                    <Link href="/api/integrations/google/start">
                      <ExternalLink data-icon="inline-start" />
                      Connect Google
                    </Link>
                  </Button>
                ) : (
                  <Button disabled size="sm" variant="outline">
                    <ExternalLink data-icon="inline-start" />
                    {isConnected ? "Connected" : "Connect"}
                  </Button>
                )}
                {dashboard.isDemoMode ? (
                  <Badge variant="outline">Mock status</Badge>
                ) : null}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {!dashboard.isDemoMode && googleCalendar.connection ? (
        <Card className="border-border/80 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Google Calendar access</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Select exactly the tenant calendars that Ava may read. The saved
              catalog is tenant-scoped and credentials remain encrypted outside
              the browser.
            </p>
          </CardHeader>
          <CardContent>
            <GoogleCalendarManager
              calendars={googleCalendar.connection.calendars}
              canManage={canManageIntegrations}
              connectionId={googleCalendar.connection.connectionId}
              key={
                googleCalendar.connection.connectionId +
                ":" +
                (googleCalendar.connection.lastSyncedAt ?? "not-synced")
              }
              lastSyncedAt={googleCalendar.connection.lastSyncedAt}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
