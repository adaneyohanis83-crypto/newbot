// @ts-check
import { isValidPackageId } from "../utils/validation.js";
import { isPayable, PackageConfigError, resolvePackage } from "../config/packages.js";
import { handleAdminMessage } from "./admin.js";
import { presentMessage } from "./present.js";
import {
  catalogUnavailableText,
  menuText,
  privateChatText,
  selectionText,
} from "./text.js";
import {
  upsertUser,
  createOrder,
  getOrder,
  updateOrder,
  recordPayment,
  grantMembership,
  hasActiveMembership,
  getUserMemberships,
  incrementStats,
} from "../services/db.js";
import { escapeHtml } from "../utils/html.js";
import { checkRateLimit, cleanupRateLimits } from "../utils/rate-limit.js";

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
  // Pre-checkout query — must be answered within 10 seconds
  if (update.pre_checkout_query) {
    await handlePreCheckout(update.pre_checkout_query, ctx);
    return;
  }

  // Successful payment
  if (update.message?.successful_payment) {
    await handleSuccessfulPayment(update.message, ctx);
    return;
  }

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

  if (/^\/rejoin(?:@\w+)?$/i.test(text)) {
    const userId = String(message.from?.id ?? "");
    if (userId) await handleRejoin(message.chat.id, userId, ctx);
    return;
  }

  if (/^\/start(?:@\w+)?/i.test(text)) {
    await showMenu(message.chat.id, undefined, ctx);
    return;
  }
}

// ---------------------------------------------------------------------------
// Callback handler
// ---------------------------------------------------------------------------

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
  const userId = String(query.from?.id ?? "");

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

  if (data.startsWith("pay:")) {
    const packageId = data.slice(4).toLowerCase();
    if (!isValidPackageId(packageId)) {
      await presentMessage(ctx.api, target, "⚠️ That category is not available.", menuBackKeyboard());
      return;
    }
    // Rate limit
    cleanupRateLimits();
    if (userId && !checkRateLimit(userId)) {
      await ctx.api.sendMessage(chat.id, "⚠️ Too many requests. Please wait a minute and try again.");
      return;
    }
    await showInvoice(chat.id, userId, String(query.from?.username ?? ""), packageId, ctx);
    return;
  }
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Package details
// ---------------------------------------------------------------------------

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
    await presentMessage(ctx.api, { chatId, messageId }, "⚠️ That category is not available.", menuBackKeyboard());
    return;
  }

  const payable = isPayable(pkg);
  await presentMessage(
    ctx.api,
    { chatId, messageId },
    selectionText(pkg, { payable, usernameReady: true }),
    detailsKeyboard(pkg.id, payable),
    pkg.imageUrl || undefined,
  );
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

/**
 * @param {number} chatId
 * @param {string} userId
 * @param {string} username
 * @param {string} packageId
 * @param {BotContext} ctx
 */
async function showInvoice(chatId, userId, username, packageId, ctx) {
  let packages;
  try {
    packages = ctx.repository.load().map((record) => resolvePackage(record, ctx.env));
  } catch (error) {
    if (error instanceof PackageConfigError) {
      await ctx.api.sendMessage(chatId, catalogUnavailableText(), menuBackKeyboard());
      return;
    }
    throw error;
  }

  const pkg = packages.find((item) => item.id === packageId);
  if (!pkg || !isPayable(pkg)) {
    await ctx.api.sendMessage(chatId, "⚠️ That category is not available.", menuBackKeyboard());
    return;
  }

  // Check lifetime access
  if (userId && pkg.channelIds.length > 0) {
    const alreadyHasAll = await Promise.all(
      pkg.channelIds.map((ch) => hasActiveMembership(userId, ch))
    );
    if (alreadyHasAll.every(Boolean)) {
      await ctx.api.sendMessage(
        chatId,
        `✅ <b>You already have lifetime access to ${escapeHtml(pkg.name)}!</b>\n\nUse /rejoin to get fresh invite links.`,
        menuBackKeyboard(),
      );
      return;
    }
    await upsertUser(userId, username);
  }

  const order = userId ? await createOrder(userId, pkg.id, pkg.priceStars) : null;
  const invoicePayload = order ? order.orderId : `guest_${pkg.id}_${Date.now()}`;

  await ctx.api.sendInvoice(
    chatId,
    pkg.name,
    pkg.description || `Get lifetime access to ${pkg.name}.`,
    invoicePayload,
    "XTR",
    [{ label: "Lifetime Access", amount: pkg.priceStars }],
  );
}

