import "server-only";

import { isCurrentUserPlatformAdmin } from "@/data/tenant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface PlatformPlanView {
  code: string;
  name: string;
  isActive: boolean;
}

export interface PlatformFeatureView {
  key: string;
  name: string;
}

export interface PlatformEntitlementOverrideView {
  featureKey: string;
  enabled: boolean;
  limit: number | null;
  reason: string | null;
  expiresAt: string | null;
}

export interface PlatformCustomerView {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  planCode: string | null;
  planName: string;
  billingStatus: string;
  memberCount: number;
  integrations: Array<{ provider: string; status: string }>;
  overrides: PlatformEntitlementOverrideView[];
}

export interface PlatformHealthView {
  component: string;
  status: string;
  message: string | null;
  checkedAt: string;
}

export interface PlatformAdminOverview {
  isDemoMode: boolean;
  serviceAvailable: boolean;
  customers: PlatformCustomerView[];
  plans: PlatformPlanView[];
  features: PlatformFeatureView[];
  health: PlatformHealthView[];
  totalUsers: number;
  estimatedCostMinor: number;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
}

interface BillingRow {
  organization_id: string;
  status: string;
  plans: { code: string; name: string } | null;
}

interface MembershipRow {
  organization_id: string;
}

interface IntegrationRow {
  organization_id: string;
  provider: string;
  status: string;
}

interface OverrideRow {
  organization_id: string;
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
  reason: string | null;
  expires_at: string | null;
}

interface PlanRow {
  code: string;
  name: string;
  is_active: boolean;
}

interface FeatureRow {
  key: string;
  name: string;
}

interface HealthRow {
  component: string;
  status: string;
  message: string | null;
  checked_at: string;
}

interface UsageRow {
  estimated_cost_minor: number | null;
}

const demoPlans: PlatformPlanView[] = [
  { code: "personal", name: "Personal", isActive: true },
  { code: "executive", name: "Executive", isActive: true },
  { code: "business", name: "Business", isActive: true },
];

const demoFeatures: PlatformFeatureView[] = [
  { key: "calendar", name: "Calendar" },
  { key: "gmail", name: "Gmail" },
  { key: "slack", name: "Slack" },
  { key: "multi_calendar", name: "Multi-calendar" },
];

