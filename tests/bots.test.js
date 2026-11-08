// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleBot1Update } from "../src/bots/bot1.js";
import { handleBot2Update } from "../src/bots/bot2.js";
import { createBotContext } from "../src/bots/context.js";
import { createMemoryRepository } from "../src/config/packages.js";
import { parseAdminCommand } from "../src/bots/admin.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * @typedef {{ method: string, args: unknown[] }} Call
 */

/**
 * Creates a mock Telegram API that records every call made to it.
 * @returns {{ api: import("../src/services/telegram.js").TelegramApi, calls: Call[] }}
 */
function mockApi() {
  /** @type {Call[]} */
  const calls = [];
  const noop = (method) => (...args) => { calls.push({ method, args }); return Promise.resolve(); };
  return {
    calls,
    api: {
      sendMessage: noop("sendMessage"),
      editMessageText: noop("editMessageText"),
      sendPhoto: noop("sendPhoto"),
      deleteMessage: noop("deleteMessage"),
      answerCallbackQuery: noop("answerCallbackQuery"),
    },
  };
}

/**
 * @param {import("../src/services/telegram.js").TelegramApi} api
 * @param {string | null} bot1Username
 * @param {string | null} bot2Username
 * @param {NodeJS.ProcessEnv} [env]
 * @param {import("../src/config/packages.js").PackageRepository} [repository]
 * @returns {import("../src/bots/context.js").BotContext}
 */
function makeCtx(api, bot1Username, bot2Username, env = {}, repository) {
  /** @type {import("../src/config/packages.js").PackageRecord[]} */
  const defaultPackages = [
    { id: "basic", name: "Basic Package", description: "Desc", priceLabel: "100 Stars", active: true, imageUrl: "", inviteLinkEnv: "PACKAGE_BASIC_INVITE_LINK" },
    { id: "premium", name: "Premium Package", description: "Desc", priceLabel: "250 Stars", active: true, imageUrl: "", inviteLinkEnv: "PACKAGE_PREMIUM_INVITE_LINK" },
    { id: "vip", name: "VIP Package", description: "Desc", priceLabel: "500 Stars", active: true, imageUrl: "", inviteLinkEnv: "PACKAGE_VIP_INVITE_LINK" },
  ];
  return {
    api,
    env: {
      PACKAGE_BASIC_INVITE_LINK: "https://t.me/+basiclink",
      PACKAGE_PREMIUM_INVITE_LINK: "https://t.me/+premiumlink",
      PACKAGE_VIP_INVITE_LINK: "https://t.me/+viplink",
      ...env,
    },
    repository: repository ?? createMemoryRepository(defaultPackages),
    bot1Username,
    bot2Username,
    adminIds: new Set(["99999"]),
  };
}

/**
 * Creates a /start message update.
 * @param {string} text
 * @param {number} [chatId]
 */
function startMsg(text, chatId = 1001) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e5),
      chat: { id: chatId, type: "private" },
      from: { id: 555 },
      text,
    },
  };
}

/**
 * Creates a callback_query update.
 * @param {string} data
 * @param {number} [chatId]
 */
function callbackQuery(data, chatId = 1001) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: "cq1",
      data,
      from: { id: 555 },
      message: {
        message_id: 42,
        chat: { id: chatId, type: "private" },
        from: { id: 0 },
        text: "menu",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Bot 1 — /start command
// ---------------------------------------------------------------------------
describe("Bot 1 — /start", () => {
  it("sends a welcome message on /start", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update(startMsg("/start"), ctx);
    assert.ok(calls.length > 0, "Expected at least one API call");
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("Welcome")), "Welcome message expected");
  });

  it("shows the menu when /start menu is sent", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update(startMsg("/start menu"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("package") || t.includes("Package")), "Menu text expected");
  });
});

