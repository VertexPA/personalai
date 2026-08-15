import type {
  ApprovalPolicy,
  RiskLevel,
  ToolAction,
} from "@/lib/domain/types";

const defaultApprovalRequirements: Partial<Record<ToolAction, boolean>> = {
  "calendar.read": false,
  "travel.read": false,
  "schedule.recommend": false,
  "reminder.create": false,
  "calendar.create_external": true,
  "calendar.move_external": true,
  "calendar.cancel": true,
  "email.send": true,
  "notification.send_external": true,
};

export function defaultRequiresApproval(
  action: ToolAction,
  riskLevel: RiskLevel,
): boolean {
  const configuredDefault = defaultApprovalRequirements[action];
  if (configuredDefault !== undefined) {
    return configuredDefault;
  }

  return riskLevel === "high" || riskLevel === "critical";
}

export interface ApprovalPolicyRepository {
  getPolicy(
    organizationId: string,
    action: ToolAction,
  ): Promise<ApprovalPolicy | null>;
}

export class ApprovalService {
  public constructor(private readonly repository: ApprovalPolicyRepository) {}

  async requiresApproval(
    customerId: string,
    action: ToolAction,
    riskLevel: RiskLevel,
  ): Promise<boolean> {
    const policy = await this.repository.getPolicy(customerId, action);
    return policy?.required ?? defaultRequiresApproval(action, riskLevel);
  }
}
