import { describe, expect, it } from "vitest";

import { defaultRequiresApproval } from "@/lib/approvals";

describe("defaultRequiresApproval", () => {
  it("does not require approval for read-only calendar analysis", () => {
    expect(defaultRequiresApproval("calendar.read", "low")).toBe(false);
  });

  it("requires approval for meeting cancellation", () => {
    expect(defaultRequiresApproval("calendar.cancel", "high")).toBe(true);
  });

  it("defaults unknown critical actions to approval required", () => {
    expect(defaultRequiresApproval("integration.manage", "critical")).toBe(true);
  });
});
