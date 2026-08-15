import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyHmacSha256 } from "@/lib/webhooks/signatures";

describe("webhook signature verification", () => {
  it("accepts the exact WhatsApp-style HMAC signature", () => {
    const payload = '{"entry":[{"id":"event-1"}]}';
    const secret = "webhook-secret";
    const signature =
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

    expect(verifyHmacSha256(payload, secret, signature)).toBe(true);
  });

  it("rejects altered payloads and malformed signatures before parsing", () => {
    const payload = '{"entry":[{"id":"event-1"}]}';
    const secret = "webhook-secret";
    const signature =
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

    expect(
      verifyHmacSha256(payload + " ", secret, signature),
    ).toBe(false);
    expect(verifyHmacSha256(payload, secret, "not-a-signature")).toBe(false);
    expect(verifyHmacSha256(payload, secret, null)).toBe(false);
  });
});
