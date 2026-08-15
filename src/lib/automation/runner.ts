import "server-only";

import { getAutomationDuePlan } from "@/lib/automation/due";
import { detectCalendarConflicts, type CalendarEvent } from "@/lib/calendar/conflicts";
import { buildMorningBrief } from "@/lib/briefings/morning-brief";
import { EntitlementService } from "@/lib/entitlements";
import { SupabaseServiceEntitlementRepository } from "@/lib/entitlements/supabase-service-repository";
import { getZonedDayRange } from "@/lib/timezone";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface AutomationRow {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  schedule: string;
  timezone: string;
  configuration: unknown;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface PreferenceRow {
  assistant_name: string;
  default_meeting_buffer_minutes: number;
}

interface OwnerRow {
  user_id: string;
  profiles: { full_name: string | null; email: string | null } | null;
}

interface CalendarEventRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  is_cancelled: boolean;
}

interface AutomationRunRow {
  id: string;
}

export interface AutomationRunSummary {
  inspected: number;
  started: number;
  succeeded: number;
  skipped: number;
  failed: number;
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

function getRecipientName(owner: OwnerRow): string {
  return owner.profiles?.full_name ?? owner.profiles?.email ?? "there";
}

async function claimAutomationRun(
  automation: AutomationRow,
  idempotencyKey: string,
  now: Date,
): Promise<string | null> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("automation_runs")
    .insert({
      organization_id: automation.organization_id,
      automation_id: automation.id,
      idempotency_key: idempotencyKey,
      status: "running",
      started_at: now.toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") {
    return null;
  }
  if (error || !data) {
    throw new Error("Could not claim the scheduled automation run.");
  }

  return (data as unknown as AutomationRunRow).id;
}

async function updateAutomationAfterRun(
  automation: AutomationRow,
  nextRunAt: Date,
  status: "succeeded" | "skipped" | "failed",
  now: Date,
): Promise<void> {
  const database = createSupabaseServiceClient();
  const { error } = await database
    .from("automations")
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRunAt.toISOString(),
      last_status: status,
      last_error:
        status === "failed"
          ? "Automation execution failed. Inspect secure server logs."
          : null,
      status: status === "failed" ? "failed" : "active",
    })
    .eq("id", automation.id)
    .eq("organization_id", automation.organization_id);
  if (error) {
    throw new Error("Could not update the automation schedule.");
  }
}

async function completeAutomationRun(
  runId: string,
  status: "succeeded" | "skipped" | "failed",
  output: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const database = createSupabaseServiceClient();
  const { error } = await database
    .from("automation_runs")
    .update({
      status,
      output,
      error_message:
        status === "failed"
          ? "Automation execution failed. Inspect secure server logs."
          : null,
      completed_at: now.toISOString(),
    })
    .eq("id", runId);
  if (error) {
    throw new Error("Could not finalize the automation run.");
  }
}

async function queueMorningBrief(
  automation: AutomationRow,
  idempotencyKey: string,
  now: Date,
): Promise<Record<string, unknown>> {
  const database = createSupabaseServiceClient();
  const dayRange = getZonedDayRange(now, automation.timezone);
  const [preferenceResult, ownerResult, eventsResult] = await Promise.all([
    database
      .from("assistant_preferences")
      .select("assistant_name, default_meeting_buffer_minutes")
      .eq("organization_id", automation.organization_id)
      .maybeSingle(),
    database
      .from("memberships")
      .select("user_id, profiles!memberships_user_id_fkey(full_name, email)")
      .eq("organization_id", automation.organization_id)
      .eq("role", "customer_owner")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    database
      .from("calendar_events")
      .select(
        "id, title, starts_at, ends_at, location, is_cancelled, calendars!inner(is_selected, can_read)",
      )
      .eq("organization_id", automation.organization_id)
      .eq("calendars.is_selected", true)
      .eq("calendars.can_read", true)
      .eq("is_cancelled", false)
      .gte("starts_at", dayRange.startsAt.toISOString())
      .lt("starts_at", dayRange.endsAt.toISOString())
      .order("starts_at", { ascending: true }),
  ]);
  const preference =
    (preferenceResult.data as unknown as PreferenceRow | null) ?? null;
  const owner = (ownerResult.data as unknown as OwnerRow | null) ?? null;
  if (preferenceResult.error || ownerResult.error || eventsResult.error || !owner) {
    throw new Error("Could not load tenant data for the morning brief.");
  }

  const events =
    (eventsResult.data as unknown as CalendarEventRow[] | null)?.map(
      toCalendarEvent,
    ) ?? [];
  const brief = buildMorningBrief({
    assistantName: preference?.assistant_name ?? "Ava",
    recipientName: getRecipientName(owner),
    timeZone: automation.timezone,
    date: now,
    events,
    conflicts: detectCalendarConflicts(
      events,
      preference?.default_meeting_buffer_minutes ?? 0,
    ),
  });
  const body = [
    brief.summary,
    ...brief.scheduleLines,
    ...brief.recommendations.map(
      (recommendation) => "Recommendation: " + recommendation,
    ),
  ].join("\n");
  const notificationIdempotencyKey =
    "morning-brief:" + automation.id + ":" + idempotencyKey;
  const { error: notificationError } = await database
    .from("notifications")
    .insert({
      organization_id: automation.organization_id,
      recipient_user_id: owner.user_id,
      channel: "web",
      notification_type: "morning_brief",
      subject: brief.title,
      body,
      payload: {
        schedule_lines: brief.scheduleLines,
        recommendations: brief.recommendations,
      },
      status: "queued",
      idempotency_key: notificationIdempotencyKey,
      scheduled_for: now.toISOString(),
    });
  if (notificationError?.code !== "23505" && notificationError) {
    throw new Error("Could not queue the morning brief notification.");
  }

  return {
    notification_channel: "web",
    event_count: events.length,
    recommendation_count: brief.recommendations.length,
  };
}

