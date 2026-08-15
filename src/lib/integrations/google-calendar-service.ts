import "server-only";

import { createHash } from "node:crypto";

import type { CalendarEvent } from "@/lib/calendar/conflicts";
import {
  GoogleCalendarProvider,
  GoogleCalendarProviderError,
} from "@/lib/integrations/google-calendar-provider";
import { refreshGoogleAccessToken } from "@/lib/integrations/google-oauth";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/security/secret-encryption";
import { EntitlementService } from "@/lib/entitlements";
import { SupabaseServiceEntitlementRepository } from "@/lib/entitlements/supabase-service-repository";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { CalendarToolActionInput } from "@/lib/tool-actions/calendar";
import { ControlledToolActionError } from "@/lib/tool-actions/errors";

interface GoogleCredentialRow {
  integration_id: string;
  calendar_connection_id: string;
  token_expires_at: string | null;
  ciphertext: string | Uint8Array;
  initialization_vector: string | Uint8Array;
  authentication_tag: string | Uint8Array;
}

interface StoredGoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  scopes: string[];
}

interface StoredCalendarRow {
  id: string;
  external_calendar_id: string;
  is_selected: boolean;
  is_primary: boolean;
  is_personal: boolean;
  is_business: boolean;
}

interface SelectedCalendarRow {
  id: string;
  external_calendar_id: string;
}

type WritableSelectedCalendarRow = SelectedCalendarRow;

export interface GoogleCalendarCatalogResult {
  connectionId: string;
  calendarCount: number;
}

export interface GoogleCalendarEventSyncResult {
  connectionId: string;
  eventCount: number;
}

export interface GoogleCalendarToolActionResult {
  operation: "create" | "update" | "cancel";
  calendar_external_id: string;
  external_event_id: string;
  cache_synced: boolean;
}

function toProviderEventId(idempotencyKey: string): string {
  // Google Calendar accepts lowercase base32hex IDs. SHA-256 hex is a valid
  // subset (a-f, 0-9); the prefix keeps the value recognizable and >= 5 chars.
  return "ava" +
    createHash("sha256")
      .update("google-calendar-event:" + idempotencyKey)
      .digest("hex");
}

export class GoogleCalendarCredentialsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarCredentialsError";
  }
}

function fromBytea(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    throw new GoogleCalendarCredentialsError(
      "Stored Google credential data is invalid.",
    );
  }

  return Buffer.from(hex, "hex");
}

function toBytea(value: Uint8Array): string {
  return "\\x" + Buffer.from(value).toString("hex");
}

function parseStoredGoogleTokens(plaintext: string): StoredGoogleTokens {
  let value: unknown;
  try {
    value = JSON.parse(plaintext) as unknown;
  } catch {
    throw new GoogleCalendarCredentialsError(
      "Stored Google credential data is invalid.",
    );
  }

  if (typeof value !== "object" || value === null) {
    throw new GoogleCalendarCredentialsError(
      "Stored Google credential data is invalid.",
    );
  }

  const record = value as Record<string, unknown>;
  const accessToken =
    typeof record.accessToken === "string" ? record.accessToken : "";
  const refreshToken =
    typeof record.refreshToken === "string" ? record.refreshToken : "";
  const expiresAt =
    typeof record.expiresAt === "string" ? record.expiresAt : null;
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  if (!accessToken || !refreshToken) {
    throw new GoogleCalendarCredentialsError(
      "Stored Google credential data is incomplete.",
    );
  }

  return { accessToken, refreshToken, expiresAt, scopes };
}

function shouldRefreshToken(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMilliseconds = new Date(expiresAt).getTime();
  return (
    Number.isNaN(expiresAtMilliseconds) ||
    expiresAtMilliseconds <= Date.now() + 60_000
  );
}

