// @ts-check
import { escapeHtml } from "../utils/html.js";

/**
 * @param {import("../config/packages.js").ResolvedPackage} pkg
 */
function starsPrice(pkg) {
  return `⭐ ${escapeHtml(pkg.priceLabel)}`;
}

export function welcomeText() {
  return [
    "👋 <b>Welcome!</b>",
    "",
    "Choose a category below:",
  ].join("\n");
}

/**
 * @param {number} activeCount
 */
export function menuText(activeCount) {
  if (activeCount === 0) {
    return "👋 <b>Welcome!</b>\n\nNo categories are available right now. Please check back later.";
  }
  return "👋 <b>Welcome!</b>\n\nChoose a category below:";
}

/**
 * @param {import("../config/packages.js").ResolvedPackage} pkg
 * @param {{ payable: boolean, usernameReady: boolean }} state
 */
export function selectionText(pkg, state) {
  const lines = [
    "Good choice! 👋",
    "",
    `<b>${escapeHtml(pkg.name)}</b>`,
    "",
    escapeHtml(pkg.description),
    "",
    `💰 Price: ${starsPrice(pkg)}`,
  ];

  if (!state.payable) {
    lines.push("", "⚠️ This category is not available for payment yet.");
  }

  return lines.join("\n");
}

/**
 * @param {import("../config/packages.js").ResolvedPackage} pkg
 */
export function paymentText(pkg) {
  return [
    `<b>${escapeHtml(pkg.name)}</b>`,
    "",
    escapeHtml(pkg.description),
  ].join("\n");
}

export function unavailableText() {
  return [
    "⚠️ <b>Category not available</b>",
    "",
    "This category is missing or inactive.",
    "Please return to the menu and choose another.",
  ].join("\n");
}

export function privateChatText() {
  return "Please message this bot in a private chat.";
}

export function catalogUnavailableText() {
  return "The category list is temporarily unavailable. Please try again later.";
}
