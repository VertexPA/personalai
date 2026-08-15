"use client";

import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import {
  saveWorkspaceSettings,
  type WorkspaceSettingsInput,
} from "@/app/(app)/settings/actions";
import type { WorkspaceSettingsView } from "@/data/workspace-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const weekdays = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function toInput(initialState: WorkspaceSettingsView): WorkspaceSettingsInput {
  return {
    assistantName: initialState.assistantName,
    assistantTone: initialState.assistantTone,
    timezone: initialState.timezone,
    workingHours: initialState.workingHours,
    morningBriefEnabled: initialState.morningBriefEnabled,
    morningBriefTime: initialState.morningBriefTime,
    meetingBufferMinutes: initialState.meetingBufferMinutes,
    travelBufferMinutes: initialState.travelBufferMinutes,
    externalActionsRequireApproval: initialState.externalActionsRequireApproval,
  };
}

export function WorkspaceSettingsEditor({
  initialState,
}: {
  initialState: WorkspaceSettingsView;
}) {
  const [settings, setSettings] = useState(() => toInput(initialState));
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const disabled = !initialState.canManage || isPending;

  function toggleWorkingDay(day: number) {
    if (disabled) {
      return;
    }

    setSettings((current) => {
      const days = current.workingHours.days.includes(day)
        ? current.workingHours.days.filter((candidate) => candidate !== day)
        : [...current.workingHours.days, day].sort((left, right) => left - right);
      return { ...current, workingHours: { ...current.workingHours, days } };
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveWorkspaceSettings(settings);
      setNotice(result.message);
    });
  }

  if (!initialState.hasWorkspace) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
          Complete onboarding to configure workspace settings.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Assistant & schedule</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            These settings stay inside the selected workspace and are applied to
            future scheduling and automation work.
          </p>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="assistant-name">Assistant name</Label>
            <Input
              disabled={disabled}
              id="assistant-name"
              maxLength={60}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  assistantName: event.target.value,
                }))
              }
              value={settings.assistantName}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="workspace-timezone">IANA timezone</Label>
            <Input
              disabled={disabled}
              id="workspace-timezone"
              onChange={(event) =>
                setSettings((current) => ({ ...current, timezone: event.target.value }))
              }
              placeholder="Asia/Kuala_Lumpur"
              value={settings.timezone}
            />
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <Label htmlFor="assistant-tone">Assistant tone</Label>
            <Textarea
              disabled={disabled}
              id="assistant-tone"
              maxLength={240}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  assistantTone: event.target.value,
                }))
              }
              value={settings.assistantTone}
            />
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((day) => {
                const selected = settings.workingHours.days.includes(day.value);
                return (
                  <Button
                    aria-pressed={selected}
                    disabled={disabled}
                    key={day.value}
                    onClick={() => toggleWorkingDay(day.value)}
                    size="sm"
                    type="button"
                    variant={selected ? "secondary" : "outline"}
                  >
                    {day.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="working-start">Starts</Label>
              <Input
                disabled={disabled}
                id="working-start"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    workingHours: {
                      ...current.workingHours,
                      startsAt: event.target.value,
                    },
                  }))
                }
                type="time"
                value={settings.workingHours.startsAt}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="working-end">Ends</Label>
              <Input
                disabled={disabled}
                id="working-end"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    workingHours: {
                      ...current.workingHours,
                      endsAt: event.target.value,
                    },
                  }))
                }
                type="time"
                value={settings.workingHours.endsAt}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="meeting-buffer">Meeting buffer (minutes)</Label>
              <Input
                disabled={disabled}
                id="meeting-buffer"
                max={240}
                min={0}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    meetingBufferMinutes: Number(event.target.value),
                  }))
                }
                type="number"
                value={settings.meetingBufferMinutes}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="travel-buffer">Travel buffer (minutes)</Label>
              <Input
                disabled={disabled}
                id="travel-buffer"
                max={240}
                min={0}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    travelBufferMinutes: Number(event.target.value),
                  }))
                }
                type="number"
                value={settings.travelBufferMinutes}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Briefing & approvals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <input
              checked={settings.morningBriefEnabled}
              className="size-4 rounded border-input accent-primary"
              disabled={disabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  morningBriefEnabled: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Enable a weekday morning brief
          </label>
          <div className="grid max-w-52 gap-2">
            <Label htmlFor="morning-brief-time">Brief time</Label>
            <Input
              disabled={disabled || !settings.morningBriefEnabled}
              id="morning-brief-time"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  morningBriefTime: event.target.value,
                }))
              }
              type="time"
              value={settings.morningBriefTime}
            />
          </div>
          <label className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm leading-6">
            <input
              checked={settings.externalActionsRequireApproval}
              className="mt-1 size-4 rounded border-input accent-primary"
              disabled={disabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  externalActionsRequireApproval: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>
              <span className="font-medium">Require approval for sensitive external actions</span>
              <span className="block text-muted-foreground">
                Turning this off changes the default for external calendar moves,
                cancellations, email sends, and outbound notifications. Individual
                controls still pass entitlement, role, and idempotency checks.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={disabled} onClick={save} type="button">
          {isPending ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          Save workspace settings
        </Button>
        {!initialState.canManage ? (
          <Badge variant="outline">Owner or admin access required</Badge>
        ) : null}
        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
          {notice}
        </p>
      </div>

      <Card className="border-border/80 shadow-none">
        <CardContent className="flex gap-3 p-5">
          <ShieldCheck className="mt-0.5 size-5 text-emerald-600" />
          <p className="text-sm leading-6 text-muted-foreground">
            Settings are saved through a tenant-admin database transaction. The
            browser cannot choose another organization or write directly to its
            settings tables.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
