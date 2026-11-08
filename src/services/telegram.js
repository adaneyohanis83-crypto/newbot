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
    try {
      data = await response.json();
    } catch {
      throw new Error(`Telegram ${method} returned an unreadable response`);
    }

    if (!data || data.ok !== true) {
      const description = typeof data?.description === "string" ? data.description : "request failed";
      throw new Error(`Telegram ${method} failed: ${description}`);
    }
  }

  return {
    sendMessage(chatId, text, replyMarkup) {
      return call("sendMessage", messageBody(chatId, text, replyMarkup));
    },
    editMessageText(chatId, messageId, text, replyMarkup) {
      return call("editMessageText", {
        ...messageBody(chatId, text, replyMarkup),
        message_id: messageId,
      });
    },
    sendPhoto(chatId, photo, caption, replyMarkup) {
      /** @type {Record<string, unknown>} */
      const body = {
        chat_id: chatId,
        photo,
        caption: caption.slice(0, 1000),
        parse_mode: "HTML",
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      return call("sendPhoto", body);
    },
    deleteMessage(chatId, messageId) {
      return call("deleteMessage", { chat_id: chatId, message_id: messageId });
    },
    answerCallbackQuery(callbackQueryId, text) {
      /** @type {Record<string, unknown>} */
      const body = { callback_query_id: callbackQueryId };
      if (text) body.text = text.slice(0, 180);
      return call("answerCallbackQuery", body);
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
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return body;
}
