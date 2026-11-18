// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleBot1Update } from "../src/bots/bot1.js";
import { createMemoryRepository } from "../src/config/packages.js";
import { parseAdminCommand } from "../src/bots/admin.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** @typedef {{ method: string, args: unknown[] }} Call */

/**
 * @returns {{ api: import("../src/services/telegram.js").TelegramApi, calls: Call[] }}
 */
function mockApi() {
  /** @type {Call[]} */
  const calls = [];
  const noop = (method) => (...args) => { calls.push({ method, args }); return Promise.resolve(); };
  const noopReturn = (method, returnValue) => (...args) => { calls.push({ method, args }); return Promise.resolve(returnValue); };
  return {
    calls,
    api: {
      sendMessage: noop("sendMessage"),
      editMessageText: noop("editMessageText"),
      sendPhoto: noop("sendPhoto"),
      deleteMessage: noop("deleteMessage"),
      answerCallbackQuery: noop("answerCallbackQuery"),
      sendInvoice: noop("sendInvoice"),
      answerPreCheckoutQuery: noop("answerPreCheckoutQuery"),
      createChatInviteLink: noopReturn("createChatInviteLink", "https://t.me/+testinvite"),
      refundStarPayment: noop("refundStarPayment"),
      banChatMember: noop("banChatMember"),
    },
  };
}

/**
 * @param {import("../src/services/telegram.js").TelegramApi} api
 * @param {NodeJS.ProcessEnv} [env]
 * @param {import("../src/config/packages.js").PackageRepository} [repository]
 * @returns {import("../src/bots/context.js").BotContext}
 */
function makeCtx(api, env = {}, repository) {
  /** @type {import("../src/config/packages.js").PackageRecord[]} */
  const defaultPackages = [
    { id: "btn1", name: "Button 1", description: "Get Access to Button 1 categories.", priceLabel: "2,000", priceStars: 2000, active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: ["PACKAGE_BTN1_CHANNEL_ID"] },
    { id: "btn2", name: "Button 2", description: "Get Access to Button 2 categories.", priceLabel: "5,000", priceStars: 5000, active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: ["PACKAGE_BTN2_CHANNEL_ID"] },
    { id: "btn3", name: "Button 3", description: "Get Access to Button 3 categories.", priceLabel: "2,500", priceStars: 2500, active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: ["PACKAGE_BTN3_CHANNEL_ID"] },
  ];
  return {
    api,
    env: {
      PACKAGE_BTN1_CHANNEL_ID: "-1001111111111",
      PACKAGE_BTN2_CHANNEL_ID: "-1002222222222",
      PACKAGE_BTN3_CHANNEL_ID: "-1003333333333",
      ...env,
    },
    repository: repository ?? createMemoryRepository(defaultPackages),
    bot1Username: "testbot",
    bot2Username: null,
    adminIds: new Set(["99999"]),
  };
}

/** @param {string} text @param {number} [chatId] */
function startMsg(text, chatId = 1001) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e5),
      chat: { id: chatId, type: "private" },
      from: { id: 555, username: "testuser" },
      text,
    },
  };
}

/** @param {string} data @param {number} [chatId] */
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
// /start
// ---------------------------------------------------------------------------
describe("Bot 1 — /start", () => {
  it("shows menu on /start", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(startMsg("/start"), makeCtx(api));
    assert.ok(calls.length > 0);
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("Welcome")));
  });
});

// ---------------------------------------------------------------------------
// Package selection
// ---------------------------------------------------------------------------
describe("Bot 1 — package selection", () => {
  it("shows package details for valid package", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("pkg:btn1"), makeCtx(api));
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("Button 1")));
  });

  it("shows all packages in menu", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("menu"), makeCtx(api));
    const s = JSON.stringify(calls);
    assert.ok(s.includes("btn1") && s.includes("btn2") && s.includes("btn3"));
  });

  it("rejects invalid package id", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("pkg:../evil"), makeCtx(api));
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("not available")));
  });

  it("shows Pay with Stars button when payable", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("pkg:btn1"), makeCtx(api));
    assert.ok(JSON.stringify(calls).includes("pay:btn1"));
  });

  it("no pay button when channel id missing", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("pkg:btn1"), makeCtx(api, { PACKAGE_BTN1_CHANNEL_ID: "" }));
    assert.ok(!JSON.stringify(calls).includes("pay:btn1"));
  });
});

// ---------------------------------------------------------------------------
// Group chat
// ---------------------------------------------------------------------------
describe("Bot 1 — group chat", () => {
  it("prompts private chat in group", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update({
      update_id: 1,
      message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 555 }, text: "/start" },
    }, makeCtx(api));
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("private")));
  });
});

// ---------------------------------------------------------------------------
// Menu callback
// ---------------------------------------------------------------------------
describe("Bot 1 — menu callback", () => {
  it("shows menu on menu callback", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("menu"), makeCtx(api));
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("Welcome") || t.includes("category")));
  });
});

// ---------------------------------------------------------------------------
// Pay callback — sends invoice (KV not available in tests so channel missing = unavailable)
// ---------------------------------------------------------------------------
describe("Bot 1 — pay callback", () => {
  it("rejects pay callback for package with no channel id", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("pay:btn1"), makeCtx(api, { PACKAGE_BTN1_CHANNEL_ID: "" }));
    assert.ok(!calls.some((c) => c.method === "sendInvoice"), "No invoice when channel missing");
  });

  it("rejects pay callback for invalid package id", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update(callbackQuery("pay:../evil"), makeCtx(api));
    assert.ok(!calls.some((c) => c.method === "sendInvoice"), "No invoice for invalid id");
  });
});

// ---------------------------------------------------------------------------
// Pre-checkout
// ---------------------------------------------------------------------------
describe("Bot 1 — pre_checkout_query", () => {
  it("rejects pre-checkout with wrong currency", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update({
      update_id: 1,
      pre_checkout_query: {
        id: "pcq1",
        from: { id: 555 },
        currency: "USD",
        total_amount: 2000,
        invoice_payload: "test_order",
      },
    }, makeCtx(api));
    const s = JSON.stringify(calls);
    assert.ok(s.includes("answerPreCheckoutQuery"));
    assert.ok(s.includes("false"), "Should reject with ok:false");
  });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
describe("parseAdminCommand", () => {
  it("parses list", () => assert.equal(parseAdminCommand("/admin list")?.action, "list"));
  it("parses show", () => assert.equal(parseAdminCommand("/admin show btn1")?.action, "show"));
  it("parses add", () => assert.equal(parseAdminCommand("/admin add newpkg | New | Desc | 2000")?.action, "add"));
  it("returns null for non-admin", () => assert.equal(parseAdminCommand("/start"), null));
  it("defaults to help", () => assert.equal(parseAdminCommand("/admin")?.action, "help"));
});

describe("Bot 1 admin — authorization", () => {
  it("rejects unauthorized users", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update({
      update_id: 1,
      message: { message_id: 1, chat: { id: 1001, type: "private" }, from: { id: 12345 }, text: "/admin list" },
    }, makeCtx(api));
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("limited") || t.includes("administrator")));
  });

  it("allows configured admin to list packages", async () => {
    const { api, calls } = mockApi();
    await handleBot1Update({
      update_id: 1,
      message: { message_id: 1, chat: { id: 1001, type: "private" }, from: { id: 99999 }, text: "/admin list" },
    }, makeCtx(api));
    assert.ok(calls.flatMap((c) => c.args).map(String).some((t) => t.includes("Packages") || t.includes("btn")));
  });
});
