import { Activity, Building2, ShieldCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";

import { PlatformCustomerManager } from "@/components/admin/platform-customer-manager";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getPlatformAdminOverview } from "@/data/platform-admin";
import { isCurrentUserPlatformAdmin } from "@/data/tenant";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function AdminPage() {
  const isDemoMode = !isSupabaseConfigured();
  if (!isDemoMode && !(await isCurrentUserPlatformAdmin())) {
    redirect("/dashboard");
  }
  const overview = await getPlatformAdminOverview();
  const latestHealth = overview.health[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDemoMode ? "Clearly labelled platform demo" : "Platform-admin-only view"}
        title="SaaS operations"
        description={
          isDemoMode
            ? "This demonstration view maps to platform-admin policies. In production, normal customer users cannot access platform health, customers, or platform-wide cost data."
            : "This view is server-gated to platform administrators. Reporting uses a service-only query only after the authenticated platform-role check succeeds."
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail={isDemoMode ? "Across all customers" : "Across all tenant workspaces"}
          icon={Building2}
          label="Customers"
          value={String(overview.customers.length)}
        />
        <MetricCard
          detail={isDemoMode ? "Active or trial workspaces" : "Tenant membership records"}
          icon={UsersRound}
          label="Users"
          value={String(overview.totalUsers)}
        />
        <MetricCard
          detail={latestHealth?.message ?? "No health check recorded"}
          icon={Activity}
          label="System health"
          value={latestHealth?.status ?? (overview.serviceAvailable ? "Ready" : "Unavailable")}
        />
        <MetricCard
          detail={
            "Tracked cost: RM " + (overview.estimatedCostMinor / 100).toFixed(2)
          }
          icon={ShieldCheck}
          label="Controlled access"
          value="Audited"
        />
      </section>

      {!overview.serviceAvailable && !overview.isDemoMode ? (
        <Card className="border-destructive/30 shadow-none">
          <CardContent className="p-5 text-sm leading-6 text-muted-foreground">
            Platform reporting is unavailable because the server-side Supabase
            credentials are not configured. Customer data is intentionally not
            substituted with demonstration tenants in a live deployment.
          </CardContent>
        </Card>
      ) : (
        <PlatformCustomerManager
          customers={overview.customers}
          features={overview.features}
          isDemoMode={overview.isDemoMode}
          plans={overview.plans}
        />
      )}
    </div>
  );
}
