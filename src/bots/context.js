// @ts-check
import { parseAdminIds, normalizeUsername } from "../utils/validation.js";
import { createDefaultRepository } from "../config/packages.js";

/**
 * @typedef {import("../services/telegram.js").TelegramApi} TelegramApi
 * @typedef {import("../config/packages.js").PackageRepository} PackageRepository
 */

/**
 * @typedef {Object} BotContext
 * @property {TelegramApi} api
 * @property {PackageRepository} repository
 * @property {NodeJS.ProcessEnv} env
 * @property {string | null} bot1Username
 * @property {string | null} bot2Username
 * @property {Set<string>} adminIds
 */

/**
 * @param {TelegramApi} api
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {PackageRepository} [options.repository]
 * @returns {BotContext}
 */
export function createBotContext(api, options = {}) {
  const env = options.env ?? process.env;
  return {
    api,
    env,
    repository: options.repository ?? createDefaultRepository(env),
    bot1Username: normalizeUsername(env.BOT1_USERNAME),
    bot2Username: null, // single-bot mode — no Bot 2
    adminIds: parseAdminIds(env.ADMIN_TELEGRAM_ID),
  };
}
