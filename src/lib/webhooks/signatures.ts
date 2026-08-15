import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export function verifyHmacSha256(
  rawPayload: string,
  secret: string,
  providedSignature: string | null,
): boolean {
  if (!providedSignature?.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature =
    "sha256=" + createHmac("sha256", secret).update(rawPayload).digest("hex");
  const expected = Buffer.from(expectedSignature, "utf8");
  const received = Buffer.from(providedSignature, "utf8");

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
