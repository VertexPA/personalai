"use server";

import { hasWorkspaceFeature } from "@/data/entitlements";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type TelegramLinkActionResult =
  | {
      status: "ready";
      message: string;
      token: string;
      expiresAt: string;
    }
  | {
      status: "idle" | "error";
      message: string;
    };

interface TelegramLinkTokenRow {
  token: string;
  expires_at: string;
}

export async function createTelegramLinkToken(
  _previousState: TelegramLinkActionResult,
  _formData: FormData,
): Promise<TelegramLinkActionResult> {
  void _previousState;
  void _formData;

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message: "Telegram linking is unavailable until Supabase is configured.",
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (
    !workspace ||
    !canPerformAction(workspace.role, "integration.manage")
  ) {
    return {
      status: "error",
      message: "Only a workspace owner or admin can link Telegram.",
    };
  }

  if (!(await hasWorkspaceFeature(workspace.organizationId, "telegram"))) {
    return {
      status: "error",
      message: "Telegram is not enabled for this workspace plan.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const { data, error } = await supabase.rpc("create_telegram_link_token", {
    p_organization_id: workspace.organizationId,
  });
  const row = (data as unknown as TelegramLinkTokenRow[] | null)?.[0];

  if (error?.code === "42501") {
    return {
      status: "error",
      message: "You cannot link Telegram for this workspace.",
    };
  }
  if (error || !row) {
    return {
      status: "error",
      message: "A secure Telegram link code could not be created. Please try again.",
    };
  }

  return {
    status: "ready",
    token: row.token,
    expiresAt: row.expires_at,
    message:
      "Send the one-time command below in a private chat with the configured Telegram bot.",
  };
}
