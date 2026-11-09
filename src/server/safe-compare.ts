import crypto from "node:crypto";

/**
 * Compares two secrets in constant time. Both sides are hashed first, so the buffers always have the
 * same length and the time taken says nothing about the length of either value.
 */
export function safeEqual(actual: string, expected: string): boolean {
  const actualDigest = crypto.createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}
