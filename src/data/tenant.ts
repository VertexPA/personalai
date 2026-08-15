import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import type { MembershipRole } from "@/lib/domain/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const activeWorkspaceCookieName = "ava_active_workspace";

export interface TenantWorkspace {
  organizationId: string;
  organizationName: string;
  workspaceSlug: string;
  timezone: string;
  role: MembershipRole;
  userId: string;
  userName: string;
}

export interface TenantWorkspaceOption {
  organizationId: string;
  organizationName: string;
  workspaceSlug: string;
  timezone: string;
  role: MembershipRole;
}

interface MembershipWorkspaceRow {
  organization_id: string;
  role: string;
  organizations: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  } | null;
}

function isMembershipRole(value: string): value is MembershipRole {
  return (
    value === "customer_owner" ||
    value === "customer_admin" ||
    value === "customer_member" ||
    value === "assistant_user"
  );
}

function getUserName(metadata: unknown, email: string | null | undefined): string {
  if (typeof metadata === "object" && metadata !== null) {
    const fullName = (metadata as Record<string, unknown>).full_name;
    if (typeof fullName === "string" && fullName.trim().length > 0) {
      return fullName.trim();
    }
  }

  return email?.split("@")[0] ?? "there";
}

interface AuthenticatedTenantWorkspaces {
  userId: string;
  userName: string;
  workspaces: TenantWorkspaceOption[];
}

const getAuthenticatedTenantWorkspaces = cache(
  async (): Promise<AuthenticatedTenantWorkspaces | null> => {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return null;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return null;
    }

    const { data, error } = await supabase
      .from("memberships")
      .select(
        "organization_id, role, organizations!inner(id, name, slug, timezone)",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error || !data) {
      return null;
    }

    const workspaces: TenantWorkspaceOption[] = [];
    for (const membership of data as unknown as MembershipWorkspaceRow[]) {
      if (!membership.organizations || !isMembershipRole(membership.role)) {
        continue;
      }

      workspaces.push({
        organizationId: membership.organizations.id,
        organizationName: membership.organizations.name,
        workspaceSlug: membership.organizations.slug,
        timezone: membership.organizations.timezone,
        role: membership.role,
      });
    }

    return {
      userId: user.id,
      userName: getUserName(user.user_metadata, user.email),
      workspaces,
    };
  },
);

export const getTenantWorkspaceOptions = cache(
  async (): Promise<TenantWorkspaceOption[]> =>
    (await getAuthenticatedTenantWorkspaces())?.workspaces ?? [],
);

export const getActiveTenantWorkspace = cache(
  async (): Promise<TenantWorkspace | null> => {
    const authenticatedWorkspaces = await getAuthenticatedTenantWorkspaces();
    if (!authenticatedWorkspaces?.workspaces.length) {
      return null;
    }

    const cookieStore = await cookies();
    const requestedWorkspaceId = cookieStore.get(activeWorkspaceCookieName)?.value;
    const workspace =
      authenticatedWorkspaces.workspaces.find(
        (candidate) => candidate.organizationId === requestedWorkspaceId,
      ) ?? authenticatedWorkspaces.workspaces[0];
    if (!workspace) {
      return null;
    }

    return {
      ...workspace,
      userId: authenticatedWorkspaces.userId,
      userName: authenticatedWorkspaces.userName,
    };
  },
);

export const isCurrentUserPlatformAdmin = cache(async (): Promise<boolean> => {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return false;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return false;
  }

  const { data, error } = await supabase
    .from("platform_role_assignments")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "platform_admin")
    .limit(1)
    .maybeSingle();

  return !error && data !== null;
});
