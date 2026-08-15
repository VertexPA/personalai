import "server-only";

import type { CalendarEvent } from "@/lib/calendar/conflicts";
import { detectCalendarConflicts } from "@/lib/calendar/conflicts";
import { getDashboardSnapshot } from "@/lib/demo/dashboard";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { getNextDailyRun } from "@/lib/automation/scheduler";
import { getZonedDayRange } from "@/lib/timezone";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface DashboardIntegration {
  provider: string;
  name: string;
  status: string;
  detail: string;
}

export interface DashboardAutomation {
  name: string;
  schedule: string;
  timezone: string;
  status: string;
  nextRun: string;
}

export interface DashboardTravelWarning {
  message: string;
  recommendation: string;
  isDemo: boolean;
}

export interface DashboardData {
  mode: "demo" | "live" | "no_workspace";
  isDemoMode: boolean;
  hasWorkspace: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    timezone: string;
    userName: string;
    role: string;
  };
  schedule: CalendarEvent[];
  integrations: DashboardIntegration[];
  automations: DashboardAutomation[];
  usage: Array<{ label: string; used: number; limit: number; unit: string }>;
  travelWarning: DashboardTravelWarning | null;
}

interface CalendarEventRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  is_cancelled: boolean;
}

interface IntegrationRow {
  provider: string;
  display_name: string | null;
  status: string;
  last_successful_sync_at: string | null;
  last_error_code: string | null;
}

interface AutomationRow {
  name: string;
  schedule: string;
  timezone: string;
  status: string;
  next_run_at: string | null;
}

interface BillingRow {
  status: string;
  plans: { name: string } | null;
}

function emptyDashboard(userName = "there"): DashboardData {
  return {
    mode: "no_workspace",
    isDemoMode: false,
    hasWorkspace: false,
    organization: {
      id: "",
      name: "Your workspace",
      slug: "",
      plan: "Not configured",
      status: "trial",
      timezone: "UTC",
      userName,
      role: "assistant_user",
    },
    schedule: [],
    integrations: [],
    automations: [],
    usage: [],
    travelWarning: null,
  };
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    google_calendar: "Google Calendar",
    gmail: "Gmail",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    slack: "Slack",
    google_routes: "Google Routes",
  };
  return labels[provider] ?? provider;
}

function providerFromDemoName(name: string): string {
  const providers: Record<string, string> = {
    "Google Calendar": "google_calendar",
    Gmail: "gmail",
    WhatsApp: "whatsapp",
    Telegram: "telegram",
    Slack: "slack",
    "Google Routes": "google_routes",
  };
  return providers[name] ?? name.toLowerCase().replaceAll(" ", "_");
}

function describeIntegration(integration: IntegrationRow): string {
  if (integration.last_error_code) {
    return "Needs attention: " + integration.last_error_code.replaceAll("_", " ");
  }

  if (integration.last_successful_sync_at) {
    return "Last synced " + new Date(integration.last_successful_sync_at).toLocaleString();
  }

  if (integration.status === "not_connected") {
    return "Not connected yet";
  }

  return integration.status.replaceAll("_", " ");
}

function formatNextRun(
  value: string | null,
  timeZone: string,
  schedule: string,
): string {
  let nextRun: Date | null = value ? new Date(value) : null;
  if (!nextRun) {
    const time = /(\d{2}:\d{2})/.exec(schedule)?.[1];
    if (time) {
      try {
        nextRun = getNextDailyRun(new Date(), timeZone, {
          time,
          weekdays: schedule.startsWith("Weekdays") ? [1, 2, 3, 4, 5] : undefined,
        });
      } catch {
        nextRun = null;
      }
    }
  }

  if (!nextRun) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-MY", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(nextRun);
}

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    location: row.location ?? undefined,
    isCancelled: row.is_cancelled,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  if (!isSupabaseConfigured()) {
    const snapshot = await getDashboardSnapshot();
    return {
      mode: "demo",
      isDemoMode: true,
      hasWorkspace: true,
      organization: snapshot.organization,
      schedule: snapshot.schedule,
      integrations: snapshot.integrations.map((integration) => ({
        provider: providerFromDemoName(integration.name),
        name: integration.name,
        status: integration.status,
        detail: integration.detail,
      })),
      automations: snapshot.automations.map((automation) => ({
        name: automation.name,
        schedule: automation.schedule,
        timezone: automation.timezone,
        status: automation.status,
        nextRun: automation.nextRun,
      })),
      usage: snapshot.usage,
      travelWarning: {
        message:
          "Lunch may end at 1:15 PM. Current estimated travel to the supplier meeting is 38 minutes, leaving a 7-minute shortfall.",
        recommendation: "Leave by 1:20 PM · Consider moving the meeting to 2:30 PM",
        isDemo: true,
      },
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return emptyDashboard();
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return emptyDashboard(workspace.userName);
  }

  const dayRange = getZonedDayRange(new Date(), workspace.timezone);
  const [eventsResult, integrationsResult, automationsResult, billingResult] =
    await Promise.all([
      supabase
        .from("calendar_events")
        .select(
          "id, title, starts_at, ends_at, location, is_cancelled, calendars!inner(is_selected, can_read)",
        )
        .eq("organization_id", workspace.organizationId)
        .eq("is_cancelled", false)
        .eq("calendars.is_selected", true)
        .eq("calendars.can_read", true)
        .gte("starts_at", dayRange.startsAt.toISOString())
        .lt("starts_at", dayRange.endsAt.toISOString())
        .order("starts_at", { ascending: true }),
      supabase
        .from("integrations")
        .select(
          "provider, display_name, status, last_successful_sync_at, last_error_code",
        )
        .eq("organization_id", workspace.organizationId)
        .order("provider"),
      supabase
        .from("automations")
        .select("name, schedule, timezone, status, next_run_at")
        .eq("organization_id", workspace.organizationId)
        .order("name"),
      supabase
        .from("billing_accounts")
        .select("status, plans(name)")
        .eq("organization_id", workspace.organizationId)
        .maybeSingle(),
    ]);

  const events =
    (eventsResult.data as unknown as CalendarEventRow[] | null)?.map(
      toCalendarEvent,
    ) ?? [];
  const integrations =
    (integrationsResult.data as unknown as IntegrationRow[] | null)?.map(
      (integration) => ({
        provider: integration.provider,
        name: providerLabel(integration.provider),
        status: integration.status,
        detail: describeIntegration(integration),
      }),
    ) ?? [];
  const automations =
    (automationsResult.data as unknown as AutomationRow[] | null)?.map(
      (automation) => ({
        name: automation.name,
        schedule: automation.schedule,
        timezone: automation.timezone,
        status: automation.status,
        nextRun: formatNextRun(
          automation.next_run_at,
          automation.timezone,
          automation.schedule,
        ),
      }),
    ) ?? [];
  const billing = (billingResult.data as unknown as BillingRow | null) ?? null;
  const firstConflict = detectCalendarConflicts(events, 0)[0] ?? null;

  return {
    mode: "live",
    isDemoMode: false,
    hasWorkspace: true,
    organization: {
      id: workspace.organizationId,
      name: workspace.organizationName,
      slug: workspace.workspaceSlug,
      plan: billing?.plans?.name ?? "Trial",
      status: billing?.status ?? "trial",
      timezone: workspace.timezone,
      userName: workspace.userName,
      role: workspace.role,
    },
    schedule: events,
    integrations,
    automations,
    usage: [],
    travelWarning: firstConflict
      ? {
          message: firstConflict.message,
          recommendation:
            "Review the calendar before changing any meeting with attendees.",
          isDemo: false,
        }
      : null,
  };
}
