import { describe, expect, it } from "vitest";

import { canPerformAction } from "@/lib/permissions";

describe("canPerformAction", () => {
  it("does not allow customer members to send external messages", () => {
    expect(
      canPerformAction("customer_member", "notification.send_external"),
    ).toBe(false);
  });

  it("allows assistant users to read a schedule", () => {
    expect(canPerformAction("assistant_user", "calendar.read")).toBe(true);
  });

  it("allows only elevated roles to manage billing", () => {
    expect(canPerformAction("assistant_user", "billing.manage")).toBe(false);
    expect(canPerformAction("customer_admin", "billing.manage")).toBe(true);
  });
});
