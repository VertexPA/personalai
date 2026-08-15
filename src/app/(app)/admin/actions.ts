"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isCurrentUserPlatformAdmin } from "@/data/tenant";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const customerPlanSchema = z.object({
  organizationId: z.string().uuid(),
  planCode: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
});

const entitlementOverrideSchema = z.object({
  organizationId: z.string().uuid(),
  featureKey: z.string().trim().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(100),
  enabled: z.boolean(),
  limit: z.number().int().min(0).max(100_000).nullable(),
  reason: z.string().trim().max(500),
  expiresAt: z.string().datetime().nullable(),
});

const removeOverrideSchema = z.object({
  organizationId: z.string().uuid(),
  featureKey: z.string().trim().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(100),
});

export type PlatformAdminActionResult =
  | { status: "saved" | "removed" | "demo"; message: string }
  | { status: "error"; message: string };

function messageForDatabaseError(error: { code?: string }): string {
  if (error.code === "42501") {
    return "Platform administrator access is required.";
  }

  if (error.code === "22023") {
    return "The platform operation is invalid. Check the submitted values.";
  }

  if (error.code === "P0002") {
    return "The requested customer, plan, feature, or override no longer exists.";
  }

  return "The platform operation could not be completed. Please try again.";
}

async function getPlatformAdminClient(): Promise<
  | { client: Awaited<ReturnType<typeof createSupabaseServerClient>>; message: null }
  | { client: null; message: string }
> {
  if (!isSupabaseConfigured()) {
    return {
      client: null,
      message:
        "Development preview: platform changes are not persisted until Supabase is configured.",
    };
  }

  if (!(await isCurrentUserPlatformAdmin())) {
    return { client: null, message: "Platform administrator access is required." };
  }

  const client = await createSupabaseServerClient();
  if (!client) {
    return { client: null, message: "The secure database connection is unavailable." };
  }

  return { client, message: null };
}

export async function setCustomerPlan(
  input: unknown,
): Promise<PlatformAdminActionResult> {
  const parsed = customerPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "The customer plan selection is invalid." };
  }

  const authorization = await getPlatformAdminClient();
  if (!authorization.client) {
    return {
      status: isSupabaseConfigured() ? "error" : "demo",
      message: authorization.message ?? "Platform administrator access is required.",
    };
  }

  const { error } = await authorization.client.rpc("platform_set_customer_plan", {
    p_organization_id: parsed.data.organizationId,
    p_plan_code: parsed.data.planCode,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/admin");
  return {
    status: "saved",
    message: "Customer plan was updated and recorded in that tenant’s audit log.",
  };
}

export async function saveCustomerEntitlementOverride(
  input: unknown,
): Promise<PlatformAdminActionResult> {
  const parsed = entitlementOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "The entitlement override is invalid.",
    };
  }

  if (
    parsed.data.expiresAt &&
    new Date(parsed.data.expiresAt).getTime() <= Date.now()
  ) {
    return { status: "error", message: "The entitlement expiry must be in the future." };
  }

  const authorization = await getPlatformAdminClient();
  if (!authorization.client) {
    return {
      status: isSupabaseConfigured() ? "error" : "demo",
      message: authorization.message ?? "Platform administrator access is required.",
    };
  }

  const { error } = await authorization.client.rpc(
    "platform_save_customer_entitlement_override",
    {
      p_organization_id: parsed.data.organizationId,
      p_feature_key: parsed.data.featureKey,
      p_enabled: parsed.data.enabled,
      p_limit_value: parsed.data.limit,
      p_reason: parsed.data.reason || null,
      p_expires_at: parsed.data.expiresAt,
    },
  );
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/admin");
  return {
    status: "saved",
    message: "Customer entitlement override was saved and recorded in the audit log.",
  };
}

export async function removeCustomerEntitlementOverride(
  input: unknown,
): Promise<PlatformAdminActionResult> {
  const parsed = removeOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "The entitlement override reference is invalid." };
  }

  const authorization = await getPlatformAdminClient();
  if (!authorization.client) {
    return {
      status: isSupabaseConfigured() ? "error" : "demo",
      message: authorization.message ?? "Platform administrator access is required.",
    };
  }

  const { error } = await authorization.client.rpc(
    "platform_remove_customer_entitlement_override",
    {
      p_organization_id: parsed.data.organizationId,
      p_feature_key: parsed.data.featureKey,
    },
  );
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/admin");
  return {
    status: "removed",
    message: "The customer override was removed; the plan entitlement now applies again.",
  };
}
