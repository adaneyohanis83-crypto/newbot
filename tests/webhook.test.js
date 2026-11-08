// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processWebhook, headerValue, parseUpdate } from "../src/http/process-webhook.js";
import { hasSeenUpdate, rememberUpdate, resetSeenUpdates } from "../src/services/dedupe.js";
import { secretsMatch } from "../src/utils/secrets.js";

// ---------------------------------------------------------------------------
// secretsMatch
// ---------------------------------------------------------------------------
describe("secretsMatch", () => {
  it("returns true for identical values", () => {
    assert.ok(secretsMatch("my-secret", "my-secret"));
  });

  it("returns false for different values", () => {
    assert.ok(!secretsMatch("correct", "wrong"));
  });

  it("returns false when expected is undefined", () => {
    assert.ok(!secretsMatch(undefined, "anything"));
  });

  it("returns false when expected is empty", () => {
    assert.ok(!secretsMatch("", "anything"));
  });

  it("returns false when expected is whitespace only", () => {
    assert.ok(!secretsMatch("  ", "  "));
  });
});

// ---------------------------------------------------------------------------
// headerValue
// ---------------------------------------------------------------------------
describe("headerValue", () => {
  it("returns the header value by name", () => {
    assert.equal(headerValue({ "x-custom": "hello" }, "x-custom"), "hello");
  });

  it("returns the value when the key casing matches exactly", () => {
    // headerValue looks up by exact key name first, then by lowercase.
    // Pass the same casing as used internally by Vercel (lowercase).
    assert.equal(headerValue({ "x-custom": "hello" }, "x-custom"), "hello");
  });

  it("falls back to lowercase lookup when mixed-case header is provided", () => {
    // If the header arrives capitalised, the lowercase fallback handles it.
    assert.equal(headerValue({ "X-Custom": "hello" }, "X-Custom"), "hello");
  });

  it("returns the first value when the header is an array", () => {
    assert.equal(headerValue({ "x-custom": ["first", "second"] }, "x-custom"), "first");
  });

  it("returns empty string for missing headers", () => {
    assert.equal(headerValue({}, "x-missing"), "");
  });
});

// ---------------------------------------------------------------------------
// parseUpdate
// ---------------------------------------------------------------------------
describe("parseUpdate", () => {
  it("parses a plain object", () => {
    const input = { update_id: 1, message: {} };
    assert.deepEqual(parseUpdate(input), input);
  });

  it("parses a JSON string", () => {
    const input = '{"update_id":2}';
    assert.deepEqual(parseUpdate(input), { update_id: 2 });
  });

  it("parses a Buffer containing JSON", () => {
    const buf = Buffer.from('{"update_id":3}', "utf8");
    assert.deepEqual(parseUpdate(buf), { update_id: 3 });
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseUpdate("not json"), null);
  });

  it("returns null for an array", () => {
    assert.equal(parseUpdate([]), null);
  });

  it("returns null for null", () => {
    assert.equal(parseUpdate(null), null);
  });
});

// ---------------------------------------------------------------------------
// dedupe
// ---------------------------------------------------------------------------
describe("dedupe", () => {
  it("returns false for an unseen update", () => {
    resetSeenUpdates();
    assert.ok(!hasSeenUpdate("testbot", 100));
  });

  it("returns true after an update is remembered", () => {
    resetSeenUpdates();
    rememberUpdate("testbot", 200);
    assert.ok(hasSeenUpdate("testbot", 200));
  });

  it("does not cross-contaminate bot names", () => {
    resetSeenUpdates();
    rememberUpdate("bot1", 300);
    assert.ok(!hasSeenUpdate("bot2", 300));
  });

  it("keeps only the last MAX_SEEN entries", () => {
    resetSeenUpdates();
    for (let i = 0; i < 510; i++) rememberUpdate("cap-test", i);
    // Entries 0–9 should have been dropped; 500–509 should be present
    assert.ok(!hasSeenUpdate("cap-test", 0), "Early entry should have been evicted");
    assert.ok(hasSeenUpdate("cap-test", 509), "Latest entry should be present");
  });
});

// ---------------------------------------------------------------------------
// processWebhook — method gating
// ---------------------------------------------------------------------------
describe("processWebhook — method handling", () => {
  /** @returns {{ res: import("../src/http/process-webhook.js").HttpResponse, result: { code?: number, body?: unknown } }} */
  function mockRes() {
    const result = {};
    const res = {
      status(code) {
        result.code = code;
        return { json(body) { result.body = body; } };
      },
    };
    return { res, result };
  }

  it("returns 200 ok for GET requests", async () => {
    const { res, result } = mockRes();
    await processWebhook(
      { method: "GET", headers: {} },
      res,
      { botName: "test", secret: undefined, token: undefined, handle: async () => {} },
    );
    assert.equal(result.code, 200);
  });

  it("returns 405 for unsupported methods", async () => {
    const { res, result } = mockRes();
    await processWebhook(
      { method: "DELETE", headers: {} },
      res,
      { botName: "test", secret: undefined, token: undefined, handle: async () => {} },
    );
    assert.equal(result.code, 405);
  });

  it("returns 401 when secret does not match", async () => {
    const { res, result } = mockRes();
    await processWebhook(
      { method: "POST", headers: { "x-telegram-bot-api-secret-token": "wrong" } },
      res,
      { botName: "test", secret: "correct-secret", token: "tok", handle: async () => {} },
    );
    assert.equal(result.code, 401);
  });

  it("returns 400 for an invalid body", async () => {
    const { res, result } = mockRes();
    await processWebhook(
      { method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: "not-json" },
      res,
      { botName: "test", secret: "s", token: "tok", handle: async () => {} },
    );
    assert.equal(result.code, 400);
  });

  it("returns 200 and calls the handler for a valid POST", async () => {
    resetSeenUpdates();
    const { res, result } = mockRes();
    let called = false;
    await processWebhook(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "mysecret" },
        body: { update_id: 999001, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "/start" } },
      },
      res,
      {
        botName: "testbot-handler",
        secret: "mysecret",
        token: "tok:abcde",
        handle: async () => { called = true; },
      },
    );
    assert.equal(result.code, 200);
    assert.ok(called, "Handler should have been called");
  });

  it("deduplicates repeated update_ids", async () => {
    resetSeenUpdates();
    const { res } = mockRes();
    let callCount = 0;
    const opts = {
      botName: "testbot-dedup",
      secret: "s",
      token: "tok:xyz",
      handle: async () => { callCount++; },
    };
    const req = {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "s" },
      body: { update_id: 888, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "/start" } },
    };
    await processWebhook(req, res, opts);
    await processWebhook(req, res, opts);
    assert.equal(callCount, 1, "Handler should be called exactly once for duplicate update_id");
  });

  it("returns 500 when token is missing", async () => {
    const { res, result } = mockRes();
    await processWebhook(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "s" },
        body: { update_id: 77 },
      },
      res,
      { botName: "notoken", secret: "s", token: "", handle: async () => {} },
    );
    assert.equal(result.code, 500);
  });
});
