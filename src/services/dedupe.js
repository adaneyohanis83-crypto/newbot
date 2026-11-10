// @ts-check
/**
 * Distributed deduplication using Upstash Redis.
 * Works across multiple Vercel serverless instances.
 *
 * Falls back to in-memory if KV is not configured (local dev).
 */

import { Redis } from "@upstash/redis";

/** @type {Map<string, number[]>} */
const localSeen = new Map();
const MAX_LOCAL = 500;

function getKv() {
  const url = process.env.KV_REST_API_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * @param {string} botName
 * @param {number} updateId
 * @returns {Promise<boolean>}
 */
export async function hasSeenUpdate(botName, updateId) {
  const kv = getKv();
  if (kv) {
    const key = `dedup:${botName}:${updateId}`;
    const exists = await kv.exists(key);
    return exists === 1;
  }
  // fallback: in-memory
  return (localSeen.get(botName) ?? []).includes(updateId);
}

/**
 * @param {string} botName
 * @param {number} updateId
 * @returns {Promise<void>}
 */
export async function rememberUpdate(botName, updateId) {
  const kv = getKv();
  if (kv) {
    const key = `dedup:${botName}:${updateId}`;
    // Store for 24 hours — Telegram retries within seconds/minutes
    await kv.set(key, 1, { ex: 86400 });
    return;
  }
  // fallback: in-memory
  const current = localSeen.get(botName) ?? [];
  current.push(updateId);
  localSeen.set(botName, current.slice(-MAX_LOCAL));
}

export function resetSeenUpdates() {
  localSeen.clear();
}
