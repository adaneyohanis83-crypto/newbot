// @ts-check
/**
 * Local development server.
 * Runs both bot webhook endpoints on a single Express server.
 *
 * Usage:
 *   node src/server.js
 *
 * Then expose with ngrok:
 *   ngrok http 3000
 *
 * Then register webhooks:
 *   node scripts/set-webhooks.js
 */

import path from "node:path";
import express from "express";
import { loadEnvFile } from "./utils/env-file.js";
import { handleBot1Update } from "./bots/bot1.js";
import { handleBot2Update } from "./bots/bot2.js";
import { createBotContext } from "./bots/context.js";
import { processWebhook, parseUpdate, headerValue } from "./http/process-webhook.js";

// Load .env file (does not override existing process.env values)
const env = loadEnvFile(path.join(process.cwd(), ".env"));
// Merge into process.env so the rest of the code sees everything
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

// Parse raw JSON bodies — we pass them through to processWebhook ourselves
app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Telegram Stars Bots — local dev server" });
});

// Bot 1 webhook
app.all("/api/webhook/bot1", (req, res) => {
  return processWebhook(
    {
      method: req.method,
      headers: /** @type {Record<string, string | string[] | undefined>} */ (req.headers),
      body: req.body,
    },
    {
      status: (code) => ({
        json: (body) => { res.status(code).json(body); },
      }),
    },
    {
      botName: "bot1",
      secret: process.env.BOT1_WEBHOOK_SECRET,
      token: process.env.BOT1_TOKEN,
      handle(update, api) {
        return handleBot1Update(update, createBotContext(api));
      },
    },
  );
});

// Bot 2 webhook
app.all("/api/webhook/bot2", (req, res) => {
  return processWebhook(
    {
      method: req.method,
      headers: /** @type {Record<string, string | string[] | undefined>} */ (req.headers),
      body: req.body,
    },
    {
      status: (code) => ({
        json: (body) => { res.status(code).json(body); },
      }),
    },
    {
      botName: "bot2",
      secret: process.env.BOT2_WEBHOOK_SECRET,
      token: process.env.BOT2_TOKEN,
      handle(update, api) {
        return handleBot2Update(update, createBotContext(api));
      },
    },
  );
});

app.listen(PORT, () => {
  console.log(`\n🤖 Local dev server running on http://localhost:${PORT}`);
  console.log(`\n   Bot 1 webhook: http://localhost:${PORT}/api/webhook/bot1`);
  console.log(`   Bot 2 webhook: http://localhost:${PORT}/api/webhook/bot2`);
  console.log(`\n   Next steps:`);
  console.log(`   1. Run ngrok:           ngrok http ${PORT}`);
  console.log(`   2. Update APP_URL in .env with the ngrok https URL`);
  console.log(`   3. Register webhooks:   node scripts/set-webhooks.js\n`);
});