async function markGoogleCalendarNeedsReauthorization(
  integrationId: string,
  connectionId: string,
): Promise<void> {
  const database = createSupabaseServiceClient();
  await Promise.all([
    database
      .from("integrations")
      .update({
        status: "needs_reauth",
        last_error_code: "oauth_refresh_failed",
        last_error_at: new Date().toISOString(),
      })
      .eq("id", integrationId),
    database
      .from("calendar_connections")
      .update({ sync_status: "needs_reauth" })
      .eq("id", connectionId),
  ]);
}

async function getGoogleCalendarProvider(organizationId: string): Promise<{
  provider: GoogleCalendarProvider;
  integrationId: string;
  calendarConnectionId: string;
}> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database.rpc("get_google_calendar_credential", {
    p_organization_id: organizationId,
  });
  if (error) {
    throw new GoogleCalendarCredentialsError(
      "Google Calendar credentials are unavailable.",
    );
  }

  const credential = (data as unknown as GoogleCredentialRow[] | null)?.[0];
  if (!credential) {
    throw new GoogleCalendarCredentialsError(
      "Connect Google Calendar before synchronizing calendars.",
    );
  }

  const stored = parseStoredGoogleTokens(
    decryptIntegrationSecret({
      ciphertext: fromBytea(credential.ciphertext),
      initializationVector: fromBytea(credential.initialization_vector),
      authenticationTag: fromBytea(credential.authentication_tag),
      keyVersion: 1,
    }),
  );
  let accessToken = stored.accessToken;

  if (shouldRefreshToken(credential.token_expires_at ?? stored.expiresAt)) {
    try {
      const refreshed = await refreshGoogleAccessToken(stored.refreshToken);
      accessToken = refreshed.accessToken;
      const encrypted = encryptIntegrationSecret(
        JSON.stringify({
          accessToken,
          refreshToken: stored.refreshToken,
          expiresAt: refreshed.expiresAt?.toISOString() ?? null,
          scopes: refreshed.scopes.length > 0 ? refreshed.scopes : stored.scopes,
        }),
      );
      const { error: persistError } = await database.rpc(
        "replace_google_calendar_credential",
        {
          p_integration_id: credential.integration_id,
          p_token_expires_at: refreshed.expiresAt?.toISOString() ?? null,
          p_ciphertext: toBytea(encrypted.ciphertext),
          p_initialization_vector: toBytea(encrypted.initializationVector),
          p_authentication_tag: toBytea(encrypted.authenticationTag),
        },
      );
      if (persistError) {
        throw new GoogleCalendarCredentialsError(
          "Google Calendar token refresh could not be stored.",
        );
      }
    } catch (error) {
      await markGoogleCalendarNeedsReauthorization(
        credential.integration_id,
        credential.calendar_connection_id,
      );
      if (error instanceof GoogleCalendarCredentialsError) {
        throw error;
      }

      throw new GoogleCalendarCredentialsError(
        "Google Calendar needs to be reconnected.",
      );
    }
  }

  return {
    provider: new GoogleCalendarProvider(accessToken),
    integrationId: credential.integration_id,
    calendarConnectionId: credential.calendar_connection_id,
  };
}

async function assertCalendarWriteEntitlement(
  organizationId: string,
): Promise<void> {
  const entitlements = new EntitlementService(
    new SupabaseServiceEntitlementRepository(),
  );
  const [hasCalendar, hasCalendarManagement] = await Promise.all([
    entitlements.hasFeature(organizationId, "calendar"),
    entitlements.hasFeature(organizationId, "calendar_management"),
  ]);
  if (!hasCalendar || !hasCalendarManagement) {
    throw new ControlledToolActionError("calendar_management_not_enabled");
  }
}

async function getWritableSelectedGoogleCalendar(
  organizationId: string,
  calendarConnectionId: string,
  externalCalendarId: string,
): Promise<WritableSelectedCalendarRow> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("calendars")
    .select("id, external_calendar_id")
    .eq("organization_id", organizationId)
    .eq("calendar_connection_id", calendarConnectionId)
    .eq("external_calendar_id", externalCalendarId)
    .eq("is_selected", true)
    .eq("can_write", true)
    .maybeSingle();
  if (error || !data) {
    throw new ControlledToolActionError("calendar_not_selected_or_writable");
  }

  return data as unknown as WritableSelectedCalendarRow;
}

