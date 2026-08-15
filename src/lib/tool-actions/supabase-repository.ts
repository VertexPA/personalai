import "server-only";

import type {
  ClaimedToolAction,
  ToolActionExecutionRepository,
} from "@/lib/tool-actions/executor";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface ApprovedActionIdRow {
  tool_action_id: string;
}

interface ClaimedToolActionRow {
  id: string;
  organization_id: string;
  action: string;
  tool_name: string;
  risk_level: string;
  idempotency_key: string;
  request_payload: unknown;
  requested_by: string | null;
  execution_attempts: number;
}

/** Service-role repository for internal worker routes and VPS consumers only. */
export class SupabaseToolActionExecutionRepository
  implements ToolActionExecutionRepository
{
  async failStaleExecutions(startedBefore: Date): Promise<number> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc(
      "fail_stale_tool_action_executions",
      { p_started_before: startedBefore.toISOString() },
    );
    if (error) {
      throw new Error("Could not reconcile stale controlled actions.");
    }

    return typeof data === "number" ? data : 0;
  }

  async listApprovedActionIds(limit: number): Promise<string[]> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc(
      "list_approved_tool_action_ids",
      { p_limit: limit },
    );
    if (error) {
      throw new Error("Could not read approved controlled actions.");
    }

    return ((data as unknown as ApprovedActionIdRow[] | null) ?? [])
      .map((row) => row.tool_action_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async claimApprovedAction(actionId: string): Promise<ClaimedToolAction | null> {
    const database = createSupabaseServiceClient();
    const { data, error } = await database.rpc("claim_approved_tool_action", {
      p_tool_action_id: actionId,
    });
    if (error) {
      throw new Error("Could not claim controlled action.");
    }

    const row = (data as unknown as ClaimedToolActionRow[] | null)?.[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      action: row.action,
      toolName: row.tool_name,
      riskLevel: row.risk_level,
      idempotencyKey: row.idempotency_key,
      requestPayload: row.request_payload,
      requestedBy: row.requested_by,
      executionAttempts: row.execution_attempts,
    };
  }

  async completeAction(
    actionId: string,
    outcome: "succeeded" | "failed",
    resultPayload: Record<string, unknown>,
    errorCode?: string,
  ): Promise<void> {
    const database = createSupabaseServiceClient();
    const { error } = await database.rpc("complete_tool_action_execution", {
      p_tool_action_id: actionId,
      p_outcome: outcome,
      p_result_payload: resultPayload,
      p_error_code: errorCode ?? null,
    });
    if (error) {
      throw new Error("Could not finalize controlled action.");
    }
  }
}
