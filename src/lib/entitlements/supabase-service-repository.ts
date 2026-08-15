import "server-only";

import type {
  CustomerEntitlementOverride,
  FeatureKey,
  PlanEntitlement,
} from "@/lib/domain/types";
import type { EntitlementRepository } from "@/lib/entitlements";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface BillingAccountRow {
  plan_id: string | null;
  status: string;
}

interface PlanEntitlementRow {
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
  configuration: unknown;
}

interface CustomerEntitlementRow extends PlanEntitlementRow {
  expires_at: string | null;
}

function asFeatureKey(value: string): FeatureKey {
  return value as FeatureKey;
}

function asConfiguration(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isBillableStatus(status: string): boolean {
  return status === "trial" || status === "active" || status === "past_due";
}

/**
 * Trusted background work has no browser session, so it resolves entitlements
 * with the service-role client after its own authenticated scheduler boundary.
 * The same plan/override precedence remains centralized in EntitlementService.
 */
export class SupabaseServiceEntitlementRepository
  implements EntitlementRepository
{
  async getPlanEntitlements(
    organizationId: string,
  ): Promise<PlanEntitlement[]> {
    const database = createSupabaseServiceClient();
    const { data: accountData, error: accountError } = await database
      .from("billing_accounts")
      .select("plan_id, status")
      .eq("organization_id", organizationId)
      .maybeSingle();
    const account =
      (accountData as unknown as BillingAccountRow | null) ?? null;
    if (accountError || !account?.plan_id || !isBillableStatus(account.status)) {
      return [];
    }

    const { data, error } = await database
      .from("plan_entitlements")
      .select("feature_key, enabled, limit_value, configuration")
      .eq("plan_id", account.plan_id);
    if (error || !data) {
      return [];
    }

    return (data as unknown as PlanEntitlementRow[]).map((entitlement) => ({
      feature: asFeatureKey(entitlement.feature_key),
      enabled: entitlement.enabled,
      limit: entitlement.limit_value,
      configuration: asConfiguration(entitlement.configuration),
    }));
  }

  async getCustomerOverrides(
    organizationId: string,
  ): Promise<CustomerEntitlementOverride[]> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database
      .from("customer_entitlements")
      .select(
        "feature_key, enabled, limit_value, configuration, expires_at",
      )
      .eq("organization_id", organizationId);
    if (error || !data) {
      return [];
    }

    return (data as unknown as CustomerEntitlementRow[]).map(
      (entitlement) => ({
        feature: asFeatureKey(entitlement.feature_key),
        enabled: entitlement.enabled,
        limit: entitlement.limit_value,
        configuration: asConfiguration(entitlement.configuration),
        expiresAt: entitlement.expires_at
          ? new Date(entitlement.expires_at)
          : null,
      }),
    );
  }
}
