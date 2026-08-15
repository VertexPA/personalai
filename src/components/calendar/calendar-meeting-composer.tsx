"use client";

import { CalendarPlus, LoaderCircle } from "lucide-react";
import { FormEvent, useRef, useState, useTransition } from "react";

import { requestCalendarToolAction } from "@/app/(app)/calendar/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface WritableCalendarOption {
  externalId: string;
  name: string;
  timezone: string | null;
}

interface CalendarMeetingComposerProps {
  calendars: WritableCalendarOption[];
  timeZone: string;
  canCreate: boolean;
  isDemoMode: boolean;
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function CalendarMeetingComposer({
  calendars,
  timeZone,
  canCreate,
  isDemoMode,
}: CalendarMeetingComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const firstCalendar = calendars[0]?.externalId ?? "";

  function resetComposer() {
    formRef.current?.reset();
    setNotice(null);
    setAccepted(false);
    idempotencyKeyRef.current = null;
  }

  function setDialogOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetComposer();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstCalendar) {
      return;
    }

    const idempotencyKey = idempotencyKeyRef.current ?? newIdempotencyKey();
    idempotencyKeyRef.current = idempotencyKey;

    const formData = new FormData(event.currentTarget);
    const attendeeEmails = String(formData.get("attendees") ?? "")
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = await requestCalendarToolAction({
        operation: "create",
        idempotencyKey,
        externalCalendarId: String(formData.get("calendar") ?? ""),
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? "") || undefined,
        location: String(formData.get("location") ?? "") || undefined,
        startsAt: String(formData.get("startsAt") ?? ""),
        endsAt: String(formData.get("endsAt") ?? ""),
        attendeeEmails: attendeeEmails.length > 0 ? attendeeEmails : undefined,
      });
      setNotice(result.message);
      if (result.status !== "error") {
        setAccepted(true);
      }
    });
  }

  const unavailableMessage = isDemoMode
    ? "Calendar changes are disabled in the development preview."
    : !canCreate
      ? "Your role or plan does not permit calendar changes."
      : calendars.length === 0
        ? "Select a writable Google Calendar in Integrations before creating a meeting."
        : null;
  const disabled = Boolean(unavailableMessage);

  return (
    <Dialog onOpenChange={setDialogOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={disabled} title={unavailableMessage ?? undefined}>
          <CalendarPlus data-icon="inline-start" />
          Create meeting
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a meeting</DialogTitle>
          <DialogDescription>
            Times are interpreted in the workspace timezone: {timeZone}. Meetings
            with attendees are held for approval before the controlled executor
            calls Google Calendar.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} ref={formRef}>
          <div className="space-y-2">
            <Label htmlFor="calendar-title">Title</Label>
            <Input id="calendar-title" maxLength={500} name="title" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="calendar-target">Calendar</Label>
              <select
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                defaultValue={firstCalendar}
                id="calendar-target"
                name="calendar"
                required
              >
                {calendars.map((calendar) => (
                  <option key={calendar.externalId} value={calendar.externalId}>
                    {calendar.name}
                    {calendar.timezone ? " · " + calendar.timezone : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="calendar-location">Location</Label>
              <Input id="calendar-location" maxLength={8_000} name="location" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="calendar-start">Starts</Label>
              <Input id="calendar-start" name="startsAt" required type="datetime-local" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calendar-end">Ends</Label>
              <Input id="calendar-end" name="endsAt" required type="datetime-local" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="calendar-attendees">Attendees</Label>
            <Input
              id="calendar-attendees"
              name="attendees"
              placeholder="name@example.com, teammate@example.com"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Separate email addresses with commas. Adding attendees requires approval.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="calendar-description">Description</Label>
            <Textarea id="calendar-description" maxLength={8_000} name="description" />
          </div>
          {notice ? (
            <p aria-live="polite" className="text-sm leading-6 text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <DialogFooter showCloseButton>
            <Button disabled={isPending || accepted} type="submit">
              {isPending ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <CalendarPlus data-icon="inline-start" />
              )}
              {accepted ? "Request submitted" : "Request meeting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
