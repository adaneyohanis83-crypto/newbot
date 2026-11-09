// @ts-check
/**
 * Vercel KV database layer.
 * All persistence goes through this module.
 *
 * Key schema:
 *   user:{userId}                 → UserRecord
 *   order:{orderId}               → OrderRecord
 *   payment:{chargeId}            → PaymentRecord
 *   membership:{userId}:{channel} → MembershipRecord
 *   user_orders:{userId}          → string[]   (list of orderIds)
 *   user_memberships:{userId}     → string[]   (list of channelIds)
 */

import { Redis } from "@upstash/redis";

/**
 * @returns {Redis}
 */
function getKv() {
  return new Redis({
    url: process.env.KV_REST_API_URL ?? "",
    token: process.env.KV_REST_API_TOKEN ?? "",
  });
}

/**
 * @typedef {Object} UserRecord
 * @property {string} userId
 * @property {string} username
 * @property {string} registeredAt
 */

/**
 * @typedef {Object} OrderRecord
 * @property {string} orderId
 * @property {string} userId
 * @property {string} packageId
 * @property {number} amount
 * @property {string} currency
 * @property {"pending"|"paid"|"refunded"|"failed"} status
 * @property {string} createdAt
 * @property {string} [paidAt]
 * @property {string} [refundedAt]
 * @property {string} [telegramChargeId]
 */

/**
 * @typedef {Object} PaymentRecord
 * @property {string} chargeId
 * @property {string} [providerChargeId]
 * @property {string} orderId
 * @property {string} userId
 * @property {number} amount
 * @property {string} currency
 * @property {string} paidAt
 */

/**
 * @typedef {Object} MembershipRecord
 * @property {string} userId
 * @property {string} channelId
 * @property {string} packageId
 * @property {string} orderId
 * @property {"active"|"revoked"} status
 * @property {string} grantedAt
 * @property {string|null} expiresAt
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * @param {string} userId
 * @param {string} username
 */
export async function upsertUser(userId, username) {
  const kv = getKv();
  const existing = await kv.get(`user:${userId}`);
  if (!existing) {
    /** @type {UserRecord} */
    const record = { userId, username, registeredAt: new Date().toISOString() };
    await kv.set(`user:${userId}`, record);
  }
}

/**
 * @param {string} userId
 * @returns {Promise<UserRecord|null>}
 */
