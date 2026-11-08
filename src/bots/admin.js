// @ts-check
import { escapeHtml } from "../utils/html.js";
import {
  containsLink,
  defaultInviteEnv,
  isValidPackageId,
  sanitizeImageUrl,
} from "../utils/validation.js";
import {
  inviteStatus,
  packagesSharingInvite,
} from "../config/packages.js";

/**
 * @typedef {import("../types.js").TelegramMessage} TelegramMessage
 * @typedef {import("./context.js").BotContext} BotContext
 * @typedef {import("../config/packages.js").PackageRecord} PackageRecord
 */

const LINK_REJECTION = "That value was rejected because it looks like a link. Set the Stars invite link in an environment variable. It was not saved.";

const HELP = [
  "<b>Package admin</b>",
  "",
  "/admin list",
  "/admin show &lt;id&gt;",
  "/admin enable &lt;id&gt;",
  "/admin disable &lt;id&gt;",
  "/admin add &lt;id&gt; | &lt;name&gt; | &lt;description&gt; | &lt;price&gt;",
  "/admin set-name &lt;id&gt; | &lt;name&gt;",
  "/admin set-description &lt;id&gt; | &lt;description&gt;",
  "/admin set-price &lt;id&gt; | &lt;price&gt;",
  "/admin set-image &lt;id&gt; | &lt;https-url or -&gt;",
  "",
  "Stars invite links are not edited in chat. /admin show names the environment variable for that package, such as PACKAGE_PREMIUM_INVITE_LINK.",
  "Put the https link of that package’s own Telegram Stars paid channel in the variable. Each package needs its own link.",
  "",
  "Disk edits may not persist on Vercel. Edit config/packages.json and redeploy, or set PACKAGES_JSON. Keep invite URLs out of that JSON.",
].join("\n");

/**
 * @param {string} text
 * @returns {{ action: string, rest: string } | null}
 */