// ---------------------------------------------------------------------------
// Pre-checkout
// ---------------------------------------------------------------------------

/**
 * @param {NonNullable<TelegramUpdate["pre_checkout_query"]>} query
 * @param {BotContext} ctx
 */
async function handlePreCheckout(query, ctx) {
  const { id, from, invoice_payload, currency, total_amount } = query;

  if (currency !== "XTR") {
    await ctx.api.answerPreCheckoutQuery(id, false, "Invalid currency.");
    return;
  }

  const order = await getOrder(invoice_payload);
  if (!order) {
    await ctx.api.answerPreCheckoutQuery(id, false, "Order not found. Please start again.");
    return;
  }

  if (order.userId !== String(from.id)) {
    await ctx.api.answerPreCheckoutQuery(id, false, "This invoice does not belong to you.");
    return;
  }

  if (order.status !== "pending") {
    await ctx.api.answerPreCheckoutQuery(id, false, "This order has already been processed.");
    return;
  }

  if (order.amount !== total_amount) {
    await ctx.api.answerPreCheckoutQuery(id, false, "Invoice amount mismatch.");
    return;
  }

  let packages;
  try {
    packages = ctx.repository.load().map((record) => resolvePackage(record, ctx.env));
  } catch {
    await ctx.api.answerPreCheckoutQuery(id, false, "Package configuration error.");
    return;
  }

  const pkg = packages.find((p) => p.id === order.packageId);
  if (!pkg || !isPayable(pkg)) {
    await ctx.api.answerPreCheckoutQuery(id, false, "This package is no longer available.");
    return;
  }

  await ctx.api.answerPreCheckoutQuery(id, true);
}

// ---------------------------------------------------------------------------
// Successful payment
// ---------------------------------------------------------------------------

/**
 * @param {NonNullable<TelegramUpdate["message"]>} message
 * @param {BotContext} ctx
 */
async function handleSuccessfulPayment(message, ctx) {
  const payment = message.successful_payment;
  if (!payment) return;

  const userId = String(message.from?.id ?? "");
  const chatId = message.chat.id;
  const {
    telegram_payment_charge_id,
    provider_payment_charge_id,
    invoice_payload: orderId,
    currency,
    total_amount,
  } = payment;

  if (currency !== "XTR") {
    await ctx.api.sendMessage(chatId, "⚠️ Unexpected payment currency. Please contact support.");
    return;
  }

  const order = await getOrder(orderId);
  if (!order) {
    await ctx.api.sendMessage(chatId, "⚠️ Order not found. Contact support with payment ID: " + telegram_payment_charge_id);
    return;
  }

  if (order.userId !== userId) {
    await ctx.api.sendMessage(chatId, "⚠️ Payment verification failed.");
    return;
  }

  if (order.amount !== total_amount) {
    await ctx.api.sendMessage(chatId, "⚠️ Payment amount mismatch. Contact support.");
    return;
  }

  // Prevent duplicate processing
  const existingPayment = await recordPayment(
    telegram_payment_charge_id,
    orderId,
    userId,
    total_amount,
    provider_payment_charge_id ?? "",
  );

  if (existingPayment.paidAt !== new Date(existingPayment.paidAt).toISOString() && order.status === "paid") {
    return;
  }

  await updateOrder(orderId, {
    status: "paid",
    paidAt: new Date().toISOString(),
    telegramChargeId: telegram_payment_charge_id,
  });

  await incrementStats(total_amount);

  let pkg;
  try {
    const packages = ctx.repository.load().map((record) => resolvePackage(record, ctx.env));
    pkg = packages.find((p) => p.id === order.packageId);
  } catch {
    await ctx.api.sendMessage(chatId, "✅ Payment received! Delivery issue. Contact support with: " + telegram_payment_charge_id);
    return;
  }

  if (!pkg) {
    await ctx.api.sendMessage(chatId, "✅ Payment received! Package error. Contact support with: " + telegram_payment_charge_id);
    return;
  }

  await deliverAccess(chatId, userId, pkg, orderId, telegram_payment_charge_id, ctx);
}

// ---------------------------------------------------------------------------
// Access delivery
// ---------------------------------------------------------------------------

/**
 * @param {number} chatId
 * @param {string} userId
 * @param {ResolvedPackage} pkg
 * @param {string} orderId
 * @param {string} chargeId
 * @param {BotContext} ctx
 */
