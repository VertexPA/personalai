"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ruleSchema = z.object({
  ruleId: z.string().uuid().nullable().optional(),
  kind: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,63}$/),
  naturalLanguage: z.string().trim().min(1).max(2_000),
  requiresConfirmation: z.boolean(),
  isActive: z.boolean(),
});
const ruleIdSchema = z.object({ ruleId: z.string().uuid() });

export type AssistantRuleInput = z.infer<typeof ruleSchema>;
export type AssistantRuleActionResult =
  | { status: "saved" | "confirmed" | "deleted" | "demo"; message: string }
  | { status: "error"; message: string };

function messageForDatabaseError(error: { code?: string }): string {
  if (error.code === "42501") {
    return "Only a workspace owner or admin can manage assistant rules.";
  }
  if (error.code === "22023") {
    return "Check the rule details and try again.";
  }
  if (error.code === "P0002") {
    return "That assistant rule is no longer available. Refresh to see the latest rules.";
  }
  return "We could not update this assistant rule. Please try again.";
}

async function getAuthorizedRuleWorkspace() {
  if (!isSupabaseConfigured()) {
    return {
      workspace: null,
      isDemo: true,
      message: "Development preview: assistant rules are not persisted until Supabase is configured.",
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace || !canPerformAction(workspace.role, "organization.manage")) {
    return {
      workspace: null,
      isDemo: false,
      message: "Only a workspace owner or admin can manage assistant rules.",
    };
  }

  return { workspace, isDemo: false, message: null };
}

export async function saveAssistantRule(
  input: unknown,
): Promise<AssistantRuleActionResult> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Assistant rule is invalid.",
    };
  }
  const authorization = await getAuthorizedRuleWorkspace();
  if (!authorization.workspace) {
    return {
      status: authorization.isDemo ? "demo" : "error",
      message: authorization.message ?? "You cannot manage assistant rules.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "error", message: "The secure database connection is unavailable." };
  }
  const { error } = await supabase.rpc("save_assistant_rule", {
    p_organization_id: authorization.workspace.organizationId,
    p_rule_id: parsed.data.ruleId ?? null,
    p_kind: parsed.data.kind,
    p_natural_language: parsed.data.naturalLanguage,
    p_structured_rule: {},
    p_requires_confirmation: parsed.data.requiresConfirmation,
    p_is_active: parsed.data.isActive,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/settings");
  return {
    status: "saved",
    message: parsed.data.requiresConfirmation
      ? "Rule saved. Confirm it before Ava applies it."
      : "Assistant rule saved and recorded in the audit trail.",
  };
}

export async function confirmAssistantRule(
  input: unknown,
): Promise<AssistantRuleActionResult> {
  const parsed = ruleIdSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Assistant rule reference is invalid." };
  }
  const authorization = await getAuthorizedRuleWorkspace();
  if (!authorization.workspace) {
    return {
      status: authorization.isDemo ? "demo" : "error",
      message: authorization.message ?? "You cannot confirm assistant rules.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "error", message: "The secure database connection is unavailable." };
  }
  const { error } = await supabase.rpc("confirm_assistant_rule", {
    p_rule_id: parsed.data.ruleId,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/settings");
  return {
    status: "confirmed",
    message: "Rule confirmed. Ava can now apply it in this workspace.",
  };
}

export async function deleteAssistantRule(
  input: unknown,
): Promise<AssistantRuleActionResult> {
  const parsed = ruleIdSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Assistant rule reference is invalid." };
  }
  const authorization = await getAuthorizedRuleWorkspace();
  if (!authorization.workspace) {
    return {
      status: authorization.isDemo ? "demo" : "error",
      message: authorization.message ?? "You cannot delete assistant rules.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "error", message: "The secure database connection is unavailable." };
  }
  const { error } = await supabase.rpc("delete_assistant_rule", {
    p_rule_id: parsed.data.ruleId,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/settings");
  return { status: "deleted", message: "Assistant rule deleted and recorded in the audit trail." };
}
