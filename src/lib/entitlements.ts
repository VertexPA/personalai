import type {
  CustomerEntitlementOverride,
  EffectiveEntitlement,
  FeatureKey,
  PlanEntitlement,
} from "@/lib/domain/types";

export interface EntitlementRepository {
  getPlanEntitlements(organizationId: string): Promise<PlanEntitlement[]>;
  getCustomerOverrides(
    organizationId: string,
  ): Promise<CustomerEntitlementOverride[]>;
}

const noEntitlement = (feature: FeatureKey): EffectiveEntitlement => ({
  feature,
  enabled: false,
  limit: null,
  configuration: {},
  source: "none",
});

export function resolveEntitlement(
  feature: FeatureKey,
  planEntitlements: PlanEntitlement[],
  customerOverrides: CustomerEntitlementOverride[],
  now = new Date(),
): EffectiveEntitlement {
  const activeOverride = customerOverrides.find(
    (entitlement) =>
      entitlement.feature === feature &&
      (entitlement.expiresAt === null || entitlement.expiresAt > now),
  );

  if (activeOverride) {
    return {
      feature: activeOverride.feature,
      enabled: activeOverride.enabled,
      limit: activeOverride.limit,
      configuration: activeOverride.configuration,
      source: "override",
    };
  }

  const planEntitlement = planEntitlements.find(
    (entitlement) => entitlement.feature === feature,
  );

  if (!planEntitlement) {
    return noEntitlement(feature);
  }

  return {
    ...planEntitlement,
    source: "plan",
  };
}

export class EntitlementService {
  public constructor(private readonly repository: EntitlementRepository) {}

  async getEffectiveEntitlement(
    customerId: string,
    feature: FeatureKey,
  ): Promise<EffectiveEntitlement> {
    const [planEntitlements, customerOverrides] = await Promise.all([
      this.repository.getPlanEntitlements(customerId),
      this.repository.getCustomerOverrides(customerId),
    ]);

    return resolveEntitlement(feature, planEntitlements, customerOverrides);
  }

  async hasFeature(customerId: string, feature: FeatureKey): Promise<boolean> {
    return (await this.getEffectiveEntitlement(customerId, feature)).enabled;
  }

  async getFeatureLimit(
    customerId: string,
    feature: FeatureKey,
  ): Promise<number | null> {
    return (await this.getEffectiveEntitlement(customerId, feature)).limit;
  }
}
