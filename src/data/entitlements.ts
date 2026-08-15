import "server-only";

import type { FeatureKey } from "@/lib/domain/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface CustomerEntitlementRow {
  enabled: boolean;
  expires_at: string | null;
}

interface BillingAccountRow {
  plan_id: string | null;
  status: string;
}

interface PlanEntitlementRow {
  enabled: boolean;
}

/**
 * Reads the effective entitlement with the authenticated tenant session. It is
 * intentionally server-only and accepts an organization id that was resolved
 * from a trusted workspace, never a client-supplied tenant id.
 */
export async function hasWorkspaceFeature(
  organizationId: string,
  feature: FeatureKey,
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return false;
  }

  const [overrideResult, billingResult] = await Promise.all([
    supabase
      .from("customer_entitlements")
      .select("enabled, expires_at")
      .eq("organization_id", organizationId)
      .eq("feature_key", feature)
      .maybeSingle(),
    supabase
      .from("billing_accounts")
      .select("plan_id, status")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  const override =
    (overrideResult.data as unknown as CustomerEntitlementRow | null) ?? null;
  if (
    override &&
    (override.expires_at === null ||
      new Date(override.expires_at).getTime() > Date.now())
  ) {
    return override.enabled;
  }

  const billing =
    (billingResult.data as unknown as BillingAccountRow | null) ?? null;
  if (
    billingResult.error ||
    !billing?.plan_id ||
    !["trial", "active", "past_due"].includes(billing.status)
  ) {
    return false;
  }

  const { data, error } = await supabase
    .from("plan_entitlements")
    .select("enabled")
    .eq("plan_id", billing.plan_id)
    .eq("feature_key", feature)
    .maybeSingle();
  if (error || !data) {
    return false;
  }

  return (data as unknown as PlanEntitlementRow).enabled;
}
