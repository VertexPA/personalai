"use client";

import { Check, LoaderCircle, RefreshCw, Star } from "lucide-react";
import { useState, useTransition } from "react";

import {
  saveGoogleCalendarSelection,
  syncGoogleCalendarCatalogAction,
  syncSelectedGoogleCalendarEventsAction,
} from "@/app/(app)/integrations/google-calendar-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CalendarOption {
  externalId: string;
  name: string;
  timezone: string | null;
  isSelected: boolean;
  isPrimary: boolean;
  canRead: boolean;
  canWrite: boolean;
}

interface GoogleCalendarManagerProps {
  connectionId: string;
  calendars: CalendarOption[];
  canManage: boolean;
  lastSyncedAt: string | null;
}

function formatCatalogSyncTime(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? "at an unknown time"
    : timestamp.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function GoogleCalendarManager({
  connectionId,
  calendars,
  canManage,
  lastSyncedAt,
}: GoogleCalendarManagerProps) {
  const [selectedCalendarIds, setSelectedCalendarIds] = useState(
    () =>
      new Set(
        calendars
          .filter((calendar) => calendar.isSelected && calendar.canRead)
          .map((calendar) => calendar.externalId),
      ),
  );
  const [primaryCalendarExternalId, setPrimaryCalendarExternalId] = useState<
    string | null
  >(
    () =>
      calendars.find((calendar) => calendar.isPrimary)?.externalId ??
      calendars.find((calendar) => calendar.isSelected)?.externalId ??
      null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleCalendar(calendar: CalendarOption) {
    if (!canManage || isPending || !calendar.canRead) {
      return;
    }

    const next = new Set(selectedCalendarIds);
    if (next.has(calendar.externalId)) {
      next.delete(calendar.externalId);
      if (primaryCalendarExternalId === calendar.externalId) {
        setPrimaryCalendarExternalId(next.values().next().value ?? null);
      }
    } else {
      next.add(calendar.externalId);
      if (!primaryCalendarExternalId) {
        setPrimaryCalendarExternalId(calendar.externalId);
      }
    }
    setSelectedCalendarIds(next);
  }

  function saveSelection() {
    startTransition(async () => {
      const result = await saveGoogleCalendarSelection({
        calendarConnectionId: connectionId,
        selectedCalendarIds: [...selectedCalendarIds],
        primaryCalendarExternalId,
      });
      setNotice(result.message);
    });
  }

  function syncCatalog() {
    startTransition(async () => {
      const result = await syncGoogleCalendarCatalogAction();
      setNotice(result.message);
    });
  }

  function syncEvents() {
    startTransition(async () => {
      const result = await syncSelectedGoogleCalendarEventsAction();
      setNotice(result.message);
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Select permitted calendars</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Ava only reads calendars selected here. Write access remains subject
            to the controlled tool gateway and approval policy.
          </p>
        </div>
        {lastSyncedAt ? (
          <Badge variant="outline">
            Catalog synced {formatCatalogSyncTime(lastSyncedAt)}
          </Badge>
        ) : null}
      </div>

      {calendars.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm leading-6 text-muted-foreground">
          No calendar catalog has been synchronized yet. Refresh Google Calendar
          to discover calendars available to this workspace.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {calendars.map((calendar) => {
            const isSelected = selectedCalendarIds.has(calendar.externalId);
            const isPrimary =
              primaryCalendarExternalId === calendar.externalId && isSelected;
            return (
              <div
                className={
                  "flex items-center gap-3 rounded-lg border p-3 " +
                  (isSelected ? "border-primary/40 bg-primary/[0.03]" : "")
                }
                key={calendar.externalId}
              >
                <button
                  aria-pressed={isSelected}
                  className="grid size-5 shrink-0 place-items-center rounded border border-input text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canManage || isPending || !calendar.canRead}
                  onClick={() => toggleCalendar(calendar)}
                  type="button"
                >
                  {isSelected ? <Check className="size-3.5" /> : null}
                  <span className="sr-only">
                    {isSelected ? "Deselect " : "Select "}
                    {calendar.name}
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{calendar.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {calendar.timezone ?? "Timezone unavailable"} ·{" "}
                    {calendar.canWrite ? "Read and write" : "Read only"}
                  </p>
                </div>
                {isPrimary ? (
                  <Badge variant="secondary">
                    <Star data-icon="inline-start" />
                    Primary
                  </Badge>
                ) : isSelected && canManage ? (
                  <Button
                    disabled={isPending}
                    onClick={() => setPrimaryCalendarExternalId(calendar.externalId)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    Make primary
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            <Button
              disabled={isPending}
              onClick={syncCatalog}
              size="sm"
              type="button"
              variant="outline"
            >
              {isPending ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh calendars
            </Button>
            <Button
              disabled={
                isPending ||
                (selectedCalendarIds.size > 0 &&
                  primaryCalendarExternalId === null)
              }
              onClick={saveSelection}
              size="sm"
              type="button"
            >
              Save selection
            </Button>
            <Button
              disabled={isPending || selectedCalendarIds.size === 0}
              onClick={syncEvents}
              size="sm"
              type="button"
              variant="outline"
            >
              Sync selected events
            </Button>
          </>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            A workspace owner or admin can refresh and select calendars.
          </p>
        )}
      </div>
      <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
        {notice}
      </p>
    </section>
  );
}
