// @ts-check
import path from "node:path";
import { inspectConfig } from "../src/config/check.js";
import { loadEnvFile } from "../src/utils/env-file.js";
import { normalizeUsername } from "../src/utils/validation.js";

const env = loadEnvFile(path.join(process.cwd(), ".env"));
const report = inspectConfig(env);

if (report.packageIssues.length > 0) {
  console.log("Package warnings:");
  for (const issue of report.packageIssues) console.log(`- ${issue}`);
}

if (report.webhookIssues.length > 0) {
  console.error("Webhook configuration is incomplete:");
  for (const issue of report.webhookIssues) console.error(`- ${issue}`);
  process.exit(1);
}

const appUrl = String(env.APP_URL).trim().replace(/\/+$/, "");

try {
  await register("Bot 1", env.BOT1_TOKEN, env.BOT1_USERNAME, `${appUrl}/api/webhook/bot1`, env.BOT1_WEBHOOK_SECRET);
} catch (error) {
  const message = error instanceof Error ? error.message : "Webhook registration failed";
  console.error(message);
  process.exit(1);
}

/**
 * @param {string} label
 * @param {string | undefined} token
 * @param {string | undefined} username
 * @param {string} url
 * @param {string | undefined} secret
 */
async function register(label, token, username, url, secret) {
  if (!token || !secret) throw new Error(`${label} is missing a token or webhook secret`);
  const me = await callTelegram(token, "getMe");
  const actual = typeof me.username === "string" ? me.username : "";
  const expected = normalizeUsername(username);
  if (!actual || actual.toLowerCase() !== expected?.toLowerCase()) {
    throw new Error(`${label} token belongs to @${actual || "unknown"}. BOT username is set to @${expected || "invalid"}.`);
  }

  await callTelegram(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query", "pre_checkout_query"],
    drop_pending_updates: false,
  });

  const info = await callTelegram(token, "getWebhookInfo");
  if (info.url !== url) {
    throw new Error(`${label} webhook was not saved at the expected URL`);
  }
  console.log(`${label} (@${actual}): webhook set to ${url}`);
}

/**
 * @param {string} token
 * @param {string} method
 * @param {Record<string, unknown>} [body]
 * @returns {Promise<Record<string, any>>}
 */
async function callTelegram(token, method, body) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error(`${method} could not be reached`);
  }

  /** @type {{ ok?: boolean, description?: string, result?: Record<string, any> }} */
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${method} returned an unreadable response`);
  }
  if (!data.ok || !data.result) {
    throw new Error(data.description || `${method} failed`);
  }
  return data.result;
}
