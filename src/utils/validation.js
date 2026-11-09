// @ts-check

const PACKAGE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENV_KEY = /^[A-Z][A-Z0-9_]{0,80}$/;
const USERNAME = /^[A-Za-z0-9_]{5,32}$/;

/** @param {string} id */
export function isValidPackageId(id) { return PACKAGE_ID.test(id); }

/** @param {string} id */
export function defaultInviteEnv(id) {
  return `PACKAGE_${id.toUpperCase().replaceAll("-", "_")}_INVITE_LINK`;
}

/** @param {string} id */
export function defaultChannelEnv(id) {
  return `PACKAGE_${id.toUpperCase().replaceAll("-", "_")}_CHANNEL_ID`;
}

/** @param {string} value */
export function isEnvKey(value) { return ENV_KEY.test(value); }

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
export function normalizeUsername(value) {
  if (!value) return null;
  const username = value.trim().replace(/^@/, "");
  return USERNAME.test(username) ? username : null;
}

/**
 * @param {string | undefined} value
 * @returns {Set<string>}
 */
export function parseAdminIds(value) {
  if (!value) return new Set();
  return new Set(
    value.split(",").map((p) => p.trim()).filter((p) => /^[0-9]{1,20}$/.test(p))
  );
}

/** @param {string} value */
export function containsLink(value) {
  return /https?:\/\//i.test(value) || /(^|[\s(])t\.me\b/i.test(value) || /telegram\.me/i.test(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isPaidInviteLink(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return false;
  let url;
  try { url = new URL(trimmed); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host !== "t.me" && host !== "telegram.me") return false;
  if (url.username || url.password) return false;
  return url.pathname.length > 1;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeImageUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return "";
  let url;
  try { url = new URL(trimmed); } catch { return ""; }
  if (url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase();
  if (["t.me","telegram.me","telegram.dog"].includes(host)) return "";
  return trimmed;
}

/**
 * @param {string} username
 * @param {string} payload
 */
export function deepLink(username, payload) {
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
}

/**
 * @param {string | undefined} text
 * @returns {string | null}
 */
export function readStartCommand(text) {
  if (!text) return null;
  const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
  if (!match) return null;
  return (match[1] ?? "").toLowerCase();
}