// ---------------------------------------------------------------------------
// Bot 1 — package selection callbacks
// ---------------------------------------------------------------------------
describe("Bot 1 — package selection", () => {
  it("shows package details when a valid package is selected", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update(callbackQuery("pkg:basic"), ctx);
    // answerCallbackQuery + editMessageText/sendMessage
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("Basic Package")), "Package name expected in output");
  });

  it("shows all three default packages in the menu", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update(callbackQuery("menu"), ctx);
    const serialized = JSON.stringify(calls);
    assert.ok(serialized.includes("basic"), "basic package expected");
    assert.ok(serialized.includes("premium"), "premium package expected");
    assert.ok(serialized.includes("vip"), "vip package expected");
  });

  it("rejects an invalid package id in a callback", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update(callbackQuery("pkg:../evil"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("not available")), "Rejection message expected");
  });

  it("shows the continue-to-payment button when bot2Username is set and package is payable", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2username");
    await handleBot1Update(callbackQuery("pkg:premium"), ctx);
    const serialized = JSON.stringify(calls);
    assert.ok(serialized.includes("bot2username"), "Deep link to bot2 expected");
    assert.ok(serialized.includes("premium"), "Package id in deep link expected");
  });

  it("does not show continue button when package invite link is missing", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2", { PACKAGE_BASIC_INVITE_LINK: "" });
    await handleBot1Update(callbackQuery("pkg:basic"), ctx);
    const serialized = JSON.stringify(calls);
    assert.ok(!serialized.includes("Continue to payment"), "No payment button when link is missing");
  });
});

// ---------------------------------------------------------------------------
// Bot 1 — group chat
// ---------------------------------------------------------------------------
describe("Bot 1 — group chat", () => {
  it("prompts private chat when message arrives in a group", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update({
      update_id: 1,
      message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 555 }, text: "/start" },
    }, ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("private")), "Private chat prompt expected");
  });
});

// ---------------------------------------------------------------------------
// Bot 1 — home button
// ---------------------------------------------------------------------------
describe("Bot 1 — home callback", () => {
  it("returns to the welcome screen on home callback", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update(callbackQuery("home"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("Welcome")), "Welcome screen expected");
  });
});

// ---------------------------------------------------------------------------
// Bot 2 — /start without package
// ---------------------------------------------------------------------------
describe("Bot 2 — /start without package", () => {
  it("prompts user to come from bot1 when /start has no payload", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot2Update(startMsg("/start"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("main bot") || t.includes("package")), "Guidance message expected");
  });
});

// ---------------------------------------------------------------------------
// Bot 2 — valid package deep link
// ---------------------------------------------------------------------------
describe("Bot 2 — valid package deep link", () => {
  it("shows payment info for a valid package", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot2Update(startMsg("/start premium"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("Premium Package")), "Package name expected");
  });

  it("includes the correct Stars invite link button", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot2Update(startMsg("/start premium"), ctx);
    const serialized = JSON.stringify(calls);
    assert.ok(serialized.includes("premiumlink"), "Stars invite link expected in button");
    assert.ok(serialized.includes("⭐"), "Stars emoji expected");
  });

  it("uses different links for different packages", async () => {
    const { api: api1, calls: calls1 } = mockApi();
    const { api: api2, calls: calls2 } = mockApi();
    const ctx1 = makeCtx(api1, "bot1", "bot2");
    const ctx2 = makeCtx(api2, "bot1", "bot2");
    await handleBot2Update(startMsg("/start basic"), ctx1);
    await handleBot2Update(startMsg("/start vip"), ctx2);
    const s1 = JSON.stringify(calls1);
    const s2 = JSON.stringify(calls2);
    assert.ok(s1.includes("basiclink"), "basic link expected");
    assert.ok(s2.includes("viplink"), "vip link expected");
    assert.ok(!s1.includes("viplink"), "vip link must not appear in basic response");
    assert.ok(!s2.includes("basiclink"), "basic link must not appear in vip response");
  });
});

