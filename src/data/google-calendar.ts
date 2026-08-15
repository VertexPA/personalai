import "server-only";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface GoogleCalendarSelectionOption {
  externalId: string;
  name: string;
  timezone: string | null;
  isSelected: boolean;
  isPrimary: boolean;
  canRead: boolean;
  canWrite: boolean;
}

export interface GoogleCalendarConnectionView {
  connectionId: string;
  integrationStatus: string;
  syncStatus: string;
  lastSyncedAt: string | null;
  calendars: GoogleCalendarSelectionOption[];
}

interface IntegrationRow {
  id: string;
  status: string;
}

interface ConnectionRow {
  id: string;
  sync_status: string;
  last_synced_at: string | null;
}

interface CalendarRow {
  external_calendar_id: string;
  name: string;
  timezone: string | null;
  is_selected: boolean;
  is_primary: boolean;
  can_read: boolean;
  can_write: boolean;
}

export async function getGoogleCalendarConnection(): Promise<{
  hasWorkspace: boolean;
  connection: GoogleCalendarConnectionView | null;
}> {
  if (!isSupabaseConfigured()) {
    return { hasWorkspace: true, connection: null };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return { hasWorkspace: false, connection: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { hasWorkspace: true, connection: null };
  }

  const { data: integrationData, error: integrationError } = await supabase
    .from("integrations")
    .select("id, status")
    .eq("organization_id", workspace.organizationId)
    .eq("provider", "google_calendar")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const integration = integrationData as unknown as IntegrationRow | null;
  if (integrationError || !integration) {
    return { hasWorkspace: true, connection: null };
  }

  const { data: connectionData, error: connectionError } = await supabase
    .from("calendar_connections")
    .select("id, sync_status, last_synced_at")
    .eq("organization_id", workspace.organizationId)
    .eq("integration_id", integration.id)
    .maybeSingle();
  const connection = connectionData as unknown as ConnectionRow | null;
  if (connectionError || !connection) {
    return { hasWorkspace: true, connection: null };
  }

  const { data: calendarData, error: calendarError } = await supabase
    .from("calendars")
    .select(
      "external_calendar_id, name, timezone, is_selected, is_primary, can_read, can_write",
    )
    .eq("organization_id", workspace.organizationId)
    .eq("calendar_connection_id", connection.id)
    .order("name");
  if (calendarError) {
    return {
      hasWorkspace: true,
      connection: {
        connectionId: connection.id,
        integrationStatus: integration.status,
        syncStatus: connection.sync_status,
        lastSyncedAt: connection.last_synced_at,
        calendars: [],
      },
    };
  }

  return {
    hasWorkspace: true,
    connection: {
      connectionId: connection.id,
      integrationStatus: integration.status,
      syncStatus: connection.sync_status,
      lastSyncedAt: connection.last_synced_at,
      calendars: (calendarData as unknown as CalendarRow[] | null)?.map(
        (calendar) => ({
          externalId: calendar.external_calendar_id,
          name: calendar.name,
          timezone: calendar.timezone,
          isSelected: calendar.is_selected,
          isPrimary: calendar.is_primary,
          canRead: calendar.can_read,
          canWrite: calendar.can_write,
        }),
      ) ?? [],
    },
  };
}