async function deliverAccess(chatId, userId, pkg, orderId, chargeId, ctx) {
  /** @type {{label: string, link: string}[]} */
  const delivered = [];
  /** @type {string[]} */
  const failed = [];

  for (const channelId of pkg.channelIds) {
    try {
      const expireDate = Math.floor(Date.now() / 1000) + 3600;
      const inviteLink = await ctx.api.createChatInviteLink(channelId, expireDate, 1);
      await grantMembership(userId, channelId, pkg.id, orderId);
      delivered.push({ label: "Join Channel", link: inviteLink });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`createChatInviteLink failed — channelId: ${channelId}, error: ${msg}`);
      failed.push(`${channelId} (${msg})`);
    }
  }

  if (delivered.length === 0) {
    const errorDetail = failed.join(", ");
    await ctx.api.sendMessage(
      chatId,
      `✅ Payment of ${pkg.priceStars.toLocaleString()} ⭐ confirmed!\n\n⚠️ Channel access delivery failed.\n\n<b>Debug info:</b> <code>${escapeHtml(errorDetail)}</code>\n\nPayment ID: <code>${escapeHtml(chargeId)}</code>`,
    );
    return;
  }

  const lines = [
    "🎉 <b>Payment Successful!</b>",
    "",
    `<b>Package:</b> ${escapeHtml(pkg.name)}`,
    `<b>Payment:</b> ${pkg.priceStars.toLocaleString()} ⭐`,
    "<b>Access:</b> Lifetime ♾️",
    "",
    "Your private channel invitation is ready.",
    "The link expires in 1 hour — join now.",
    "",
    "👇 Click below to join your channel:",
  ];

  if (failed.length > 0) {
    lines.push("", `⚠️ ${failed.length} channel(s) could not be delivered. Contact support with: <code>${escapeHtml(chargeId)}</code>`);
  }

  /** @type {import("../types.js").InlineButton[][]} */
  const rows = delivered.map((item, i) => [{
    text: delivered.length === 1 ? `🔓 ${item.label}` : `🔓 ${item.label} ${i + 1}`,
    url: item.link,
  }]);

  rows.push([{ text: "🔙 Back to menu", callback_data: "menu" }]);

  await ctx.api.sendMessage(chatId, lines.join("\n"), { inline_keyboard: rows });
}

// ---------------------------------------------------------------------------
// /rejoin
// ---------------------------------------------------------------------------

/**
 * @param {number} chatId
 * @param {string} userId
 * @param {BotContext} ctx
 */
async function handleRejoin(chatId, userId, ctx) {
  const memberships = await getUserMemberships(userId);
  const active = memberships.filter((m) => m.status === "active");

  if (active.length === 0) {
    await ctx.api.sendMessage(chatId, "You don't have any active lifetime memberships yet.", menuBackKeyboard());
    return;
  }

  /** @type {import("../types.js").InlineButton[][]} */
  const rows = [];
  for (const m of active) {
    try {
      const expireDate = Math.floor(Date.now() / 1000) + 3600;
      const link = await ctx.api.createChatInviteLink(m.channelId, expireDate, 1);
      rows.push([{ text: "🔓 Rejoin Channel", url: link }]);
    } catch {
      // skip
    }
  }

  if (rows.length === 0) {
    await ctx.api.sendMessage(chatId, "Could not generate rejoin links. Please try again later.");
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    "🔄 <b>Rejoin Links</b>\n\nHere are your fresh invite links (expire in 1 hour):",
    { inline_keyboard: rows },
  );
}

// ---------------------------------------------------------------------------
// Keyboards
// ---------------------------------------------------------------------------

/**
 * @param {ResolvedPackage[]} packages
 * @returns {InlineKeyboard}
 */
function menuKeyboard(packages) {
  const rows = packages.map((pkg) => [{ text: pkg.name, callback_data: `pkg:${pkg.id}` }]);
  return { inline_keyboard: rows };
}

function menuBackKeyboard() {
  return { inline_keyboard: [[{ text: "🔙 Back to menu", callback_data: "menu" }]] };
}

/**
 * @param {string} packageId
 * @param {boolean} payable
 * @returns {InlineKeyboard}
 */
function detailsKeyboard(packageId, payable) {
  /** @type {import("../types.js").InlineButton[][]} */
  const rows = [];
  if (payable) {
    rows.push([{ text: "⭐ Pay with Stars", callback_data: `pay:${packageId}` }]);
  }
  rows.push([{ text: "🔙 Back to menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
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
