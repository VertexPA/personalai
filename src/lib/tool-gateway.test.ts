import { describe, expect, it } from "vitest";

import { ApprovalService } from "@/lib/approvals";
import { EntitlementService } from "@/lib/entitlements";
import { IdempotencyService } from "@/lib/idempotency";
import { AuthorizationService } from "@/lib/permissions";
import { ToolGateway } from "@/lib/tool-gateway";
import {
  DemoApprovalPolicyRepository,
  DemoAuthorizationRepository,
  DemoEntitlementRepository,
  InMemoryIdempotencyStore,
} from "@/lib/demo/repositories";
import { demoOrganization, demoUser } from "@/lib/demo/data";

function createGateway(): ToolGateway {
  return new ToolGateway(
    new EntitlementService(new DemoEntitlementRepository()),
    new AuthorizationService(new DemoAuthorizationRepository()),
    new ApprovalService(new DemoApprovalPolicyRepository()),
    new IdempotencyService(new InMemoryIdempotencyStore()),
  );
}

describe("ToolGateway", () => {
  it("requests approval before it executes a sensitive tool", async () => {
    let executions = 0;
    const gateway = createGateway();

    const result = await gateway.execute({
      organizationId: demoOrganization.id,
      userId: demoUser.id,
      idempotencyKey: "sensitive-action",
      input: {},
      tool: {
        name: "move-calendar-event",
        action: "calendar.move_external",
        requiredFeature: "calendar_management",
        riskLevel: "high",
        async execute() {
          executions += 1;
          return { moved: true };
        },
      },
    });

    expect(result).toEqual({
      status: "approval_required",
      action: "calendar.move_external",
    });
    expect(executions).toBe(0);
  });

  it("replays an idempotent low-risk result only once", async () => {
    let executions = 0;
    const gateway = createGateway();
    const request = {
      organizationId: demoOrganization.id,
      userId: demoUser.id,
      idempotencyKey: "travel-read",
      input: {},
      tool: {
        name: "lookup-travel",
        action: "travel.read" as const,
        requiredFeature: "basic_travel" as const,
        riskLevel: "low" as const,
        async execute() {
          executions += 1;
          return { duration: 38 };
        },
      },
    };

    const first = await gateway.execute(request);
    const second = await gateway.execute(request);

    expect(first).toMatchObject({ status: "executed", replayed: false });
    expect(second).toMatchObject({ status: "executed", replayed: true });
    expect(executions).toBe(1);
  });
});
