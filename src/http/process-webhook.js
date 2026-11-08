// @ts-check
import { hasSeenUpdate, rememberUpdate } from "../services/dedupe.js";
import { createTelegramApi } from "../services/telegram.js";
import { secretsMatch } from "../utils/secrets.js";

/**
 * @typedef {import("../types.js").TelegramUpdate} TelegramUpdate
 * @typedef {import("../services/telegram.js").TelegramApi} TelegramApi
 */

/**
 * @typedef {Object} IncomingRequest
 * @property {string | undefined} [method]
 * @property {Record<string, string | string[] | undefined>} headers
 * @property {unknown} [body]
 */

/**
 * @typedef {Object} HttpResponse
 * @property {(code: number) => { json: (body: unknown) => void }} status
 */

/**
 * @param {IncomingRequest} req
 * @param {HttpResponse} res
 * @param {object} options
 * @param {string} options.botName
 * @param {string | undefined} options.secret
 * @param {string | undefined} options.token
 * @param {(update: TelegramUpdate, api: TelegramApi) => Promise<void>} options.handle
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function processWebhook(req, res, options) {
  const method = (req.method ?? "").toUpperCase();
  if (method === "GET") {
    res.status(200).json({ ok: true, bot: options.botName });
    return;
  }
  if (method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }

  const provided = headerValue(req.headers, "x-telegram-bot-api-secret-token");
  if (!secretsMatch(options.secret, provided)) {
    res.status(401).json({ ok: false });
    return;
  }

  if (!options.token || !options.token.trim()) {
    console.error(`${options.botName}: bot token is not configured`);
    res.status(500).json({ ok: false });
    return;
  }

  const update = parseUpdate(req.body);
  if (!update) {
    res.status(400).json({ ok: false });
    return;
  }

  if (typeof update.update_id === "number" && hasSeenUpdate(options.botName, update.update_id)) {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const api = createTelegramApi(options.token, options.fetchImpl);
    await options.handle(update, api);
    if (typeof update.update_id === "number") rememberUpdate(options.botName, update.update_id);
    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`${options.botName}: ${message.replace(/bot\d*:[A-Za-z0-9_-]+/gi, "bot[redacted]")}`);
    res.status(500).json({ ok: false });
  }
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
export function headerValue(headers, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * @param {unknown} body
 * @returns {TelegramUpdate | null}
 */
export function parseUpdate(body) {
  let value = body;
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {TelegramUpdate} */ (value);
}
