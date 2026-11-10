import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies the `X-Hub-Signature-256` header over the raw body bytes. */
export function verifySignature(
  secret: string | undefined,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
