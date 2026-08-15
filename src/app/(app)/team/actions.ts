"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasWorkspaceFeature } from "@/data/entitlements";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { serverEnv } from "@/lib/env";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["customer_admin", "customer_member", "assistant_user"]),
});

interface ExistingProfileRow {
  id: string;
}

export type TeamInviteResult =
  | { status: "invited" | "added" | "demo"; message: string }
  | { status: "error"; message: string };

function getInviteRedirectUrl(): string {
  return new URL(
    "/auth/callback?next=/dashboard",
    serverEnv.APP_URL ?? "http://localhost:3000",
  ).toString();
}

/**
 * Trusted server action for tenant admins. Service-role access exists only
 * after the active session and entitlement checks; the browser gets neither an
 * Auth Admin capability nor direct membership table writes.
 */
export async function inviteTeamMember(input: unknown): Promise<TeamInviteResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invite details are invalid.",
    };
  }
  if (!isSupabaseConfigured()) {
    return {
      status: "demo",
      message: "Development preview: invitations are not sent until Supabase is configured.",
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace || !canPerformAction(workspace.role, "team.manage")) {
    return {
      status: "error",
      message: "Only a workspace owner or admin can invite team members.",
    };
  }
  if (
    parsed.data.role === "customer_admin" &&
    workspace.role !== "customer_owner"
  ) {
    return {
      status: "error",
      message: "Only the workspace owner can invite another admin.",
    };
  }
  if (!(await hasWorkspaceFeature(workspace.organizationId, "team_users"))) {
    return {
      status: "error",
      message: "Team members are not enabled for this workspace plan.",
    };
  }
  if (!serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      status: "error",
      message: "The secure invitation service is not configured.",
    };
  }

  const service = createSupabaseServiceClient();
  const { data: existingProfileData, error: existingProfileError } = await service
    .from("profiles")
    .select("id")
    .eq("email", parsed.data.email)
    .maybeSingle();
  if (existingProfileError) {
    return { status: "error", message: "We could not look up this user securely." };
  }
  const existingProfile =
    (existingProfileData as unknown as ExistingProfileRow | null) ?? null;
  if (existingProfile?.id === workspace.userId) {
    return {
      status: "error",
      message: "Your own workspace role cannot be changed from the invite form.",
    };
  }

  let targetUserId = existingProfile?.id ?? null;
  let outcome: "invited" | "added" = "added";
  if (!targetUserId) {
    const { data, error } = await service.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        data: parsed.data.fullName ? { full_name: parsed.data.fullName } : {},
        redirectTo: getInviteRedirectUrl(),
      },
    );
    if (error || !data.user) {
      return {
        status: "error",
        message: "We could not send that invitation. Confirm the email address and try again.",
      };
    }
    targetUserId = data.user.id;
    outcome = "invited";
  }

  const { error: membershipError } = await service.from("memberships").upsert(
    {
      organization_id: workspace.organizationId,
      user_id: targetUserId,
      role: parsed.data.role,
      is_active: true,
      invited_by: workspace.userId,
      joined_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" },
  );
  if (membershipError) {
    return {
      status: "error",
      message: "The invitation was created but membership could not be saved. Review the secure audit log before retrying.",
    };
  }

  await service.from("audit_logs").insert({
    organization_id: workspace.organizationId,
    actor_type: "user",
    actor_user_id: workspace.userId,
    action: outcome === "invited" ? "team.member.invited" : "team.member.added",
    tool_name: "team_management",
    target_type: "membership",
    target_id: targetUserId,
    result: "succeeded",
    metadata: { role: parsed.data.role },
  });

  revalidatePath("/team");
  return {
    status: outcome,
    message:
      outcome === "invited"
        ? "Invitation sent. The member can finish account setup from the email link."
        : "Existing user added to this workspace with the selected role.",
  };
}
