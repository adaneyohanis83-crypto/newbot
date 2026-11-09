// @ts-check

/**
 * @typedef {import("../types.js").InlineKeyboard} InlineKeyboard
 */

/**
 * @typedef {Object} TelegramApi
 * @property {(chatId: number, text: string, replyMarkup?: InlineKeyboard) => Promise<void>} sendMessage
 * @property {(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboard) => Promise<void>} editMessageText
 * @property {(chatId: number, photo: string, caption: string, replyMarkup?: InlineKeyboard) => Promise<void>} sendPhoto
 * @property {(chatId: number, messageId: number) => Promise<void>} deleteMessage
 * @property {(callbackQueryId: string, text?: string) => Promise<void>} answerCallbackQuery
 * @property {(chatId: number, title: string, description: string, payload: string, currency: string, prices: {label:string,amount:number}[], replyMarkup?: InlineKeyboard) => Promise<void>} sendInvoice
 * @property {(preCheckoutQueryId: string, ok: boolean, errorMessage?: string) => Promise<void>} answerPreCheckoutQuery
 * @property {(chatId: number|string, expireDate?: number, memberLimit?: number) => Promise<string>} createChatInviteLink
 * @property {(userId: number, telegramPaymentChargeId: string) => Promise<void>} refundStarPayment
 * @property {(chatId: number|string, userId: number) => Promise<void>} banChatMember
 */

/**
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @returns {TelegramApi}
 */
export function createTelegramApi(token, fetchImpl = fetch) {
  /**
   * @param {string} method
   * @param {Record<string, unknown>} body
   */
  async function call(method, body) {
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(`Telegram ${method} could not be reached`);
    }

    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Telegram ${method} returned an unreadable response`); }

    if (!data || data.ok !== true) {
      const description = typeof data?.description === "string" ? data.description : "request failed";
      throw new Error(`Telegram ${method} failed: ${description}`);
    }
    return data.result;
  }

  return {
    sendMessage(chatId, text, replyMarkup) {
      return call("sendMessage", messageBody(chatId, text, replyMarkup)).then(() => undefined);
    },
    editMessageText(chatId, messageId, text, replyMarkup) {
      return call("editMessageText", { ...messageBody(chatId, text, replyMarkup), message_id: messageId }).then(() => undefined);
    },
    sendPhoto(chatId, photo, caption, replyMarkup) {
      /** @type {Record<string, unknown>} */
      const body = { chat_id: chatId, photo, caption: caption.slice(0, 1000), parse_mode: "HTML" };
      if (replyMarkup) body.reply_markup = replyMarkup;
      return call("sendPhoto", body).then(() => undefined);
    },
    deleteMessage(chatId, messageId) {
      return call("deleteMessage", { chat_id: chatId, message_id: messageId }).then(() => undefined);
    },
    answerCallbackQuery(callbackQueryId, text) {
      /** @type {Record<string, unknown>} */
      const body = { callback_query_id: callbackQueryId };
      if (text) body.text = text.slice(0, 180);
      return call("answerCallbackQuery", body).then(() => undefined);
    },
    sendInvoice(chatId, title, description, payload, currency, prices, replyMarkup) {
      /** @type {Record<string, unknown>} */
      const body = {
        chat_id: chatId,
        title,
        description,
        payload,
        provider_token: "",  // empty for XTR (Telegram Stars)
        currency,
        prices,
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      return call("sendInvoice", body).then(() => undefined);
    },
    answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage) {
      /** @type {Record<string, unknown>} */
      const body = { pre_checkout_query_id: preCheckoutQueryId, ok };
      if (!ok && errorMessage) body.error_message = errorMessage;
      return call("answerPreCheckoutQuery", body).then(() => undefined);
    },
    async createChatInviteLink(chatId, expireDate, memberLimit = 1) {
      /** @type {Record<string, unknown>} */
      const body = { chat_id: chatId, member_limit: memberLimit };
      if (expireDate) body.expire_date = expireDate;
      const result = await call("createChatInviteLink", body);
      return /** @type {any} */ (result).invite_link;
    },
    refundStarPayment(userId, telegramPaymentChargeId) {
      return call("refundStarPayment", { user_id: userId, telegram_payment_charge_id: telegramPaymentChargeId }).then(() => undefined);
    },
    banChatMember(chatId, userId) {
      return call("banChatMember", { chat_id: chatId, user_id: userId }).then(() => undefined);
    },
  };
}

/**
 * @param {number} chatId
 * @param {string} text
 * @param {InlineKeyboard | undefined} replyMarkup
 */
function messageBody(chatId, text, replyMarkup) {
  /** @type {Record<string, unknown>} */
  const body = { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return body;
}
