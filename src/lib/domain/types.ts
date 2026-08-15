export const membershipRoles = [
  "platform_admin",
  "customer_owner",
  "customer_admin",
  "customer_member",
  "assistant_user",
] as const;

export type MembershipRole = (typeof membershipRoles)[number];

export const featureKeys = [
  "calendar",
  "calendar_management",
  "multi_calendar",
  "whatsapp",
  "telegram",
  "gmail",
  "slack",
  "morning_brief",
  "basic_travel",
  "live_traffic",
  "travel_aware_scheduling",
  "smart_rescheduling",
  "conflict_detection",
  "attendee_notifications",
  "voice_messages",
  "basic_memory",
  "advanced_memory",
  "meeting_buffers",
  "team_users",
  "shared_calendars",
  "approval_workflows",
  "audit_logs",
  "crm_integrations",
  "custom_automations",
  "advanced_analytics",
] as const;

export type FeatureKey = (typeof featureKeys)[number];

export const toolActions = [
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
  "integration.manage",
  "organization.manage",
  "team.manage",
  "billing.manage",
  "approval_policy.manage",
  "automation.manage",
  "assistant.use",
  "memory.read",
] as const;

export type ToolAction = (typeof toolActions)[number];

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface TenantContext {
  organizationId: string;
  userId: string;
  role: MembershipRole;
  timezone: string;
}

export interface PlanEntitlement {
  feature: FeatureKey;
  enabled: boolean;
  limit: number | null;
  configuration: Record<string, unknown>;
}

export interface CustomerEntitlementOverride extends PlanEntitlement {
  expiresAt: Date | null;
}

export interface EffectiveEntitlement extends PlanEntitlement {
  source: "plan" | "override" | "none";
}

export interface ApprovalPolicy {
  action: ToolAction;
  required: boolean;
  conditions: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  organizationId: string;
  action: ToolAction;
  summary: string;
  status: "pending" | "approved" | "rejected" | "expired" | "executed";
  idempotencyKey: string;
  expiresAt: Date | null;
}

export interface AuditEvent {
  organizationId: string;
  action: string;
  actorType: "user" | "agent" | "system" | "integration";
  actorUserId?: string;
  toolName?: string;
  targetType?: string;
  targetId?: string;
  result: "succeeded" | "failed" | "blocked" | "requested";
  metadata?: Record<string, unknown>;
}
