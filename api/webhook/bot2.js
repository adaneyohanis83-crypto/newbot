// @ts-check
import { handleBot2Update } from "../../src/bots/bot2.js";
import { createBotContext } from "../../src/bots/context.js";
import { processWebhook } from "../../src/http/process-webhook.js";

/**
 * @param {import("../../src/http/process-webhook.js").IncomingRequest} req
 * @param {import("../../src/http/process-webhook.js").HttpResponse} res
 */
export default function handler(req, res) {
  return processWebhook(req, res, {
    botName: "bot2",
    secret: process.env.BOT2_WEBHOOK_SECRET,
    token: process.env.BOT2_TOKEN,
    handle(update, api) {
      return handleBot2Update(update, createBotContext(api));
    },
  });
}
