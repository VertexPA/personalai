import type { ApprovalPolicyRepository } from "@/lib/approvals";
import type { EntitlementRepository } from "@/lib/entitlements";
import type { IdempotencyRecord, IdempotencyStore } from "@/lib/idempotency";
import type { AuthorizationRepository } from "@/lib/permissions";
import type {
  ApprovalPolicy,
  CustomerEntitlementOverride,
  MembershipRole,
  PlanEntitlement,
  ToolAction,
} from "@/lib/domain/types";
import {
  demoApprovalPolicies,
  demoCustomerOverrides,
  demoOrganization,
  demoPlanEntitlements,
  demoUser,
} from "@/lib/demo/data";

export class DemoEntitlementRepository implements EntitlementRepository {
  async getPlanEntitlements(organizationId: string): Promise<PlanEntitlement[]> {
    return organizationId === demoOrganization.id ? demoPlanEntitlements : [];
  }

  async getCustomerOverrides(
    organizationId: string,
  ): Promise<CustomerEntitlementOverride[]> {
    return organizationId === demoOrganization.id ? demoCustomerOverrides : [];
  }
}

export class DemoAuthorizationRepository implements AuthorizationRepository {
  async getRole(
    userId: string,
    customerId: string,
  ): Promise<MembershipRole | null> {
    if (userId === demoUser.id && customerId === demoOrganization.id) {
      return demoUser.role;
    }

    return null;
  }
}

export class DemoApprovalPolicyRepository implements ApprovalPolicyRepository {
  async getPolicy(
    organizationId: string,
    action: ToolAction,
  ): Promise<ApprovalPolicy | null> {
    if (organizationId !== demoOrganization.id) {
      return null;
    }

    return demoApprovalPolicies.find((policy) => policy.action === action) ?? null;
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord<unknown>>();

  async get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | null> {
    const record = this.records.get(scope + ":" + key);
    return record ? (record as IdempotencyRecord<T>) : null;
  }

  async set<T>(record: IdempotencyRecord<T>): Promise<void> {
    this.records.set(record.scope + ":" + record.key, record);
  }
}
