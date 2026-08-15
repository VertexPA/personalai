import "server-only";

import { demoUsage } from "@/lib/demo/data";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface UsageMetricView {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
}

interface UsageRow {
  metric: string;
  quantity: number | string;
  unit: string;
}

function asNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

export async function getUsageMetrics(): Promise<{
  isDemoMode: boolean;
  hasWorkspace: boolean;
  metrics: UsageMetricView[];
}> {
  if (!isSupabaseConfigured()) {
    return { isDemoMode: true, hasWorkspace: true, metrics: demoUsage };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return { isDemoMode: false, hasWorkspace: false, metrics: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { isDemoMode: false, hasWorkspace: true, metrics: [] };
  }

  const { data, error } = await supabase
    .from("usage_records")
    .select("metric, quantity, unit")
    .eq("organization_id", workspace.organizationId)
    .order("occurred_at", { ascending: false })
    .limit(1_000);

  if (error || !data) {
    return { isDemoMode: false, hasWorkspace: true, metrics: [] };
  }

  const grouped = new Map<string, UsageMetricView>();
  for (const record of data as unknown as UsageRow[]) {
    const existing = grouped.get(record.metric);
    const quantity = asNumber(record.quantity);
    grouped.set(record.metric, {
      label: record.metric.replaceAll("_", " "),
      used: (existing?.used ?? 0) + (Number.isFinite(quantity) ? quantity : 0),
      limit: null,
      unit: record.unit,
    });
  }

  return {
    isDemoMode: false,
    hasWorkspace: true,
    metrics: [...grouped.values()],
  };
}
