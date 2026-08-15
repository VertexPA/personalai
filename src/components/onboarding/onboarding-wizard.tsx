"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  ShieldCheck,
} from "lucide-react";

import { saveOnboardingStep } from "@/app/(app)/onboarding/actions";
import type { OnboardingSeed } from "@/data/onboarding";
import {
  onboardingSteps,
  type OnboardingSaveInput,
} from "@/lib/onboarding/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const planDetails = {
  personal: {
    name: "Personal",
    detail: "Calendar, messaging, morning brief, and basic travel planning.",
  },
  executive: {
    name: "Executive",
    detail: "Travel-aware planning, Gmail, advanced memory, and up to four calendars.",
  },
  business: {
    name: "Business",
    detail: "Teams, Slack, approval workflows, audit logs, and shared calendars.",
  },
} as const;

function getInitialStep(seed: OnboardingSeed): number {
  if (seed.completed) {
    return onboardingSteps.length - 1;
  }

  const stepIndex = onboardingSteps.findIndex(
    (step) => step.key === seed.currentStep,
  );
  return stepIndex >= 0 ? stepIndex : 0;
}

function getInitialChannels(seed: OnboardingSeed): string[] {
  const configuredChannels = seed.state.channels;
  if (!Array.isArray(configuredChannels)) {
    return ["whatsapp", "telegram"];
  }

  return configuredChannels.filter(
    (channel): channel is string => typeof channel === "string",
  );
}

