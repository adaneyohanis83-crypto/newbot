// @ts-check
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * @param {string | undefined} expected
 * @param {string} received
 */
export function secretsMatch(expected, received) {
  if (!expected || !expected.trim()) return false;
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  const receivedHash = createHash("sha256").update(received, "utf8").digest();
  return timingSafeEqual(expectedHash, receivedHash);
}
