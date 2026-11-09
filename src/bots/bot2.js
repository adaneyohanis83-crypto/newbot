// @ts-check
import { deepLink, isValidPackageId, readStartCommand } from "../utils/validation.js";
import { isPayable, PackageConfigError, resolvePackage } from "../config/packages.js";
import { presentMessage } from "./present.js";
import { catalogUnavailableText, paymentText, privateChatText, unavailableText } from "./text.js";

/**
 * @typedef {import("../types.js").TelegramUpdate} TelegramUpdate
 * @typedef {import("../types.js").InlineKeyboard} InlineKeyboard
 * @typedef {import("./context.js").BotContext} BotContext
 */

/**
 * @param {TelegramUpdate} update
 * @param {BotContext} ctx
 */
export async function handleBot2Update(update, ctx) {
  if (update.callback_query && !update.message) {
    await ctx.api.answerCallbackQuery(update.callback_query.id);
    return;
  }

  const message = update.message;
  if (!message || typeof message.text !== "string") return;

  if (message.chat?.type !== "private") {
    await ctx.api.sendMessage(message.chat.id, privateChatText());
    return;
  }

  const text = message.text.trim();

  const payload = readStartCommand(text);
  if (payload === null) {
    // Any non-/start message — guide back to bot1
    await ctx.api.sendMessage(
      message.chat.id,
      "Please select a category from the main bot first.",
      returnKeyboard(ctx),
    );
    return;
  }

  await showPayment(message.chat.id, payload, ctx);
}

/**
 * @param {number} chatId
 * @param {string} payload
 * @param {BotContext} ctx
 */
async function showPayment(chatId, payload, ctx) {
  const back = returnKeyboard(ctx);

  if (!payload || !isValidPackageId(payload)) {
    await ctx.api.sendMessage(chatId, unavailableText(), back);
    return;
  }

  let packages;
  try {
    packages = ctx.repository.load().map((record) => resolvePackage(record, ctx.env));
  } catch (error) {
    if (error instanceof PackageConfigError) {
      await ctx.api.sendMessage(chatId, catalogUnavailableText(), back);
      return;
    }
    throw error;
  }

  const pkg = packages.find((item) => item.id === payload);
  if (!pkg || !pkg.active || !isPayable(pkg) || !pkg.inviteLink) {
    await ctx.api.sendMessage(chatId, unavailableText(), back);
    return;
  }

  await presentMessage(
    ctx.api,
    { chatId },
    paymentText(pkg),
    paymentKeyboard(pkg.inviteLink, pkg.priceLabel),
    pkg.imageUrl || undefined,
  );
}

/**
 * @param {string} inviteLink
 * @param {string} priceLabel
 * @returns {InlineKeyboard}
 */
function paymentKeyboard(inviteLink, priceLabel) {
  return {
    inline_keyboard: [
      [{ text: `Pay ⭐ ${priceLabel}`, url: inviteLink }],
    ],
  };
}

/**
 * @param {BotContext} ctx
 * @returns {InlineKeyboard | undefined}
 */
function returnKeyboard(ctx) {
  if (!ctx.bot1Username) return undefined;
  return {
    inline_keyboard: [[{
      text: "🔙 Back to menu",
      url: deepLink(ctx.bot1Username, "menu"),
    }]],
  };
}
