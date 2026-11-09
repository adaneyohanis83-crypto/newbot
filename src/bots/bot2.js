// @ts-check
import { deepLink, isValidPackageId, readStartCommand } from "../utils/validation.js";
import { isPayable, PackageConfigError, resolvePackage } from "../config/packages.js";
import { presentMessage } from "./present.js";
import { unavailableText, privateChatText, catalogUnavailableText } from "./text.js";
import {
  upsertUser,
  createOrder,
  getOrder,
  updateOrder,
  recordPayment,
  grantMembership,
  hasActiveMembership,
  incrementStats,
} from "../services/db.js";
import { escapeHtml } from "../utils/html.js";
import { checkRateLimit, cleanupRateLimits } from "../utils/rate-limit.js";

/**
 * @typedef {import("../types.js").TelegramUpdate} TelegramUpdate
 * @typedef {import("../types.js").InlineKeyboard} InlineKeyboard
 * @typedef {import("./context.js").BotContext} BotContext
 * @typedef {import("../config/packages.js").ResolvedPackage} ResolvedPackage
 */

/**
 * @param {TelegramUpdate} update
 * @param {BotContext} ctx
 */
export async function handleBot2Update(update, ctx) {
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

  // Rate limit by user ID
  const userId = String(message.from?.id ?? "");
  if (!userId) return;

  cleanupRateLimits();
  if (!checkRateLimit(userId)) {
    await ctx.api.sendMessage(message.chat.id, "⚠️ Too many requests. Please wait a minute and try again.");
    return;
  }

  const text = message.text.trim();
  const payload = readStartCommand(text);

  if (payload === null) {
    await ctx.api.sendMessage(
      message.chat.id,
      "Please select a category from the main bot first.",
      returnKeyboard(ctx),
    );
    return;
  }

  await showInvoice(message.chat.id, userId, message.from?.username ?? "", payload, ctx);
}

// ---------------------------------------------------------------------------
// Show invoice
// ---------------------------------------------------------------------------

/**
 * @param {number} chatId
 * @param {string} userId
 * @param {string} username
 * @param {string} payload
 * @param {BotContext} ctx
 */
