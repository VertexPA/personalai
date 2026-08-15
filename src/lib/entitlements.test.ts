import { describe, expect, it } from "vitest";

import { resolveEntitlement } from "@/lib/entitlements";
import type {
  CustomerEntitlementOverride,
  PlanEntitlement,
} from "@/lib/domain/types";

const planEntitlements: PlanEntitlement[] = [
  {
    feature: "slack",
    enabled: false,
    limit: null,
    configuration: {},
  },
  {
    feature: "multi_calendar",
    enabled: true,
    limit: 4,
    configuration: {},
  },
];

describe("resolveEntitlement", () => {
  it("uses a non-expired customer override over the plan entitlement", () => {
    const overrides: CustomerEntitlementOverride[] = [
      {
        feature: "slack",
        enabled: true,
        limit: null,
        configuration: { addon: true },
        expiresAt: null,
      },
    ];

    expect(resolveEntitlement("slack", planEntitlements, overrides)).toMatchObject({
      enabled: true,
      source: "override",
    });
  });

  it("ignores an expired override", () => {
    const overrides: CustomerEntitlementOverride[] = [
      {
        feature: "slack",
        enabled: true,
        limit: null,
        configuration: {},
        expiresAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    expect(
      resolveEntitlement(
        "slack",
        planEntitlements,
        overrides,
        new Date("2026-08-11T00:00:00Z"),
      ),
    ).toMatchObject({
      enabled: false,
      source: "plan",
    });
  });

  it("returns a disabled entitlement when a feature is absent", () => {
    expect(resolveEntitlement("gmail", planEntitlements, [])).toMatchObject({
      enabled: false,
      source: "none",
    });
  });
});
