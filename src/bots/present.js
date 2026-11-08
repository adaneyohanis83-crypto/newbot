// @ts-check

/**
 * @typedef {import("../types.js").InlineKeyboard} InlineKeyboard
 * @typedef {import("../services/telegram.js").TelegramApi} TelegramApi
 */

/**
 * @param {TelegramApi} api
 * @param {{ chatId: number, messageId?: number }} target
 * @param {string} text
 * @param {InlineKeyboard | undefined} replyMarkup
 * @param {string | undefined} [imageUrl]
 */
export async function presentMessage(api, target, text, replyMarkup, imageUrl) {
  if (imageUrl) {
    if (target.messageId !== undefined) {
      try {
        await api.deleteMessage(target.chatId, target.messageId);
      } catch {
        // The older menu can stay if Telegram refuses the delete.
      }
    }
    try {
      await api.sendPhoto(target.chatId, imageUrl, text, replyMarkup);
      return;
    } catch {
      // Fall back to a text message when the image cannot be sent.
    }
  }

  if (target.messageId !== undefined) {
    try {
      await api.editMessageText(target.chatId, target.messageId, text, replyMarkup);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("message is not modified")) return;
    }
  }

  await api.sendMessage(target.chatId, text, replyMarkup);
}
