import "server-only";

import { hasWorkspaceFeature } from "@/data/entitlements";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TeamMemberView {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

interface MembershipRow {
  user_id: string;
  role: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

const demoMembers: TeamMemberView[] = [
  {
    id: "demo-owner",
    name: "John Tan",
    email: "john@example.com",
    role: "customer_owner",
  },
  {
    id: "demo-admin",
    name: "Amelia Lim",
    email: "amelia@example.com",
    role: "customer_admin",
  },
  {
    id: "demo-assistant",
    name: "Ava Assistant",
    email: "assistant@ava.local",
    role: "assistant_user",
  },
];

export async function getTeamMembers(): Promise<{
  isDemoMode: boolean;
  hasWorkspace: boolean;
  canManage: boolean;
  canAssignAdmin: boolean;
  hasTeamFeature: boolean;
  members: TeamMemberView[];
}> {
  if (!isSupabaseConfigured()) {
    return {
      isDemoMode: true,
      hasWorkspace: true,
      canManage: true,
      canAssignAdmin: true,
      hasTeamFeature: true,
      members: demoMembers,
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return {
      isDemoMode: false,
      hasWorkspace: false,
      canManage: false,
      canAssignAdmin: false,
      hasTeamFeature: false,
      members: [],
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      isDemoMode: false,
      hasWorkspace: true,
      canManage: false,
      canAssignAdmin: false,
      hasTeamFeature: false,
      members: [],
    };
  }

  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profiles!memberships_user_id_fkey(full_name, email)")
    .eq("organization_id", workspace.organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return {
      isDemoMode: false,
      hasWorkspace: true,
      canManage: false,
      canAssignAdmin: false,
      hasTeamFeature: false,
      members: [],
    };
  }

  const canManage = canPerformAction(workspace.role, "team.manage");
  const hasTeamFeature = await hasWorkspaceFeature(
    workspace.organizationId,
    "team_users",
  );

  return {
    isDemoMode: false,
    hasWorkspace: true,
    canManage,
    canAssignAdmin: workspace.role === "customer_owner",
    hasTeamFeature,
    members: (data as unknown as MembershipRow[]).map((member) => ({
      id: member.user_id,
      name: member.profiles?.full_name ?? member.profiles?.email ?? "Unnamed user",
      email: member.profiles?.email ?? null,
      role: member.role,
    })),
  };
}