async function persistMutatedCalendarEvent(
  organizationId: string,
  calendarId: string,
  input: Extract<CalendarToolActionInput, { kind: "create" | "update" }>,
  event: CalendarEvent,
): Promise<boolean> {
  try {
    const database = createSupabaseServiceClient();
    const { error } = await database.from("calendar_events").upsert(
      {
        organization_id: organizationId,
        calendar_id: calendarId,
        external_event_id: event.id,
        title: event.title,
        description: input.description ?? null,
        location: event.location ?? input.location ?? null,
        starts_at: event.startsAt.toISOString(),
        ends_at: event.endsAt.toISOString(),
        is_cancelled: false,
        attendees: input.attendeeEmails?.map((email) => ({ email })) ?? [],
        metadata: { provider: "google_calendar", source: "controlled_action" },
        synced_at: new Date().toISOString(),
      },
      { onConflict: "calendar_id,external_event_id" },
    );
    return !error;
  } catch {
    // The provider response is already authoritative. Do not turn a cache
    // failure into a provider retry, which could create a duplicate meeting.
    return false;
  }
}

async function markCalendarEventCancelled(
  organizationId: string,
  calendarId: string,
  externalEventId: string,
): Promise<boolean> {
  try {
    const database = createSupabaseServiceClient();
    const { error } = await database
      .from("calendar_events")
      .update({ is_cancelled: true, synced_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("calendar_id", calendarId)
      .eq("external_event_id", externalEventId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Executes a validated calendar operation at the final provider boundary.
 * This function is intentionally server-only and rechecks both entitlement and
 * selected-calendar write access immediately before using a tenant credential.
 */
export async function executeGoogleCalendarToolAction(
  organizationId: string,
  input: CalendarToolActionInput,
  idempotencyKey: string,
): Promise<GoogleCalendarToolActionResult> {
  await assertCalendarWriteEntitlement(organizationId);

  let providerContext: Awaited<ReturnType<typeof getGoogleCalendarProvider>>;
  try {
    providerContext = await getGoogleCalendarProvider(organizationId);
  } catch (error) {
    if (error instanceof GoogleCalendarCredentialsError) {
      throw new ControlledToolActionError("google_calendar_unavailable");
    }
    throw error;
  }

  const selectedCalendar = await getWritableSelectedGoogleCalendar(
    organizationId,
    providerContext.calendarConnectionId,
    input.externalCalendarId,
  );

  try {
    if (input.kind === "cancel") {
      await providerContext.provider.cancelEvent({
        externalCalendarId: input.externalCalendarId,
        externalEventId: input.externalEventId,
      });
      return {
        operation: "cancel",
        calendar_external_id: selectedCalendar.external_calendar_id,
        external_event_id: input.externalEventId,
        cache_synced: await markCalendarEventCancelled(
          organizationId,
          selectedCalendar.id,
          input.externalEventId,
        ),
      };
    }

    const event =
      input.kind === "create"
        ? await providerContext.provider.createEvent({
            ...input,
            providerEventId: toProviderEventId(idempotencyKey),
          })
        : await providerContext.provider.updateEvent(input);
    const cacheSynced = await persistMutatedCalendarEvent(
      organizationId,
      selectedCalendar.id,
      input,
      event,
    );
    return {
      operation: input.kind,
      calendar_external_id: selectedCalendar.external_calendar_id,
      external_event_id: event.id,
      cache_synced: cacheSynced,
    };
  } catch (error) {
    if (
      error instanceof GoogleCalendarProviderError &&
      (error.status === 401 || error.status === 403)
    ) {
      await markGoogleCalendarNeedsReauthorization(
        providerContext.integrationId,
        providerContext.calendarConnectionId,
      );
      throw new ControlledToolActionError(
        "google_calendar_reauthentication_required",
      );
    }
    if (error instanceof GoogleCalendarProviderError) {
      throw new ControlledToolActionError("google_calendar_provider_failed");
    }
    throw error;
  }
}

export async function syncGoogleCalendarCatalog(
  organizationId: string,
): Promise<GoogleCalendarCatalogResult> {
  const { provider, integrationId, calendarConnectionId } =
    await getGoogleCalendarProvider(organizationId);
  let remoteCalendars;
  try {
    remoteCalendars = await provider.listCalendars();
  } catch (error) {
    if (
      error instanceof GoogleCalendarProviderError &&
      (error.status === 401 || error.status === 403)
    ) {
      await markGoogleCalendarNeedsReauthorization(
        integrationId,
        calendarConnectionId,
      );
      throw new GoogleCalendarCredentialsError(
        "Google Calendar needs to be reconnected.",
      );
    }
    throw error;
  }

  const database = createSupabaseServiceClient();
  const { data: existingRows, error: existingError } = await database
    .from("calendars")
    .select(
      "id, external_calendar_id, is_selected, is_primary, is_personal, is_business",
    )
    .eq("organization_id", organizationId)
    .eq("calendar_connection_id", calendarConnectionId);
  if (existingError) {
    throw new Error("Could not read the connected calendar catalog.");
  }

  const existingByExternalId = new Map(
    (existingRows as unknown as StoredCalendarRow[] | null)?.map((calendar) => [
      calendar.external_calendar_id,
      calendar,
    ]) ?? [],
  );
  const remoteExternalIds = new Set(
    remoteCalendars.map((calendar) => calendar.externalId),
  );
  const catalogRows = remoteCalendars.map((calendar) => {
    const existing = existingByExternalId.get(calendar.externalId);
    return {
      organization_id: organizationId,
      calendar_connection_id: calendarConnectionId,
      external_calendar_id: calendar.externalId,
      name: calendar.name,
      timezone: calendar.timezone,
      can_read: calendar.canRead,
      can_write: calendar.canWrite,
      is_selected: existing?.is_selected ?? false,
      is_primary: existing?.is_primary ?? false,
      is_personal: existing?.is_personal ?? calendar.isPrimary,
      is_business: existing?.is_business ?? false,
    };
  });

  if (catalogRows.length > 0) {
    const { error: upsertError } = await database.from("calendars").upsert(
      catalogRows,
      { onConflict: "calendar_connection_id,external_calendar_id" },
    );
    if (upsertError) {
      throw new Error("Could not save the connected calendar catalog.");
    }
  }

  const missingExternalIds = [...existingByExternalId.keys()].filter(
    (externalId) => !remoteExternalIds.has(externalId),
  );
  if (missingExternalIds.length > 0) {
    const { error: missingUpdateError } = await database
      .from("calendars")
      .update({
        can_read: false,
        can_write: false,
        is_selected: false,
        is_primary: false,
      })
      .eq("organization_id", organizationId)
      .eq("calendar_connection_id", calendarConnectionId)
      .in("external_calendar_id", missingExternalIds);
    if (missingUpdateError) {
      throw new Error("Could not reconcile the connected calendar catalog.");
    }
  }

  const now = new Date().toISOString();
  const [connectionUpdate, integrationUpdate, auditInsert] = await Promise.all([
    database
      .from("calendar_connections")
      .update({
        sync_status: "connected",
        last_synced_at: now,
        next_sync_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      })
      .eq("id", calendarConnectionId)
      .eq("organization_id", organizationId),
    database
      .from("integrations")
      .update({
        status: "connected",
        last_successful_sync_at: now,
        last_error_code: null,
        last_error_at: null,
      })
      .eq("id", integrationId)
      .eq("organization_id", organizationId),
    database.from("audit_logs").insert({
      organization_id: organizationId,
      actor_type: "system",
      action: "calendar.catalog.synced",
      tool_name: "google_calendar",
      target_type: "calendar_connection",
      target_id: calendarConnectionId,
      result: "succeeded",
      metadata: { calendar_count: remoteCalendars.length },
    }),
  ]);
  if (connectionUpdate.error || integrationUpdate.error || auditInsert.error) {
    throw new Error("Google Calendar catalog synchronization was not recorded.");
  }

  return {
    connectionId: calendarConnectionId,
    calendarCount: remoteCalendars.length,
  };
}

export async function syncSelectedGoogleCalendarEvents(
  organizationId: string,
  range: { startsAt: Date; endsAt: Date },
): Promise<GoogleCalendarEventSyncResult> {
  const { provider, integrationId, calendarConnectionId } =
    await getGoogleCalendarProvider(organizationId);
  const database = createSupabaseServiceClient();
  const { data: selectedRows, error: selectedError } = await database
    .from("calendars")
    .select("id, external_calendar_id")
    .eq("organization_id", organizationId)
    .eq("calendar_connection_id", calendarConnectionId)
    .eq("is_selected", true)
    .eq("can_read", true);
  if (selectedError) {
    throw new Error("Could not read selected calendars.");
  }

  const selectedCalendars =
    (selectedRows as unknown as SelectedCalendarRow[] | null) ?? [];
  const records: Array<Record<string, unknown>> = [];
  try {
    for (const calendar of selectedCalendars) {
      const events = await provider.listEventsForCalendars(
        [calendar.external_calendar_id],
        range,
      );
      records.push(
        ...events.map((event) =>
          toCalendarEventRecord(organizationId, calendar.id, event),
        ),
      );
    }
  } catch (error) {
    if (
      error instanceof GoogleCalendarProviderError &&
      (error.status === 401 || error.status === 403)
    ) {
      await markGoogleCalendarNeedsReauthorization(
        integrationId,
        calendarConnectionId,
      );
      throw new GoogleCalendarCredentialsError(
        "Google Calendar needs to be reconnected.",
      );
    }
    throw error;
  }

  if (records.length > 0) {
    const { error: eventUpsertError } = await database
      .from("calendar_events")
      .upsert(records, { onConflict: "calendar_id,external_event_id" });
    if (eventUpsertError) {
      throw new Error("Could not save synchronized calendar events.");
    }
  }

  const now = new Date().toISOString();
  const [connectionUpdate, integrationUpdate, auditInsert] = await Promise.all([
    database
      .from("calendar_connections")
      .update({
        sync_status: "connected",
        last_synced_at: now,
        next_sync_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      })
      .eq("id", calendarConnectionId)
      .eq("organization_id", organizationId),
    database
      .from("integrations")
      .update({
        status: "connected",
        last_successful_sync_at: now,
        last_error_code: null,
        last_error_at: null,
      })
      .eq("id", integrationId)
      .eq("organization_id", organizationId),
    database.from("audit_logs").insert({
      organization_id: organizationId,
      actor_type: "system",
      action: "calendar.events.synced",
      tool_name: "google_calendar",
      target_type: "calendar_connection",
      target_id: calendarConnectionId,
      result: "succeeded",
      metadata: { event_count: records.length },
    }),
  ]);
  if (connectionUpdate.error || integrationUpdate.error || auditInsert.error) {
    throw new Error("Google Calendar event synchronization was not recorded.");
  }

  return {
    connectionId: calendarConnectionId,
    eventCount: records.length,
  };
}

function toCalendarEventRecord(
  organizationId: string,
  calendarId: string,
  event: CalendarEvent,
): Record<string, unknown> {
  return {
    organization_id: organizationId,
    calendar_id: calendarId,
    external_event_id: event.id,
    title: event.title,
    location: event.location ?? null,
    starts_at: event.startsAt.toISOString(),
    ends_at: event.endsAt.toISOString(),
    is_cancelled: event.isCancelled ?? false,
    metadata: { provider: "google_calendar" },
    synced_at: new Date().toISOString(),
  };
}
