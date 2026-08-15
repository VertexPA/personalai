import { ApprovalService } from "@/lib/approvals";
import { EntitlementService } from "@/lib/entitlements";
import { IdempotencyService } from "@/lib/idempotency";
import { AuthorizationService } from "@/lib/permissions";
import type {
  FeatureKey,
  RiskLevel,
  ToolAction,
} from "@/lib/domain/types";

export interface ControlledTool<Input, Output> {
  name: string;
  action: ToolAction;
  requiredFeature?: FeatureKey;
  riskLevel: RiskLevel;
  execute(input: Input): Promise<Output>;
}

export interface ToolGatewayRequest<Input> {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
  tool: ControlledTool<Input, unknown>;
  input: Input;
}

export type ToolGatewayResult<Output> =
  | {
      status: "executed";
      value: Output;
      replayed: boolean;
    }
  | {
      status: "approval_required";
      action: ToolAction;
    }
  | {
      status: "denied";
      reason: string;
    };

/**
 * Sensitive tool execution passes through this gateway. Agent runtimes and
 * communication webhooks receive no direct calendar, email, or messaging client.
 */
export class ToolGateway {
  public constructor(
    private readonly entitlements: EntitlementService,
    private readonly authorization: AuthorizationService,
    private readonly approvals: ApprovalService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async execute<Input, Output>(
    request: ToolGatewayRequest<Input>,
  ): Promise<ToolGatewayResult<Output>> {
    const { organizationId, userId, tool } = request;

    const isAllowed = await this.authorization.canPerformAction(
      userId,
      organizationId,
      tool.action,
    );
    if (!isAllowed) {
      return {
        status: "denied",
        reason: "Your organization role cannot perform this action.",
      };
    }

    if (
      tool.requiredFeature &&
      !(await this.entitlements.hasFeature(organizationId, tool.requiredFeature))
    ) {
      return {
        status: "denied",
        reason: "This action requires the " + tool.requiredFeature + " feature.",
      };
    }

    if (
      await this.approvals.requiresApproval(
        organizationId,
        tool.action,
        tool.riskLevel,
      )
    ) {
      return {
        status: "approval_required",
        action: tool.action,
      };
    }

    const result = await this.idempotency.execute(
      organizationId + ":" + tool.name,
      request.idempotencyKey,
      async () => tool.execute(request.input) as Promise<Output>,
    );

    return {
      status: "executed",
      value: result.value,
      replayed: result.replayed,
    };
  }
}
