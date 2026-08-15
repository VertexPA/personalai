"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  activeWorkspaceCookieName,
  getTenantWorkspaceOptions,
} from "@/data/tenant";
import { isProduction } from "@/lib/env";

const workspaceSelectionSchema = z.string().uuid();

export type WorkspaceSelectionResult =
  | { status: "switched"; message: string }
  | { status: "error"; message: string };

/**
 * The organization id is treated as untrusted input. The action confirms that
 * it is in the signed-in user's current RLS-filtered membership list before it
 * is placed in the active-workspace cookie.
 */
export async function switchActiveWorkspace(
  organizationId: string,
): Promise<WorkspaceSelectionResult> {
  const parsedOrganizationId = workspaceSelectionSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return { status: "error", message: "The selected workspace is invalid." };
  }

  const workspaces = await getTenantWorkspaceOptions();
  const workspace = workspaces.find(
    (candidate) => candidate.organizationId === parsedOrganizationId.data,
  );
  if (!workspace) {
    return {
      status: "error",
      message: "You no longer have access to that workspace.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(activeWorkspaceCookieName, workspace.organizationId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: isProduction(),
  });

  revalidatePath("/", "layout");

  return {
    status: "switched",
    message: "Switched to " + workspace.organizationName + ".",
  };
}