async function recordAutomationAudit(
  automation: AutomationRow,
  status: "succeeded" | "skipped" | "failed",
  output: Record<string, unknown>,
): Promise<void> {
  const database = createSupabaseServiceClient();
  await database.from("audit_logs").insert({
    organization_id: automation.organization_id,
    actor_type: "system",
    action: "automation." + automation.type,
    tool_name: "automation_runner",
    target_type: "automation",
    target_id: automation.id,
    result: status === "succeeded" ? "succeeded" : status === "skipped" ? "blocked" : "failed",
    metadata: output,
  });
}

/**
 * Executes due tenant automations from a protected job endpoint. Every run is
 * claimed by a unique automation/date idempotency record before it can queue a
 * notification, so concurrent cron deliveries cannot emit duplicates.
 */
export async function runDueAutomations(
  now = new Date(),
): Promise<AutomationRunSummary> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database
    .from("automations")
    .select(
      "id, organization_id, type, name, schedule, timezone, configuration, last_run_at, next_run_at",
    )
    .eq("enabled", true)
    .eq("status", "active")
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(500);
  if (error) {
    throw new Error("Could not read scheduled automations.");
  }

  const summary: AutomationRunSummary = {
    inspected: (data as unknown as AutomationRow[] | null)?.length ?? 0,
    started: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  };
  const entitlements = new EntitlementService(
    new SupabaseServiceEntitlementRepository(),
  );

  for (const automation of (data as unknown as AutomationRow[] | null) ?? []) {
    let duePlan;
    try {
      duePlan = getAutomationDuePlan(
        {
          id: automation.id,
          timeZone: automation.timezone,
          schedule: automation.schedule,
          configuration: automation.configuration,
          lastRunAt: automation.last_run_at,
          nextRunAt: automation.next_run_at,
        },
        now,
      );
    } catch {
      await updateAutomationAfterRun(
        automation,
        new Date(now.getTime() + 60 * 60_000),
        "failed",
        now,
      );
      summary.failed += 1;
      continue;
    }

    if (duePlan.state === "not_due") {
      continue;
    }

    let runId: string | null;
    try {
      runId = await claimAutomationRun(
        automation,
        duePlan.idempotencyKey,
        now,
      );
    } catch {
      summary.failed += 1;
      continue;
    }
    if (!runId) {
      summary.skipped += 1;
      continue;
    }

    summary.started += 1;
    let status: "succeeded" | "skipped" | "failed" =
      duePlan.state === "missed" ? "skipped" : "succeeded";
    let output: Record<string, unknown> =
      duePlan.state === "missed"
        ? { reason: "missed_tenant_local_schedule" }
        : {};

    try {
      if (duePlan.state === "due" && automation.type === "morning_brief") {
        if (
          !(await entitlements.hasFeature(
            automation.organization_id,
            "morning_brief",
          ))
        ) {
          status = "skipped";
          output = { reason: "feature_not_enabled" };
        } else {
          output = await queueMorningBrief(
            automation,
            duePlan.idempotencyKey,
            now,
          );
        }
      } else if (duePlan.state === "due") {
        status = "skipped";
        output = { reason: "unsupported_automation_type" };
      }

      await completeAutomationRun(runId, status, output, now);
      await updateAutomationAfterRun(automation, duePlan.nextRunAt, status, now);
      await recordAutomationAudit(automation, status, output);
      summary[status] += 1;
    } catch {
      try {
        await completeAutomationRun(runId, "failed", {}, now);
        await updateAutomationAfterRun(
          automation,
          duePlan.nextRunAt,
          "failed",
          now,
        );
        await recordAutomationAudit(automation, "failed", {});
      } catch {
        // The original run is still marked running for incident inspection.
      }
      summary.failed += 1;
    }
  }

  return summary;
}