export function parseAdminCommand(text) {
  const match = text.trim().match(/^\/admin(?:@\w+)?(?:\s+(\S+))?(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return {
    action: (match[1] ?? "help").toLowerCase(),
    rest: (match[2] ?? "").trim(),
  };
}

/**
 * @param {TelegramMessage} message
 * @param {BotContext} ctx
 */
export async function handleAdminMessage(message, ctx) {
  const userId = String(message.from?.id ?? "");
  if (!ctx.adminIds.has(userId)) {
    const suffix = userId ? ` Your Telegram user id is ${userId}.` : "";
    await ctx.api.sendMessage(message.chat.id, `Admin commands are limited to the configured administrator.${suffix}`);
    return;
  }

  const parsed = parseAdminCommand(message.text ?? "");
  if (!parsed || parsed.action === "help") {
    await ctx.api.sendMessage(message.chat.id, HELP);
    return;
  }

  let records;
  try {
    records = ctx.repository.load();
  } catch {
    await ctx.api.sendMessage(message.chat.id, "The package configuration could not be read.");
    return;
  }

  switch (parsed.action) {
    case "list":
      await ctx.api.sendMessage(message.chat.id, listText(records, ctx.env));
      return;
    case "show":
      await showPackage(message.chat.id, parsed.rest, records, ctx);
      return;
    case "enable":
    case "disable":
      await setActive(message.chat.id, parsed.rest, parsed.action === "enable", records, ctx);
      return;
    case "add":
      await addPackage(message.chat.id, parsed.rest, records, ctx);
      return;
    case "set-name":
    case "set-description":
    case "set-price":
    case "set-image":
      await setField(message.chat.id, parsed.action, parsed.rest, records, ctx);
      return;
    default:
      await ctx.api.sendMessage(message.chat.id, HELP);
  }
}

/**
 * @param {PackageRecord[]} records
 * @param {NodeJS.ProcessEnv} env
 */
function listText(records, env) {
  if (records.length === 0) return "<b>Packages</b>\n\nNo packages are configured.";
  const lines = ["<b>Packages</b>", ""];
  for (const record of records) {
    const mark = record.active ? "●" : "○";
    lines.push(`${mark} <b>${escapeHtml(record.name)}</b> (${escapeHtml(record.id)}) — invite ${inviteStatus(record, env)}`);
  }
  return lines.join("\n");
}

/**
 * @param {number} chatId
 * @param {string} rawId
 * @param {PackageRecord[]} records
 * @param {BotContext} ctx
 */
async function showPackage(chatId, rawId, records, ctx) {
  const record = findRecord(records, rawId);
  if (!record) {
    await ctx.api.sendMessage(chatId, "No package with that id exists.");
    return;
  }
  await ctx.api.sendMessage(chatId, summaryText(record, records, ctx.env));
}

/**
 * @param {PackageRecord} record
 * @param {PackageRecord[]} records
 * @param {NodeJS.ProcessEnv} env
 */
function summaryText(record, records, env) {
  const shared = packagesSharingInvite(records, env, record.id);
  const lines = [
    `<b>${escapeHtml(record.name)}</b>`,
    "",
    `<b>ID:</b> ${escapeHtml(record.id)}`,
    `<b>Active:</b> ${record.active ? "yes" : "no"}`,
    `<b>Price:</b> ${escapeHtml(record.priceLabel || "(not set)")}`,
    `<b>Description:</b> ${escapeHtml(record.description || "(not set)")}`,
    `<b>Image:</b> ${record.imageUrl ? "set" : "none"}`,
    `<b>Invite variable:</b> ${escapeHtml(record.inviteLinkEnv)}`,
    `<b>Invite status:</b> ${inviteStatus(record, env)}`,
  ];
  if (shared.length > 0) {
    lines.push(`<b>Warning:</b> this invite link is also used by ${shared.map((id) => escapeHtml(id)).join(", ")}.`);
  }
  return lines.join("\n");
}

/**
 * @param {number} chatId
 * @param {string} rawId
 * @param {boolean} active
 * @param {PackageRecord[]} records
 * @param {BotContext} ctx
 */
async function setActive(chatId, rawId, active, records, ctx) {
  const id = rawId.trim().toLowerCase();
  if (!isValidPackageId(id)) {
    await ctx.api.sendMessage(chatId, "Use a package id such as basic, premium, or vip.");
    return;
  }
  if (!records.some((record) => record.id === id)) {
    await ctx.api.sendMessage(chatId, "No package with that id exists.");
    return;
  }
  const next = records.map((record) => (record.id === id ? { ...record, active } : record));
  await saveAndConfirm(chatId, id, next, ctx, active ? "enabled" : "disabled");
}

/**
 * @param {number} chatId
 * @param {string} rest
 * @param {PackageRecord[]} records
 * @param {BotContext} ctx
 */
async function addPackage(chatId, rest, records, ctx) {
  const parts = rest.split("|").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4) {
    await ctx.api.sendMessage(chatId, "Use /admin add id | name | description | price");
    return;
  }
  const [rawId, name, description = "", priceLabel = ""] = parts;
  const id = rawId.toLowerCase();
  if (!isValidPackageId(id)) {
    await ctx.api.sendMessage(chatId, "Package ids use lowercase letters, numbers, underscores, and hyphens, and must start with a letter or number.");
    return;
  }
  if (records.some((record) => record.id === id)) {
    await ctx.api.sendMessage(chatId, "That package id already exists.");
    return;
  }
  if (records.length >= 30) {
    await ctx.api.sendMessage(chatId, "The package limit is 30.");
    return;
  }
  if ([name, description, priceLabel].some((value) => containsLink(value))) {
    await ctx.api.sendMessage(chatId, LINK_REJECTION);
    return;
  }
  const inviteLinkEnv = defaultInviteEnv(id);
  if (records.some((record) => record.inviteLinkEnv === inviteLinkEnv)) {
    await ctx.api.sendMessage(chatId, "That id would share an invite variable with another package. Choose a different id.");
    return;
  }
  if (!name) {
    await ctx.api.sendMessage(chatId, "A package name is required.");
    return;
  }

  /** @type {PackageRecord} */
  const created = {
    id,
    name,
    description,
    priceLabel,
    active: false,
    imageUrl: "",
    inviteLinkEnv,
  };
  await saveAndConfirm(chatId, id, [...records, created], ctx, "added and left inactive until you enable it");
}

/**
 * @param {number} chatId
 * @param {string} action
 * @param {string} rest
 * @param {PackageRecord[]} records
 * @param {BotContext} ctx
 */
async function setField(chatId, action, rest, records, ctx) {
  const separator = rest.indexOf("|");
  if (separator === -1) {
    await ctx.api.sendMessage(chatId, "Use a vertical bar between the package id and the new value.");
    return;
  }
  const id = rest.slice(0, separator).trim().toLowerCase();
  const value = rest.slice(separator + 1).trim();
  if (!isValidPackageId(id) || !records.some((record) => record.id === id)) {
    await ctx.api.sendMessage(chatId, "No package with that id exists.");
    return;
  }

  /** @type {Partial<PackageRecord>} */
  let patch;
  if (action === "set-image") {
    if (value === "-") {
      patch = { imageUrl: "" };
    } else {
      const imageUrl = sanitizeImageUrl(value);
      if (!imageUrl) {
        await ctx.api.sendMessage(chatId, "Send an https image URL, or - to clear the image.");
        return;
      }
      patch = { imageUrl };
    }
  } else {
    if (containsLink(value)) {
      await ctx.api.sendMessage(chatId, LINK_REJECTION);
      return;
    }
    if (action === "set-name") {
      if (!value) {
        await ctx.api.sendMessage(chatId, "A package name is required.");
        return;
      }
      patch = { name: value };
    } else if (action === "set-description") {
      patch = { description: value };
    } else {
      patch = { priceLabel: value };
    }
  }

  const next = records.map((record) => (record.id === id ? { ...record, ...patch } : record));
  await saveAndConfirm(chatId, id, next, ctx, "updated");
}

/**
 * @param {number} chatId
 * @param {string} id
 * @param {PackageRecord[]} next
 * @param {BotContext} ctx
 * @param {string} verb
 */
async function saveAndConfirm(chatId, id, next, ctx, verb) {
  const result = await ctx.repository.save(next);
  if (!result.ok) {
    await ctx.api.sendMessage(chatId, escapeHtml(result.message || "The package list could not be saved."));
    return;
  }
  const saved = ctx.repository.load().find((record) => record.id === id);
  const lead = saved ? `<b>${escapeHtml(saved.name)}</b> was ${escapeHtml(verb)}.` : `Package ${escapeHtml(id)} was ${escapeHtml(verb)}.`;
  const summary = saved ? `\n\n${summaryText(saved, ctx.repository.load(), ctx.env)}` : "";
  await ctx.api.sendMessage(chatId, `${lead}${summary}`);
}

/**
 * @param {PackageRecord[]} records
 * @param {string} rawId
 */
function findRecord(records, rawId) {
  const id = rawId.trim().toLowerCase();
  if (!isValidPackageId(id)) return undefined;
  return records.find((record) => record.id === id);
}
