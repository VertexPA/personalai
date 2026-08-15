import type { MembershipRole, ToolAction } from "@/lib/domain/types";

const ownerAndAdminActions = new Set<ToolAction>([
  "organization.manage",
  "integration.manage",
  "billing.manage",
  "team.manage",
  "approval_policy.manage",
  "automation.manage",
]);

const assistantActions = new Set<ToolAction>([
  "calendar.read",
  "calendar.create",
  "calendar.create_external",
  "calendar.update",
  "calendar.move_external",
  "calendar.cancel",
  "travel.read",
  "schedule.recommend",
  "reminder.create",
  "notification.send",
  "notification.send_external",
  "email.search",
  "email.draft",
  "email.send",
  "assistant.use",
  "memory.read",
]);

export function canPerformAction(
  role: MembershipRole,
  action: ToolAction,
): boolean {
  if (role === "platform_admin" || role === "customer_owner") {
    return true;
  }

  if (role === "customer_admin") {
    return true;
  }

  if (role === "assistant_user") {
    return assistantActions.has(action);
  }

  if (role === "customer_member") {
    return (
      action === "calendar.read" ||
      action === "travel.read" ||
      action === "schedule.recommend" ||
      action === "assistant.use" ||
      action === "memory.read"
    );
  }

  return !ownerAndAdminActions.has(action);
}

export interface AuthorizationRepository {
  getRole(
    userId: string,
    customerId: string,
  ): Promise<MembershipRole | null>;
}

export class AuthorizationService {
  public constructor(private readonly repository: AuthorizationRepository) {}

  async canPerformAction(
    userId: string,
    customerId: string,
    action: ToolAction,
  ): Promise<boolean> {
    const role = await this.repository.getRole(userId, customerId);
    return role !== null && canPerformAction(role, action);
  }
}
