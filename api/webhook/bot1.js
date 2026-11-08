// @ts-check
import { handleBot1Update } from "../../src/bots/bot1.js";
import { createBotContext } from "../../src/bots/context.js";
import { processWebhook } from "../../src/http/process-webhook.js";

/**
 * @param {import("../../src/http/process-webhook.js").IncomingRequest} req
 * @param {import("../../src/http/process-webhook.js").HttpResponse} res
 */
export default function handler(req, res) {
  return processWebhook(req, res, {
    botName: "bot1",
    secret: process.env.BOT1_WEBHOOK_SECRET,
    token: process.env.BOT1_TOKEN,
    handle(update, api) {
      return handleBot1Update(update, createBotContext(api));
    },
  });
}
