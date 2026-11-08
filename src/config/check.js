// @ts-check
import { createDefaultRepository, inviteStatus } from "./packages.js";
import { isPaidInviteLink, normalizeUsername } from "../utils/validation.js";

const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function collectWebhookIssues(env) {
  /** @type {string[]} */
  const issues = [];
  for (const key of ["BOT1_TOKEN", "BOT2_TOKEN", "BOT1_WEBHOOK_SECRET", "BOT2_WEBHOOK_SECRET", "ADMIN_TELEGRAM_ID"]) {
    if (!env[key] || !String(env[key]).trim()) issues.push(`${key} is missing`);
  }
  const appUrl = env.APP_URL?.trim() ?? "";
  if (!appUrl) issues.push("APP_URL is missing");
  else if (!/^https:\/\/.+/i.test(appUrl)) issues.push("APP_URL must be an https URL");
  else if (appUrl.endsWith("/")) issues.push("APP_URL must not end with a slash");

  if (!normalizeUsername(env.BOT1_USERNAME)) issues.push("BOT1_USERNAME is missing or invalid");
  if (!normalizeUsername(env.BOT2_USERNAME)) issues.push("BOT2_USERNAME is missing or invalid");
  if (normalizeUsername(env.BOT1_USERNAME) && normalizeUsername(env.BOT1_USERNAME) === normalizeUsername(env.BOT2_USERNAME)) {
    issues.push("BOT1_USERNAME and BOT2_USERNAME must be different");
  }

  for (const key of ["BOT1_WEBHOOK_SECRET", "BOT2_WEBHOOK_SECRET"]) {
    const secret = env[key];
    if (secret && String(secret).trim() && !SECRET_PATTERN.test(String(secret).trim())) {
      issues.push(`${key} must use 1-256 letters, numbers, underscores, or hyphens`);
    }
  }
  if (env.BOT1_WEBHOOK_SECRET && env.BOT1_WEBHOOK_SECRET === env.BOT2_WEBHOOK_SECRET) {
    issues.push("BOT1_WEBHOOK_SECRET and BOT2_WEBHOOK_SECRET must be different");
  }
  if (env.ADMIN_TELEGRAM_ID && !String(env.ADMIN_TELEGRAM_ID).split(",").every((part) => /^[0-9]{1,20}$/.test(part.trim()) || part.trim() === "")) {
    issues.push("ADMIN_TELEGRAM_ID must be a numeric Telegram user id");
  }
  return issues;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {import("./packages.js").PackageRecord[]} records
 * @returns {string[]}
 */
export function collectPackageIssues(env, records) {
  /** @type {string[]} */
  const issues = [];
  /** @type {Map<string, string>} */
  const seenLinks = new Map();

  for (const record of records) {
    const status = inviteStatus(record, env);
    if (record.active && status !== "configured") {
      issues.push(`${record.id}: ${record.inviteLinkEnv} is ${status}`);
    }
    const raw = env[record.inviteLinkEnv];
    if (!isPaidInviteLink(raw)) continue;
    const normalized = raw.trim();
    const previous = seenLinks.get(normalized);
    if (previous) issues.push(`${record.id} uses the same invite link as ${previous}`);
    else seenLinks.set(normalized, record.id);
  }

  if (records.filter((record) => record.active).length === 0) {
    issues.push("No packages are active");
  }
  return issues;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function inspectConfig(env) {
  /** @type {import("./packages.js").PackageRecord[]} */
  let records = [];
  let configError = "";
  try {
    records = createDefaultRepository(env).load();
  } catch (error) {
    configError = error instanceof Error ? error.message : "Package configuration could not be read";
  }
  const webhookIssues = collectWebhookIssues(env);
  const packageIssues = configError ? [configError] : collectPackageIssues(env, records);
  return { records, webhookIssues, packageIssues };
}
