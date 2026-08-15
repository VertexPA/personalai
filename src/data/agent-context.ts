import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export interface AssistantRuntimeContext {
  assistantName: string;
  timezone: string;
  confirmedRules: string[];
  memories: string[];
}

interface PreferenceRow {
  assistant_name: string;
  timezone: string;
}

interface RuleRow {
  natural_language: string | null;
  requires_confirmation: boolean;
  confirmed_at: string | null;
  is_active: boolean;
}

interface MemoryRow {
  owner_user_id: string | null;
  key: string;
  value: unknown;
}

function describeMemory(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["statement", "text", "value", "description"]) {
      if (typeof record[key] === "string") {
        return record[key];
      }
    }
  }
  return fallback;
}

function boundedContext(items: string[], characterBudget = 2_400): string[] {
  const result: string[] = [];
  let remaining = characterBudget;
  for (const item of items) {
    if (remaining <= 0) {
      break;
    }
    const normalized = item.trim().slice(0, Math.min(400, remaining));
    if (normalized.length === 0) {
      continue;
    }
    result.push(normalized);
    remaining -= normalized.length;
  }
  return result;
}

/**
 * Loads only customer-controlled context that a reasoning runtime needs. It
 * intentionally excludes credentials, raw integration payloads, audit logs,
 * and unconfirmed assistant rules.
 */
export async function getAssistantRuntimeContext(
  organizationId: string,
  userId: string | null,
  fallback: { assistantName: string; timezone: string },
): Promise<AssistantRuntimeContext> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ...fallback, confirmedRules: [], memories: [] };
  }

  const [preferenceResult, ruleResult, memoryResult] = await Promise.all([
    supabase
      .from("assistant_preferences")
      .select("assistant_name, timezone")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("assistant_rules")
      .select("natural_language, requires_confirmation, confirmed_at, is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("assistant_memories")
      .select("owner_user_id, key, value")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  const preference =
    (preferenceResult.data as unknown as PreferenceRow | null) ?? null;
  const rules = (ruleResult.data as unknown as RuleRow[] | null) ?? [];
  const memories = (memoryResult.data as unknown as MemoryRow[] | null) ?? [];
  return {
    assistantName: preference?.assistant_name ?? fallback.assistantName,
    timezone: preference?.timezone ?? fallback.timezone,
    confirmedRules: boundedContext(
      rules
        .filter(
          (rule) =>
            Boolean(rule.natural_language) &&
            (!rule.requires_confirmation || rule.confirmed_at !== null),
        )
        .map((rule) => rule.natural_language as string),
    ),
    memories: boundedContext(
      memories
        .filter(
          (memory) => memory.owner_user_id === null || memory.owner_user_id === userId,
        )
        .map((memory) => describeMemory(memory.value, memory.key))
        .filter((memory) => memory.length > 0),
    ),
  };
}

/**
 * Same bounded, credential-free context for the protected inbound agent worker.
 * It uses the service client only after the queue-claim RPC has already scoped
 * the run to one organization; it still exposes only confirmed rules and the
 * linked user's shared or owned memory.
 */
export async function getAssistantRuntimeContextForService(
  organizationId: string,
  userId: string | null,
  fallback: { assistantName: string; timezone: string },
): Promise<AssistantRuntimeContext> {
  const supabase = createSupabaseServiceClient();
  const [preferenceResult, ruleResult, memoryResult] = await Promise.all([
    supabase
      .from("assistant_preferences")
      .select("assistant_name, timezone")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("assistant_rules")
      .select("natural_language, requires_confirmation, confirmed_at, is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("assistant_memories")
      .select("owner_user_id, key, value")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  const preference =
    (preferenceResult.data as unknown as PreferenceRow | null) ?? null;
  const rules = (ruleResult.data as unknown as RuleRow[] | null) ?? [];
  const memories = (memoryResult.data as unknown as MemoryRow[] | null) ?? [];
  return {
    assistantName: preference?.assistant_name ?? fallback.assistantName,
    timezone: preference?.timezone ?? fallback.timezone,
    confirmedRules: boundedContext(
      rules
        .filter(
          (rule) =>
            Boolean(rule.natural_language) &&
            (!rule.requires_confirmation || rule.confirmed_at !== null),
        )
        .map((rule) => rule.natural_language as string),
    ),
    memories: boundedContext(
      memories
        .filter(
          (memory) => memory.owner_user_id === null || memory.owner_user_id === userId,
        )
        .map((memory) => describeMemory(memory.value, memory.key))
        .filter((memory) => memory.length > 0),
    ),
  };
}
