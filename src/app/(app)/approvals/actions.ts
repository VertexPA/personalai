"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const approvalDecisionSchema = z.object({
  approvalRequestId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export type ApprovalDecisionResult =
  | {
      status: "approved" | "rejected" | "expired";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

interface ApprovalDecisionRpcRow {
  approval_status: "approved" | "rejected" | "expired";
}

function messageForRpcError(error: { code?: string }): string {
  if (error.code === "42501") {
    return "Only a workspace owner or admin can decide this request.";
  }

  if (error.code === "P0001") {
    return "This request has already been decided. Refresh to see its latest state.";
  }

  if (error.code === "P0002") {
    return "This approval request is no longer available.";
  }

  if (error.code === "22023") {
    return "The approval decision is invalid.";
  }

  return "We could not save this approval decision. Please try again.";
}

/**
 * The database RPC takes the row lock and updates the approval, controlled tool
 * action, and audit event in one transaction. This action supplies only an ID
 * and a decision; tenant identity and decision authority come from the session.
 */
export async function decideApprovalRequest(
  input: unknown,
): Promise<ApprovalDecisionResult> {
  const parsed = approvalDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "The approval request is invalid." };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message: "Approval decisions are unavailable in the development preview.",
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (
    !workspace ||
    !canPerformAction(workspace.role, "approval_policy.manage")
  ) {
    return {
      status: "error",
      message: "Only a workspace owner or admin can decide this request.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const { data, error } = await supabase.rpc("decide_approval_request", {
    p_approval_request_id: parsed.data.approvalRequestId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note || null,
  });
  if (error) {
    return { status: "error", message: messageForRpcError(error) };
  }

  const row = (data as unknown as ApprovalDecisionRpcRow[] | null)?.[0];
  if (!row) {
    return {
      status: "error",
      message: "The approval decision could not be confirmed.",
    };
  }

  revalidatePath("/approvals");
  revalidatePath("/dashboard");

  if (row.approval_status === "approved") {
    return {
      status: "approved",
      message:
        "Approved and queued for the controlled executor. It can run once only.",
    };
  }

  if (row.approval_status === "rejected") {
    return {
      status: "rejected",
      message: "Rejected. The linked controlled action has been cancelled.",
    };
  }

  return {
    status: "expired",
    message: "This request expired before a decision could be recorded.",
  };
}
