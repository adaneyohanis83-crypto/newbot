// @ts-check
import { deepLink, isValidPackageId } from "../utils/validation.js";
import { isPayable, PackageConfigError, resolvePackage } from "../config/packages.js";
import { handleAdminMessage } from "./admin.js";
import { presentMessage } from "./present.js";
import {
  catalogUnavailableText,
  menuText,
  privateChatText,
  selectionText,
  welcomeText,
} from "./text.js";

/**
 * @typedef {import("../types.js").TelegramUpdate} TelegramUpdate
 * @typedef {import("../types.js").TelegramCallbackQuery} TelegramCallbackQuery
 * @typedef {import("../types.js").InlineKeyboard} InlineKeyboard
 * @typedef {import("./context.js").BotContext} BotContext
 * @typedef {import("../config/packages.js").ResolvedPackage} ResolvedPackage
 */

/**
 * @param {TelegramUpdate} update
 * @param {BotContext} ctx
 */
export async function handleBot1Update(update, ctx) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, ctx);
    return;
  }

  const message = update.message;
  if (!message || typeof message.text !== "string") return;

  if (message.chat?.type !== "private") {
    await ctx.api.sendMessage(message.chat.id, privateChatText());
    return;
  }

  const text = message.text.trim();
  if (/^\/admin(?:@\w+)?(?:\s|$)/i.test(text)) {
    await handleAdminMessage(message, ctx);
    return;
  }

  // Any /start (with or without payload) shows the menu directly
  if (/^\/start(?:@\w+)?/i.test(text)) {
    await showMenu(message.chat.id, undefined, ctx);
    return;
  }
}

/**
 * @param {TelegramCallbackQuery} query
 * @param {BotContext} ctx
 */
async function handleCallback(query, ctx) {
  const chat = query.message?.chat;
  if (!chat || chat.type !== "private") {
    await ctx.api.answerCallbackQuery(query.id);
    return;
  }

  await ctx.api.answerCallbackQuery(query.id);
  const data = query.data ?? "";
  const target = { chatId: chat.id, messageId: query.message?.message_id };

  if (data === "menu") {
    await showMenu(target.chatId, target.messageId, ctx);
    return;
  }

  if (data.startsWith("pkg:")) {
    const packageId = data.slice(4).toLowerCase();
    if (!isValidPackageId(packageId)) {
      await presentMessage(ctx.api, target, "⚠️ That category is not available.", menuBackKeyboard());
      return;
    }
    await showDetails(target.chatId, target.messageId, packageId, ctx);
    return;
  }
}

/**
 * @param {number} chatId
 * @param {number | undefined} messageId
 * @param {BotContext} ctx
 */
async function showMenu(chatId, messageId, ctx) {
  const packages = await loadPackages(chatId, messageId, ctx);
  if (!packages) return;
  const active = packages.filter((pkg) => pkg.active);
  await presentMessage(ctx.api, { chatId, messageId }, menuText(active.length), menuKeyboard(active));
}

/**
 * @param {number} chatId
 * @param {number | undefined} messageId
 * @param {string} packageId
 * @param {BotContext} ctx
 */
async function showDetails(chatId, messageId, packageId, ctx) {
  const packages = await loadPackages(chatId, messageId, ctx);
  if (!packages) return;

  const pkg = packages.find((item) => item.id === packageId);
  if (!pkg || !pkg.active) {
    await presentMessage(
      ctx.api,
      { chatId, messageId },
      "⚠️ That category is not available.",
      menuBackKeyboard(),
    );
    return;
  }

  const payable = isPayable(pkg);
  const usernameReady = Boolean(ctx.bot2Username);

  await presentMessage(
    ctx.api,
    { chatId, messageId },
    selectionText(pkg, { payable, usernameReady }),
    detailsKeyboard(pkg.id, payable && usernameReady ? ctx.bot2Username : null, pkg.priceLabel),
    pkg.imageUrl || undefined,
  );
}

/**
 * @param {number} chatId
 * @param {number | undefined} messageId
 * @param {BotContext} ctx
 * @returns {Promise<ResolvedPackage[] | null>}
 */
async function loadPackages(chatId, messageId, ctx) {
  try {
    return ctx.repository.load().map((record) => resolvePackage(record, ctx.env));
  } catch (error) {
    if (error instanceof PackageConfigError) {
      await presentMessage(ctx.api, { chatId, messageId }, catalogUnavailableText(), menuBackKeyboard());
      return null;
    }
    throw error;
  }
}

/**
 * @param {ResolvedPackage[]} packages
 * @returns {InlineKeyboard}
 */
function menuKeyboard(packages) {
  // Each package gets its own full-width row
  const rows = packages.map((pkg) => [{
    text: pkg.name,
    callback_data: `pkg:${pkg.id}`,
  }]);
  return { inline_keyboard: rows };
}

/**
 * @returns {InlineKeyboard}
 */
function menuBackKeyboard() {
  return {
    inline_keyboard: [[{ text: "🔙 Back to menu", callback_data: "menu" }]],
  };
}

/**
 * @param {string} packageId
 * @param {string | null} bot2Username
 * @param {string} priceLabel
 * @returns {InlineKeyboard}
 */
function detailsKeyboard(packageId, bot2Username, priceLabel) {
  /** @type {import("../types.js").InlineButton[][]} */
  const rows = [];

  if (bot2Username) {
    rows.push([{
      text: `⭐ Pay with Stars`,
      url: deepLink(bot2Username, packageId),
    }]);
  }

  rows.push([{ text: "🔙 Back to menu", callback_data: "menu" }]);

  return { inline_keyboard: rows };
}
