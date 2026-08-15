import "server-only";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AssistantRuleView {
  id: string;
  kind: string;
  naturalLanguage: string;
  requiresConfirmation: boolean;
  confirmedAt: string | null;
  isActive: boolean;
}

interface AssistantRuleRow {
  id: string;
  kind: string;
  natural_language: string | null;
  requires_confirmation: boolean;
  confirmed_at: string | null;
  is_active: boolean;
}

const demoRules: AssistantRuleView[] = [
  {
    id: "demo-rule-scheduling",
    kind: "scheduling",
    naturalLanguage: "Do not propose meetings before 10 AM unless I explicitly ask.",
    requiresConfirmation: true,
    confirmedAt: "2026-08-11T02:00:00.000Z",
    isActive: true,
  },
  {
    id: "demo-rule-travel",
    kind: "travel",
    naturalLanguage: "Include a 15-minute buffer after cross-city meetings.",
    requiresConfirmation: false,
    confirmedAt: "2026-08-11T02:00:00.000Z",
    isActive: true,
  },
];

export async function getAssistantRules(): Promise<{
  isDemoMode: boolean;
  hasWorkspace: boolean;
  canManage: boolean;
  rules: AssistantRuleView[];
}> {
  if (!isSupabaseConfigured()) {
    return {
      isDemoMode: true,
      hasWorkspace: true,
      canManage: true,
      rules: demoRules,
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return { isDemoMode: false, hasWorkspace: false, canManage: false, rules: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { isDemoMode: false, hasWorkspace: true, canManage: false, rules: [] };
  }

  const { data, error } = await supabase
    .from("assistant_rules")
    .select("id, kind, natural_language, requires_confirmation, confirmed_at, is_active")
    .eq("organization_id", workspace.organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error || !data) {
    return { isDemoMode: false, hasWorkspace: true, canManage: false, rules: [] };
  }

  return {
    isDemoMode: false,
    hasWorkspace: true,
    canManage: canPerformAction(workspace.role, "organization.manage"),
    rules: (data as unknown as AssistantRuleRow[]).flatMap((rule) =>
      rule.natural_language
        ? [
            {
              id: rule.id,
              kind: rule.kind,
              naturalLanguage: rule.natural_language,
              requiresConfirmation: rule.requires_confirmation,
              confirmedAt: rule.confirmed_at,
              isActive: rule.is_active,
            },
          ]
        : [],
    ),
  };
}