export function OnboardingWizard({
  initialState,
}: {
  initialState: OnboardingSeed;
}) {
  const [activeStep, setActiveStep] = useState(() => getInitialStep(initialState));
  const [organizationId, setOrganizationId] = useState(initialState.organizationId);
  const [planCode, setPlanCode] = useState(initialState.planCode);
  const [organizationName, setOrganizationName] = useState(
    initialState.organizationName,
  );
  const [workspaceSlug, setWorkspaceSlug] = useState(initialState.workspaceSlug);
  const [timezone, setTimezone] = useState(initialState.timezone);
  const [workingHours, setWorkingHours] = useState(initialState.workingHours);
  const [assistantName, setAssistantName] = useState(initialState.assistantName);
  const [assistantTone, setAssistantTone] = useState(initialState.assistantTone);
  const [morningBriefEnabled, setMorningBriefEnabled] = useState(
    initialState.morningBriefEnabled,
  );
  const [morningBriefTime, setMorningBriefTime] = useState(
    initialState.morningBriefTime,
  );
  const [meetingBufferMinutes, setMeetingBufferMinutes] = useState(
    initialState.meetingBufferMinutes,
  );
  const [travelBufferMinutes, setTravelBufferMinutes] = useState(
    initialState.travelBufferMinutes,
  );
  const [externalActionsRequireApproval, setExternalActionsRequireApproval] =
    useState(initialState.externalActionsRequireApproval);
  const [defaultLocationLabel, setDefaultLocationLabel] = useState(
    initialState.defaultLocationLabel,
  );
  const [defaultLocationAddress, setDefaultLocationAddress] = useState(
    initialState.defaultLocationAddress,
  );
  const [channels, setChannels] = useState(() => getInitialChannels(initialState));
  const [statusMessage, setStatusMessage] = useState(
    initialState.mode === "demo"
      ? "Development preview: no external account or database mutation is performed."
      : initialState.completed
        ? "This workspace has completed onboarding. You can revisit any setting."
        : "",
  );
  const [isPending, startTransition] = useTransition();

  const isLastStep = activeStep === onboardingSteps.length - 1;
  const activeStepDefinition = onboardingSteps[activeStep];

  function toggleChannel(channel: string) {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((candidate) => candidate !== channel)
        : [...current, channel],
    );
  }

  function createWorkspaceSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  }

  function saveAndContinue() {
    const targetStepIndex = isLastStep ? activeStep : activeStep + 1;
    const currentStep = onboardingSteps[targetStepIndex].key;
    const completedSteps = onboardingSteps
      .slice(0, isLastStep ? onboardingSteps.length : targetStepIndex)
      .map((step) => step.key);
    const input: OnboardingSaveInput = {
      organizationId,
      organizationName,
      workspaceSlug,
      timezone,
      planCode,
      currentStep,
      completedSteps,
      state: {
        channels,
        googleConnection: "not_connected",
        calendarSelection: "pending_connection",
        externalActionsRequireApproval,
      },
      workingHours,
      assistantName,
      assistantTone,
      morningBriefEnabled,
      morningBriefTime,
      meetingBufferMinutes,
      travelBufferMinutes,
      externalActionsRequireApproval,
      defaultLocationLabel,
      defaultLocationAddress,
      activate: isLastStep,
    };

    startTransition(async () => {
      const result = await saveOnboardingStep(input);
      setStatusMessage(result.message);

      if (result.status === "saved") {
        setOrganizationId(result.organizationId);
      }

      if (result.status === "saved" || result.status === "demo") {
        if (!isLastStep) {
          setActiveStep(targetStepIndex);
        }
      }
    });
  }

  const statusTone =
    initialState.mode === "demo" || statusMessage.includes("preview")
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : statusMessage.includes("could not") ||
          statusMessage.includes("invalid") ||
          statusMessage.includes("Sign in")
        ? "border-destructive/30 bg-destructive/5 text-destructive"
        : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className="grid gap-6 lg:grid-cols-[238px_minmax(0,1fr)]">
      <Card className="h-fit border-border/80 shadow-none">
        <CardContent className="p-3">
          <div className="mb-3 px-2.5 pt-1">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Workspace setup
            </p>
          </div>
          <div className="space-y-0.5">
            {onboardingSteps.map((step, index) => (
              <div
                className={
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm " +
                  (index === activeStep
                    ? "bg-primary/8 font-medium text-primary"
                    : index < activeStep
                      ? "text-foreground"
                      : "text-muted-foreground")
                }
                key={step.key}
              >
                <span
                  className={
                    "grid size-5 place-items-center rounded-full text-[10px] " +
                    (index < activeStep
                      ? "bg-emerald-600 text-white"
                      : index === activeStep
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted")
                  }
                >
                  {index < activeStep ? <Check className="size-3" /> : index + 1}
                </span>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <Badge className="w-fit" variant="outline">
            Step {activeStep + 1} of {onboardingSteps.length}
          </Badge>
          <CardTitle className="mt-2 text-xl">
            {activeStepDefinition.label}
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {initialState.mode === "demo"
              ? "Explore the full customer setup flow with clearly labelled demo data."
              : "Your changes are saved to the organization you are authorized to administer."}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {activeStep === 0 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(planDetails).map(([code, plan]) => (
                <Button
                  className="h-auto min-h-32 items-start justify-start whitespace-normal p-4 text-left"
                  key={code}
                  onClick={() =>
                    setPlanCode(code as OnboardingSaveInput["planCode"])
                  }
                  type="button"
                  variant={planCode === code ? "default" : "outline"}
                >
                  <span>
                    <span className="block text-sm font-semibold">{plan.name}</span>
                    <span className="mt-1 block text-xs leading-5 opacity-80">
                      {plan.detail}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ) : null}

          {activeStep === 1 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="organization">Organization name</Label>
                <Input
                  id="organization"
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setOrganizationName(nextName);
                    if (!organizationId) {
                      setWorkspaceSlug(createWorkspaceSlug(nextName));
                    }
                  }}
                  value={organizationName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace">Workspace slug</Label>
                <Input
                  id="workspace"
                  onChange={(event) =>
                    setWorkspaceSlug(createWorkspaceSlug(event.target.value))
                  }
                  value={workspaceSlug}
                />
                <p className="text-xs text-muted-foreground">
                  Used in internal workspace references. It must be unique.
                </p>
              </div>
            </div>
          ) : null}

          {activeStep === 2 ? (
            <div className="max-w-md space-y-2">
              <Label htmlFor="timezone">Organization timezone</Label>
              <Select onValueChange={setTimezone} value={timezone}>
                <SelectTrigger id="timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Kuala_Lumpur">
                    Asia/Kuala_Lumpur
                  </SelectItem>
                  <SelectItem value="Asia/Singapore">Asia/Singapore</SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                  <SelectItem value="America/New_York">
                    America/New_York
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                Ava uses this IANA timezone for calendar displays, reminders,
                travel calculations, and scheduled briefs.
              </p>
            </div>
          ) : null}

          {activeStep === 3 ? (
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="working-start">Working day starts</Label>
                <Input
                  id="working-start"
                  onChange={(event) =>
                    setWorkingHours((current) => ({
                      ...current,
                      startsAt: event.target.value,
                    }))
                  }
                  type="time"
                  value={workingHours.startsAt}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="working-end">Working day ends</Label>
                <Input
                  id="working-end"
                  onChange={(event) =>
                    setWorkingHours((current) => ({
                      ...current,
                      endsAt: event.target.value,
                    }))
                  }
                  type="time"
                  value={workingHours.endsAt}
                />
              </div>
              <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                Monday through Friday is selected by default. Meeting suggestions
                use these hours as a constraint rather than silently booking time.
              </p>
            </div>
          ) : null}

          {activeStep === 4 ? (
            <div className="rounded-lg border border-dashed p-5 text-sm leading-6 text-muted-foreground">
              <p className="font-medium text-foreground">Google connection</p>
              <p className="mt-1">
                OAuth is intentionally initiated from Integrations after this
                workspace is saved. Tokens stay encrypted in the private database
                schema and never enter this browser form.
              </p>
            </div>
          ) : null}

          {activeStep === 5 ? (
            <div className="rounded-lg border border-dashed p-5 text-sm leading-6 text-muted-foreground">
              Calendar selection becomes available after Google OAuth succeeds.
              Ava will ask which calendars can be read, which can be changed, and
              which is primary before it syncs events.
            </div>
          ) : null}

          {activeStep === 6 ? (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                Choose the channels you plan to connect. This records intent only;
                a webhook is never activated until its provider credentials and
                tenant link are configured.
              </p>
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <input
                  checked={channels.includes("whatsapp")}
                  className="size-4 accent-primary"
                  onChange={() => toggleChannel("whatsapp")}
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">WhatsApp</span>
                  <span className="text-xs text-muted-foreground">
                    Signed Cloud API webhook and outbound provider adapter.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <input
                  checked={channels.includes("telegram")}
                  className="size-4 accent-primary"
                  onChange={() => toggleChannel("telegram")}
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">Telegram</span>
                  <span className="text-xs text-muted-foreground">
                    Secret-token webhook and chat-to-tenant linking.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {activeStep === 7 ? (
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="assistant-name">Assistant name</Label>
                <Input
                  id="assistant-name"
                  onChange={(event) => setAssistantName(event.target.value)}
                  value={assistantName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assistant-tone">Assistant tone</Label>
                <Textarea
                  id="assistant-tone"
                  onChange={(event) => setAssistantTone(event.target.value)}
                  value={assistantTone}
                />
              </div>
            </div>
          ) : null}

          {activeStep === 8 ? (
            <div className="grid max-w-xl gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
              <label className="flex items-center gap-2 pb-2 text-sm font-medium">
                <input
                  checked={morningBriefEnabled}
                  className="size-4 accent-primary"
                  onChange={(event) => setMorningBriefEnabled(event.target.checked)}
                  type="checkbox"
                />
                Send daily brief
              </label>
              <div className="space-y-2">
                <Label htmlFor="brief-time">Brief delivery time</Label>
                <Input
                  disabled={!morningBriefEnabled}
                  id="brief-time"
                  onChange={(event) => setMorningBriefTime(event.target.value)}
                  type="time"
                  value={morningBriefTime}
                />
              </div>
            </div>
          ) : null}

          {activeStep === 9 ? (
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="meeting-buffer">Meeting buffer (minutes)</Label>
                <Input
                  id="meeting-buffer"
                  max={240}
                  min={0}
                  onChange={(event) =>
                    setMeetingBufferMinutes(Number(event.target.value))
                  }
                  type="number"
                  value={meetingBufferMinutes}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="travel-buffer">Travel buffer (minutes)</Label>
                <Input
                  id="travel-buffer"
                  max={240}
                  min={0}
                  onChange={(event) =>
                    setTravelBufferMinutes(Number(event.target.value))
                  }
                  type="number"
                  value={travelBufferMinutes}
                />
              </div>
            </div>
          ) : null}

          {activeStep === 10 ? (
            <div className="rounded-lg border p-5">
              <label className="flex items-start gap-3 text-sm">
                <input
                  checked={externalActionsRequireApproval}
                  className="mt-0.5 size-4 accent-primary"
                  onChange={(event) =>
                    setExternalActionsRequireApproval(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">
                    Require approval for external meeting changes
                  </span>
                  <span className="mt-1 block leading-6 text-muted-foreground">
                    Enabled by default for creating, moving, cancelling, and
                    notifying attendees about external meetings. Calendar reads,
                    recommendations, and travel checks remain non-destructive.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {activeStep === 11 ? (
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="location-label">Default location label</Label>
                <Input
                  id="location-label"
                  onChange={(event) => setDefaultLocationLabel(event.target.value)}
                  placeholder="Home office"
                  value={defaultLocationLabel}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-address">Default location address</Label>
                <Textarea
                  id="location-address"
                  onChange={(event) => setDefaultLocationAddress(event.target.value)}
                  placeholder="Street address used as a travel origin"
                  value={defaultLocationAddress}
                />
              </div>
            </div>
          ) : null}

          {isLastStep ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-900">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-4" />
                Ready to activate
              </div>
              <p className="mt-2">
                Activation saves your workspace configuration. Ava still cannot
                execute external actions until an entitled, authorized integration
                and any required approval are present.
              </p>
            </div>
          ) : null}

          {statusMessage ? (
            <div
              className={"flex items-start gap-2 rounded-lg border p-3 text-sm " + statusTone}
              role="status"
            >
              {statusTone.includes("destructive") ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              )}
              <p>{statusMessage}</p>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between">
          <Button
            disabled={activeStep === 0 || isPending}
            onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
            type="button"
            variant="outline"
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          <Button disabled={isPending} onClick={saveAndContinue} type="button">
            {isPending
              ? "Saving…"
              : isLastStep
                ? "Activate assistant"
                : "Save and continue"}
            {!isPending && !isLastStep ? <ArrowRight data-icon="inline-end" /> : null}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
