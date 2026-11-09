// @ts-check
/**
 * Simple in-memory rate limiter per user.
 * Resets across serverless cold starts — good enough for abuse prevention.
 * For stricter limits, move counters to KV.
 */

/** @type {Map<string, {count: number, resetAt: number}>} */
const limits = new Map();

const MAX_REQUESTS = 10;       // max requests per window
const WINDOW_MS = 60_000;      // 1 minute window

/**
 * Returns true if the user is within rate limits (request allowed).
 * Returns false if the user has exceeded the limit.
 * @param {string} userId
 */
export function checkRateLimit(userId) {
  const now = Date.now();
  const entry = limits.get(userId);

  if (!entry || now > entry.resetAt) {
    limits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Clean up expired entries to prevent memory leaks.
 * Call periodically (e.g. every 100 requests).
 */
export function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, entry] of limits.entries()) {
    if (now > entry.resetAt) limits.delete(key);
  }
}
