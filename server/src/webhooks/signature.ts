import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/**
 * Verifies GitHub's X-Hub-Signature-256 over the *raw* request bytes.
 * Constant-time compare; any malformed header is simply "invalid" (never throws).
 */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith(PREFIX)) return false;
  const provided = header.slice(PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(provided, "hex"));
}