async function showInvoice(chatId, userId, username, payload, ctx) {
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
  if (!pkg || !isPayable(pkg)) {
    await ctx.api.sendMessage(chatId, unavailableText(), back);
    return;
  }

  // Check if user already has lifetime access to ALL channels in this package
  if (userId) {
    const alreadyHasAll = await Promise.all(
      pkg.channelIds.map((ch) => hasActiveMembership(userId, ch))
    );
    if (alreadyHasAll.every(Boolean)) {
      await ctx.api.sendMessage(
        chatId,
        `✅ <b>You already have lifetime access to ${escapeHtml(pkg.name)}!</b>\n\nUse /rejoin to get fresh invite links.`,
        back,
      );
      return;
    }

    await upsertUser(userId, username);
  }

  // Create a pending order
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
// Pre-checkout verification
// ---------------------------------------------------------------------------

/**
 * @param {NonNullable<TelegramUpdate["pre_checkout_query"]>} query
 * @param {BotContext} ctx
 */
async function handlePreCheckout(query, ctx) {
  const { id, from, invoice_payload, currency, total_amount } = query;

  // Must be XTR
  if (currency !== "XTR") {
    await ctx.api.answerPreCheckoutQuery(id, false, "Invalid currency.");
    return;
  }

  // Look up the order
  const order = await getOrder(invoice_payload);
  if (!order) {
    await ctx.api.answerPreCheckoutQuery(id, false, "Order not found. Please start again from the main bot.");
    return;
  }

  // Verify ownership
  if (order.userId !== String(from.id)) {
    await ctx.api.answerPreCheckoutQuery(id, false, "This invoice does not belong to you.");
    return;
  }

  // Verify status
  if (order.status !== "pending") {
    await ctx.api.answerPreCheckoutQuery(id, false, "This order has already been processed.");
    return;
  }

  // Verify amount
  if (order.amount !== total_amount) {
    await ctx.api.answerPreCheckoutQuery(id, false, "Invoice amount mismatch.");
    return;
  }

  // Verify package still active
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

  // All checks passed — approve
  await ctx.api.answerPreCheckoutQuery(id, true);
}

// ---------------------------------------------------------------------------
// Successful payment handler
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

  // Verify currency
  if (currency !== "XTR") {
    await ctx.api.sendMessage(chatId, "⚠️ Unexpected payment currency. Please contact support.");
    return;
  }

  // Verify order
  const order = await getOrder(orderId);
  if (!order) {
    await ctx.api.sendMessage(chatId, "⚠️ Order not found. Please contact support with your payment ID: " + telegram_payment_charge_id);
    return;
  }

  // Verify user
  if (order.userId !== userId) {
    await ctx.api.sendMessage(chatId, "⚠️ Payment verification failed.");
    return;
  }

  // Verify amount
  if (order.amount !== total_amount) {
    await ctx.api.sendMessage(chatId, "⚠️ Payment amount mismatch. Please contact support.");
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

  // If payment was already processed (duplicate webhook), skip
  if (existingPayment.paidAt !== new Date(existingPayment.paidAt).toISOString() && order.status === "paid") {
    return;
  }

  // Mark order as paid
  await updateOrder(orderId, {
    status: "paid",
    paidAt: new Date().toISOString(),
    telegramChargeId: telegram_payment_charge_id,
  });

  await incrementStats(total_amount);

  // Resolve package
  let pkg;
  try {
    const packages = ctx.repository.load().map((record) => resolvePackage(record, ctx.env));
    pkg = packages.find((p) => p.id === order.packageId);
  } catch {
    await ctx.api.sendMessage(chatId, "✅ Payment received! However, there was an issue delivering your access. Please contact support with: " + telegram_payment_charge_id);
    return;
  }

  if (!pkg) {
    await ctx.api.sendMessage(chatId, "✅ Payment received! Package configuration error. Please contact support with: " + telegram_payment_charge_id);
    return;
  }

  // Grant memberships and generate invite links
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
      // Generate a one-time invite link (expires in 1 hour, member_limit: 1)
      const expireDate = Math.floor(Date.now() / 1000) + 3600;
      const inviteLink = await ctx.api.createChatInviteLink(channelId, expireDate, 1);

      // Record lifetime membership
      await grantMembership(userId, channelId, pkg.id, orderId);

      delivered.push({ label: `Join Channel`, link: inviteLink });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`Failed to create invite for channel ${channelId}: ${msg}`);
      failed.push(channelId);
    }
  }

  if (delivered.length === 0) {
    await ctx.api.sendMessage(
      chatId,
      `✅ Payment of ${pkg.priceStars.toLocaleString()} ⭐ confirmed!\n\n⚠️ There was an issue delivering your channel access. Your payment is recorded.\n\nPlease contact support with payment ID:\n<code>${escapeHtml(chargeId)}</code>`,
    );
    return;
  }

  // Build success message
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

  await ctx.api.sendMessage(chatId, lines.join("\n"), { inline_keyboard: rows });
}

// ---------------------------------------------------------------------------
// /rejoin command — resend invite links without charging again
// ---------------------------------------------------------------------------

/**
 * @param {number} chatId
 * @param {string} userId
 * @param {BotContext} ctx
 */
export async function handleRejoin(chatId, userId, ctx) {
  const { getUserMemberships } = await import("../services/db.js");
  const memberships = await getUserMemberships(userId);
  const active = memberships.filter((m) => m.status === "active");

  if (active.length === 0) {
    await ctx.api.sendMessage(chatId, "You don't have any active lifetime memberships yet.", returnKeyboard(ctx));
    return;
  }

  /** @type {import("../types.js").InlineButton[][]} */
  const rows = [];
  for (const m of active) {
    try {
      const expireDate = Math.floor(Date.now() / 1000) + 3600;
      const link = await ctx.api.createChatInviteLink(m.channelId, expireDate, 1);
      rows.push([{ text: `🔓 Rejoin Channel`, url: link }]);
    } catch {
      // skip if invite creation fails
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

/**
 * @param {BotContext} ctx
 * @returns {InlineKeyboard | undefined}
 */
function returnKeyboard(ctx) {
  if (!ctx.bot1Username) return undefined;
  return {
    inline_keyboard: [[{ text: "🔙 Back to menu", url: deepLink(ctx.bot1Username, "menu") }]],
  };
}