// ---------------------------------------------------------------------------
// Bot 2 — invalid / inactive packages
// ---------------------------------------------------------------------------
describe("Bot 2 — invalid package handling", () => {
  it("rejects an unknown package id", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot2Update(startMsg("/start unknown_pkg_xyz"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("not available")), "Rejection message expected");
  });

  it("rejects an inactive package", async () => {
    const repo = createMemoryRepository([
      { id: "hidden", name: "Hidden", description: "", priceLabel: "", active: false, imageUrl: "", inviteLinkEnv: "HIDDEN_LINK" },
    ]);
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2", { HIDDEN_LINK: "https://t.me/+hidden" }, repo);
    await handleBot2Update(startMsg("/start hidden"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("not available")), "Inactive package should be rejected");
  });

  it("rejects a package whose invite link is not configured", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2", {
      PACKAGE_BASIC_INVITE_LINK: "",
      PACKAGE_PREMIUM_INVITE_LINK: "https://t.me/+premiumlink",
      PACKAGE_VIP_INVITE_LINK: "https://t.me/+viplink",
    });
    await handleBot2Update(startMsg("/start basic"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("not available")), "Missing invite link should cause rejection");
  });

  it("rejects a path-traversal-style package id", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot2Update(startMsg("/start ../etc/passwd"), ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    // Either rejects as not available or prompts to use the main bot
    assert.ok(texts.length > 0, "Some response expected for malformed input");
    const anyPaymentButton = JSON.stringify(calls).includes("Pay with Telegram Stars");
    assert.ok(!anyPaymentButton, "No payment button for invalid input");
  });
});

// ---------------------------------------------------------------------------
// Bot 2 — return to bot1
// ---------------------------------------------------------------------------
describe("Bot 2 — return to bot1 link", () => {
  it("includes a link back to bot1 when bot1Username is set", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "mybot1", "bot2");
    await handleBot2Update(startMsg("/start unknown"), ctx);
    const serialized = JSON.stringify(calls);
    assert.ok(serialized.includes("mybot1"), "Return link to bot1 expected");
  });
});

// ---------------------------------------------------------------------------
// Admin command parser
// ---------------------------------------------------------------------------
describe("parseAdminCommand", () => {
  it("parses list", () => {
    const result = parseAdminCommand("/admin list");
    assert.equal(result?.action, "list");
    assert.equal(result?.rest, "");
  });

  it("parses show with id", () => {
    const result = parseAdminCommand("/admin show premium");
    assert.equal(result?.action, "show");
    assert.equal(result?.rest, "premium");
  });

  it("parses add with pipe-separated fields", () => {
    const result = parseAdminCommand("/admin add newpkg | New Package | A description | 100 Stars");
    assert.equal(result?.action, "add");
    assert.ok(result?.rest.includes("newpkg"));
  });

  it("returns null for non-admin commands", () => {
    assert.equal(parseAdminCommand("/start"), null);
  });

  it("defaults to help when no subcommand is given", () => {
    const result = parseAdminCommand("/admin");
    assert.equal(result?.action, "help");
  });
});

// ---------------------------------------------------------------------------
// Admin — authorization
// ---------------------------------------------------------------------------
describe("Bot 1 admin — authorization", () => {
  it("rejects unauthorized users", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1001, type: "private" },
        from: { id: 12345 }, // not in adminIds (99999)
        text: "/admin list",
      },
    }, ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("limited") || t.includes("administrator")), "Auth rejection message expected");
  });

  it("allows the configured admin to list packages", async () => {
    const { api, calls } = mockApi();
    const ctx = makeCtx(api, "bot1", "bot2");
    await handleBot1Update({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1001, type: "private" },
        from: { id: 99999 }, // matches adminIds
        text: "/admin list",
      },
    }, ctx);
    const texts = calls.flatMap((c) => c.args).map(String);
    assert.ok(texts.some((t) => t.includes("Packages") || t.includes("basic")), "Package list expected for admin");
  });
});