export async function getUser(userId) {
  return getKv().get(`user:${userId}`);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * @param {string} userId
 * @param {string} packageId
 * @param {number} amount
 * @returns {Promise<OrderRecord>}
 */
export async function createOrder(userId, packageId, amount) {
  const kv = getKv();
  const orderId = `${userId}_${packageId}_${Date.now()}`;
  /** @type {OrderRecord} */
  const order = {
    orderId,
    userId,
    packageId,
    amount,
    currency: "XTR",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await kv.set(`order:${orderId}`, order);
  // Append to user's order list
  const existing = /** @type {string[]|null} */ (await kv.get(`user_orders:${userId}`)) ?? [];
  await kv.set(`user_orders:${userId}`, [...existing, orderId]);
  return order;
}

/**
 * @param {string} orderId
 * @returns {Promise<OrderRecord|null>}
 */
export async function getOrder(orderId) {
  return getKv().get(`order:${orderId}`);
}

/**
 * @param {string} orderId
 * @param {Partial<OrderRecord>} patch
 */
export async function updateOrder(orderId, patch) {
  const kv = getKv();
  const existing = await kv.get(`order:${orderId}`);
  if (!existing) throw new Error(`Order ${orderId} not found`);
  await kv.set(`order:${orderId}`, { ...existing, ...patch });
}

/**
 * @param {string} userId
 * @returns {Promise<OrderRecord[]>}
 */
export async function getUserOrders(userId) {
  const kv = getKv();
  const ids = /** @type {string[]|null} */ (await kv.get(`user_orders:${userId}`)) ?? [];
  const orders = await Promise.all(ids.map((id) => kv.get(`order:${id}`)));
  return /** @type {OrderRecord[]} */ (orders.filter(Boolean));
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * @param {string} chargeId
 * @param {string} orderId
 * @param {string} userId
 * @param {number} amount
 * @param {string} [providerChargeId]
 * @returns {Promise<PaymentRecord>}
 */
export async function recordPayment(chargeId, orderId, userId, amount, providerChargeId) {
  const kv = getKv();
  // Prevent duplicate charge processing
  const existing = await kv.get(`payment:${chargeId}`);
  if (existing) return /** @type {PaymentRecord} */ (existing);

  /** @type {PaymentRecord} */
  const payment = {
    chargeId,
    providerChargeId: providerChargeId ?? "",
    orderId,
    userId,
    amount,
    currency: "XTR",
    paidAt: new Date().toISOString(),
  };
  await kv.set(`payment:${chargeId}`, payment);
  return payment;
}

/**
 * @param {string} chargeId
 * @returns {Promise<PaymentRecord|null>}
 */
export async function getPayment(chargeId) {
  return getKv().get(`payment:${chargeId}`);
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

/**
 * @param {string} userId
 * @param {string} channelId
 * @param {string} packageId
 * @param {string} orderId
 * @returns {Promise<MembershipRecord>}
 */
export async function grantMembership(userId, channelId, packageId, orderId) {
  const kv = getKv();
  const key = `membership:${userId}:${channelId}`;
  const existing = /** @type {MembershipRecord|null} */ (await kv.get(key));
  if (existing && existing.status === "active") return existing;

  /** @type {MembershipRecord} */
  const membership = {
    userId,
    channelId,
    packageId,
    orderId,
    status: "active",
    grantedAt: new Date().toISOString(),
    expiresAt: null, // lifetime
  };
  await kv.set(key, membership);

  // Track which channels this user has access to
  const channels = /** @type {string[]|null} */ (await kv.get(`user_memberships:${userId}`)) ?? [];
  if (!channels.includes(channelId)) {
    await kv.set(`user_memberships:${userId}`, [...channels, channelId]);
  }
  return membership;
}

/**
 * @param {string} userId
 * @param {string} channelId
 * @returns {Promise<MembershipRecord|null>}
 */
export async function getMembership(userId, channelId) {
  return getKv().get(`membership:${userId}:${channelId}`);
}

/**
 * @param {string} userId
 * @returns {Promise<MembershipRecord[]>}
 */
export async function getUserMemberships(userId) {
  const kv = getKv();
  const channels = /** @type {string[]|null} */ (await kv.get(`user_memberships:${userId}`)) ?? [];
  const memberships = await Promise.all(
    channels.map((ch) => kv.get(`membership:${userId}:${ch}`))
  );
  return /** @type {MembershipRecord[]} */ (memberships.filter(Boolean));
}

/**
 * @param {string} userId
 * @param {string} channelId
 */
export async function revokeMembership(userId, channelId) {
  const kv = getKv();
  const key = `membership:${userId}:${channelId}`;
  const existing = /** @type {MembershipRecord|null} */ (await kv.get(key));
  if (existing) {
    await kv.set(key, { ...existing, status: "revoked" });
  }
}

/**
 * Check if user has an active lifetime membership for a channel.
 * @param {string} userId
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
export async function hasActiveMembership(userId, channelId) {
  const m = await getMembership(userId, channelId);
  return m !== null && m.status === "active";
}

/**
 * Get all active channel IDs for a user.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function getActiveChannels(userId) {
  const memberships = await getUserMemberships(userId);
  return memberships.filter((m) => m.status === "active").map((m) => m.channelId);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{totalOrders: number, paidOrders: number, totalStars: number}>}
 */
export async function getStats() {
  // Basic stats — scan recent keys
  // Note: full scan not available in KV; this is an approximation via a counter
  const kv = getKv();
  const stats = /** @type {{totalOrders:number,paidOrders:number,totalStars:number}|null} */ (
    await kv.get("stats:global")
  );
  return stats ?? { totalOrders: 0, paidOrders: 0, totalStars: 0 };
}

/**
 * @param {number} stars
 */
export async function incrementStats(stars) {
  const kv = getKv();
  const current = await getStats();
  await kv.set("stats:global", {
    totalOrders: current.totalOrders + 1,
    paidOrders: current.paidOrders + 1,
    totalStars: current.totalStars + stars,
  });
}
