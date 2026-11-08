// @ts-check
import { escapeHtml } from "../utils/html.js";

/**
 * @param {import("../config/packages.js").ResolvedPackage} pkg
 */
function priceLine(pkg) {
  const price = pkg.priceLabel || "Shown by Telegram when you open the paid invite";
  return `<b>Price:</b> ${escapeHtml(price)}`;
}

export function welcomeText() {
  return [
    "<b>Welcome</b>",
    "",
    "Choose a package, review the details, then continue to payment.",
    "",
    "Payment uses a Telegram Stars paid-channel invite. The Stars charge is a channel subscription, usually 30 days.",
    "",
    "Tap Start to see the available packages.",
  ].join("\n");
}

/**
 * @param {number} activeCount
 */
export function menuText(activeCount) {
  if (activeCount === 0) {
    return "<b>Packages</b>\n\nNo packages are available right now. Please check back later.";
  }
  return "<b>Choose a package</b>\n\nSelect one to view the details and continue to payment.";
}

/**
 * @param {import("../config/packages.js").ResolvedPackage} pkg
 * @param {{ payable: boolean, usernameReady: boolean }} state
 */
export function selectionText(pkg, state) {
  const lines = [
    `<b>${escapeHtml(pkg.name)}</b>`,
    "",
    escapeHtml(pkg.description || "Channel access package."),
    "",
    priceLine(pkg),
    "<b>Billing:</b> Telegram Stars paid-channel subscription, usually 30 days.",
    "",
    "Each package opens its own paid channel. Inside that channel you can find the private links to the destination channels included in the package. Destination-channel access is separate from the Stars subscription.",
  ];

  if (!state.payable) {
    lines.push("", "This package cannot be paid yet because its Stars invite link is not configured.");
  } else if (!state.usernameReady) {
    lines.push("", "The payment bot username is not configured yet.");
  } else {
    lines.push("", "Continue to the payment bot. It will open this package’s Stars invite.");
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
    escapeHtml(pkg.description || "Channel access package."),
    "",
    priceLine(pkg),
    "<b>Billing:</b> Telegram Stars paid-channel subscription, usually 30 days.",
    "",
    "Tap the button to open this package’s Telegram Stars paid-channel invite. Telegram handles the Stars payment and grants access to that private channel when the subscription succeeds.",
    "",
    "Inside that paid channel you can find the private links to the destination channels included in this package. Destination-channel access is separate from the Stars subscription.",
    "",
    "Telegram confirms the subscription. The button opens the invite for this package.",
  ].join("\n");
}

export function unavailableText() {
  return [
    "<b>This package is not available</b>",
    "",
    "The package is missing, inactive, or its Stars invite link is not configured.",
    "No payment button is shown for this request.",
    "",
    "Return to the main bot and choose an available package.",
  ].join("\n");
}

export function privateChatText() {
  return "Please message this bot in a private chat.";
}

export function catalogUnavailableText() {
  return "The package list is temporarily unavailable. Please try again later.";
}
