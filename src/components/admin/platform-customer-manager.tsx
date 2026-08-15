"use client";

import { LoaderCircle, Settings2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  removeCustomerEntitlementOverride,
  saveCustomerEntitlementOverride,
  setCustomerPlan,
} from "@/app/(app)/admin/actions";
import type {
  PlatformCustomerView,
  PlatformFeatureView,
  PlatformPlanView,
} from "@/data/platform-admin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface OverrideDraft {
  featureKey: string;
  enabled: boolean;
  limit: string;
  reason: string;
  expiresAt: string;
}

function blankOverride(features: PlatformFeatureView[]): OverrideDraft {
  return {
    featureKey: features[0]?.key ?? "",
    enabled: true,
    limit: "",
    reason: "",
    expiresAt: "",
  };
}

function formatProvider(provider: string): string {
  return provider.replaceAll("_", " ");
}

function formatExpiry(value: string | null): string {
  if (!value) {
    return "No expiry";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid expiry" : date.toISOString().slice(0, 10);
}

export function PlatformCustomerManager({
  customers,
  plans,
  features,
  isDemoMode,
}: {
  customers: PlatformCustomerView[];
  plans: PlatformPlanView[];
  features: PlatformFeatureView[];
  isDemoMode: boolean;
}) {
  const router = useRouter();
  const [selectedCustomer, setSelectedCustomer] = useState<PlatformCustomerView | null>(
    null,
  );
  const [overrideDraft, setOverrideDraft] = useState(() => blankOverride(features));
  const [overrideToRemove, setOverrideToRemove] = useState<{
    organizationId: string;
    featureKey: string;
  } | null>(null);
  const [planSelections, setPlanSelections] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        customers.map((customer) => [customer.id, customer.planCode ?? ""]),
      ),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refreshAfterMutation(status: string) {
    if (status === "saved" || status === "removed") {
      router.refresh();
    }
  }

  function savePlan(customer: PlatformCustomerView) {
    const planCode = planSelections[customer.id];
    if (!planCode) {
      setNotice("Choose an active plan before saving.");
      return;
    }

    startTransition(async () => {
      const result = await setCustomerPlan({ organizationId: customer.id, planCode });
      setNotice(result.message);
      refreshAfterMutation(result.status);
    });
  }

  function beginOverride(customer: PlatformCustomerView) {
    setSelectedCustomer(customer);
    setOverrideDraft(blankOverride(features));
  }

  function saveOverride() {
    if (!selectedCustomer) {
      return;
    }

    const parsedLimit =
      overrideDraft.limit.trim().length === 0 ? null : Number(overrideDraft.limit);
    const expiresAt = overrideDraft.expiresAt
      ? new Date(overrideDraft.expiresAt + "T23:59:59.999Z").toISOString()
      : null;

    startTransition(async () => {
      const result = await saveCustomerEntitlementOverride({
        organizationId: selectedCustomer.id,
        featureKey: overrideDraft.featureKey,
        enabled: overrideDraft.enabled,
        limit: parsedLimit,
        reason: overrideDraft.reason,
        expiresAt,
      });
      setNotice(result.message);
      if (result.status === "saved") {
        setSelectedCustomer(null);
      }
      refreshAfterMutation(result.status);
    });
  }

  function removeOverride() {
    if (!overrideToRemove) {
      return;
    }

    startTransition(async () => {
      const result = await removeCustomerEntitlementOverride(overrideToRemove);
      setNotice(result.message);
      setOverrideToRemove(null);
      refreshAfterMutation(result.status);
    });
  }

  return (
    <>
      <div className="space-y-4">
        {customers.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
              No platform customer records are available yet.
            </CardContent>
          </Card>
        ) : null}
        {customers.map((customer) => (
          <Card className="border-border/80 shadow-none" key={customer.id}>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">{customer.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {customer.slug} · {customer.timezone} · {customer.memberCount} members
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{customer.status}</Badge>
                <Badge variant="secondary">{customer.billingStatus}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/15 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Plan assignment</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Current: {customer.planName}
                  </p>
                </div>
                <select
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                  disabled={isPending || plans.filter((plan) => plan.isActive).length === 0}
                  onChange={(event) =>
                    setPlanSelections((current) => ({
                      ...current,
                      [customer.id]: event.target.value,
                    }))
                  }
                  value={planSelections[customer.id] ?? ""}
                >
                  <option value="">Choose plan</option>
                  {plans
                    .filter((plan) => plan.isActive)
                    .map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                </select>
                <Button
                  disabled={isPending || !planSelections[customer.id]}
                  onClick={() => savePlan(customer)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPending ? <LoaderCircle className="animate-spin" /> : null}
                  Save plan
                </Button>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Customer entitlement overrides</p>
                  <Button
                    disabled={isPending || features.length === 0}
                    onClick={() => beginOverride(customer)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Settings2 data-icon="inline-start" />
                    Add or replace override
                  </Button>
                </div>
                {customer.overrides.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                    No override: effective features come from the selected plan.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {customer.overrides.map((override) => (
                      <div
                        className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5 text-xs"
                        key={override.featureKey}
                      >
                        <span className="font-medium">{override.featureKey}</span>
                        <span className="text-muted-foreground">
                          {override.enabled ? "enabled" : "disabled"}
                          {override.limit === null ? "" : " · limit " + override.limit}
                          {" · " + formatExpiry(override.expiresAt)}
                        </span>
                        <Button
                          disabled={isPending}
                          onClick={() =>
                            setOverrideToRemove({
                              organizationId: customer.id,
                              featureKey: override.featureKey,
                            })
                          }
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 />
                          <span className="sr-only">
                            Remove {override.featureKey} override
                          </span>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Integrations:</span>
                {customer.integrations.length === 0 ? <span>None</span> : null}
                {customer.integrations.map((integration) => (
                  <Badge key={integration.provider} variant="outline">
                    {formatProvider(integration.provider)} · {integration.status}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
          {isDemoMode && !notice
            ? "Development preview: controls validate the workflow but do not change a customer."
            : notice}
        </p>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCustomer(null);
          }
        }}
        open={selectedCustomer !== null}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customer entitlement override</DialogTitle>
            <DialogDescription>
              Overrides take precedence over the selected plan for {selectedCustomer?.name}.
              The change is tenant-scoped and audited.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="override-feature">Feature</Label>
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                id="override-feature"
                onChange={(event) =>
                  setOverrideDraft((current) => ({
                    ...current,
                    featureKey: event.target.value,
                  }))
                }
                value={overrideDraft.featureKey}
              >
                {features.map((feature) => (
                  <option key={feature.key} value={feature.key}>
                    {feature.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={overrideDraft.enabled}
                className="size-4 accent-primary"
                onChange={(event) =>
                  setOverrideDraft((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Enable this feature for the customer
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="override-limit">Optional limit</Label>
                <Input
                  id="override-limit"
                  min={0}
                  onChange={(event) =>
                    setOverrideDraft((current) => ({
                      ...current,
                      limit: event.target.value,
                    }))
                  }
                  placeholder="Unlimited"
                  type="number"
                  value={overrideDraft.limit}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="override-expiry">Optional expiry</Label>
                <Input
                  id="override-expiry"
                  onChange={(event) =>
                    setOverrideDraft((current) => ({
                      ...current,
                      expiresAt: event.target.value,
                    }))
                  }
                  type="date"
                  value={overrideDraft.expiresAt}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="override-reason">Reason (optional)</Label>
              <Textarea
                id="override-reason"
                maxLength={500}
                onChange={(event) =>
                  setOverrideDraft((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                value={overrideDraft.reason}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={() => setSelectedCustomer(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isPending || !overrideDraft.featureKey} onClick={saveOverride} type="button">
              {isPending ? <LoaderCircle className="animate-spin" /> : null}
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setOverrideToRemove(null);
          }
        }}
        open={overrideToRemove !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this customer override?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will fall back to the feature entitlement from its selected plan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep override</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={removeOverride} variant="destructive">
              {isPending ? "Removing…" : "Remove override"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