const demoCustomers: PlatformCustomerView[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Tan Executive Office",
    slug: "tan-executive-office",
    status: "active",
    timezone: "Asia/Kuala_Lumpur",
    planCode: "executive",
    planName: "Executive",
    billingStatus: "active",
    memberCount: 3,
    integrations: [
      { provider: "google_calendar", status: "connected" },
      { provider: "slack", status: "not_connected" },
    ],
    overrides: [
      {
        featureKey: "slack",
        enabled: true,
        limit: null,
        reason: "Demonstration add-on",
        expiresAt: null,
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Acme Ventures",
    slug: "acme-ventures",
    status: "trial",
    timezone: "Asia/Singapore",
    planCode: "business",
    planName: "Business",
    billingStatus: "trial",
    memberCount: 3,
    integrations: [{ provider: "telegram", status: "connected" }],
    overrides: [],
  },
];

function emptyOverview(): PlatformAdminOverview {
  return {
    isDemoMode: false,
    serviceAvailable: false,
    customers: [],
    plans: [],
    features: [],
    health: [],
    totalUsers: 0,
    estimatedCostMinor: 0,
  };
}

/**
 * The authenticated platform-role check happens before the service client is
 * created. The service client is then used solely for platform-wide reporting,
 * avoiding accidental dependence on tenant-scoped RLS joins for this view.
 */
export async function getPlatformAdminOverview(): Promise<PlatformAdminOverview> {
  if (!isSupabaseConfigured()) {
    return {
      isDemoMode: true,
      serviceAvailable: true,
      customers: demoCustomers,
      plans: demoPlans,
      features: demoFeatures,
      health: [
        {
          component: "database",
          status: "healthy",
          message: "Development demonstration",
          checkedAt: "2026-08-12T00:00:00.000Z",
        },
      ],
      totalUsers: 6,
      estimatedCostMinor: 0,
    };
  }

  if (!(await isCurrentUserPlatformAdmin())) {
    return emptyOverview();
  }

  let database;
  try {
    database = createSupabaseServiceClient();
  } catch {
    return emptyOverview();
  }

  const [
    organizationsResult,
    billingResult,
    membershipsResult,
    integrationsResult,
    overridesResult,
    plansResult,
    featuresResult,
    healthResult,
    usageResult,
  ] = await Promise.all([
    database
      .from("organizations")
      .select("id, name, slug, status, timezone")
      .order("created_at", { ascending: false })
      .limit(500),
    database
      .from("billing_accounts")
      .select("organization_id, status, plans(code, name)")
      .limit(500),
    database.from("memberships").select("organization_id").limit(5_000),
    database
      .from("integrations")
      .select("organization_id, provider, status")
      .limit(5_000),
    database
      .from("customer_entitlements")
      .select("organization_id, feature_key, enabled, limit_value, reason, expires_at")
      .limit(5_000),
    database.from("plans").select("code, name, is_active").order("price_minor"),
    database.from("features").select("key, name").eq("is_active", true).order("name"),
    database
      .from("system_health_checks")
      .select("component, status, message, checked_at")
      .order("checked_at", { ascending: false })
      .limit(20),
    database.from("usage_records").select("estimated_cost_minor").limit(5_000),
  ]);

  if (
    organizationsResult.error ||
    billingResult.error ||
    membershipsResult.error ||
    integrationsResult.error ||
    overridesResult.error ||
    plansResult.error ||
    featuresResult.error ||
    healthResult.error ||
    usageResult.error
  ) {
    return emptyOverview();
  }

  const billingByOrganization = new Map(
    ((billingResult.data ?? []) as unknown as BillingRow[]).map((billing) => [
      billing.organization_id,
      billing,
    ]),
  );
  const memberCounts = new Map<string, number>();
  for (const membership of (membershipsResult.data ?? []) as unknown as MembershipRow[]) {
    memberCounts.set(
      membership.organization_id,
      (memberCounts.get(membership.organization_id) ?? 0) + 1,
    );
  }
  const integrationsByOrganization = new Map<
    string,
    Array<{ provider: string; status: string }>
  >();
  for (const integration of (integrationsResult.data ?? []) as unknown as IntegrationRow[]) {
    const current = integrationsByOrganization.get(integration.organization_id) ?? [];
    current.push({ provider: integration.provider, status: integration.status });
    integrationsByOrganization.set(integration.organization_id, current);
  }
  const overridesByOrganization = new Map<
    string,
    PlatformEntitlementOverrideView[]
  >();
  for (const override of (overridesResult.data ?? []) as unknown as OverrideRow[]) {
    const current = overridesByOrganization.get(override.organization_id) ?? [];
    current.push({
      featureKey: override.feature_key,
      enabled: override.enabled,
      limit: override.limit_value,
      reason: override.reason,
      expiresAt: override.expires_at,
    });
    overridesByOrganization.set(override.organization_id, current);
  }

  return {
    isDemoMode: false,
    serviceAvailable: true,
    customers: ((organizationsResult.data ?? []) as unknown as OrganizationRow[]).map(
      (organization) => {
        const billing = billingByOrganization.get(organization.id);
        return {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          timezone: organization.timezone,
          planCode: billing?.plans?.code ?? null,
          planName: billing?.plans?.name ?? "No plan assigned",
          billingStatus: billing?.status ?? "unconfigured",
          memberCount: memberCounts.get(organization.id) ?? 0,
          integrations: integrationsByOrganization.get(organization.id) ?? [],
          overrides: overridesByOrganization.get(organization.id) ?? [],
        };
      },
    ),
    plans: ((plansResult.data ?? []) as unknown as PlanRow[]).map((plan) => ({
      code: plan.code,
      name: plan.name,
      isActive: plan.is_active,
    })),
    features: ((featuresResult.data ?? []) as unknown as FeatureRow[]).map(
      (feature) => ({ key: feature.key, name: feature.name }),
    ),
    health: ((healthResult.data ?? []) as unknown as HealthRow[]).map((health) => ({
      component: health.component,
      status: health.status,
      message: health.message,
      checkedAt: health.checked_at,
    })),
    totalUsers: (membershipsResult.data ?? []).length,
    estimatedCostMinor: ((usageResult.data ?? []) as unknown as UsageRow[]).reduce(
      (total, usage) => total + (usage.estimated_cost_minor ?? 0),
      0,
    ),
  };
}
