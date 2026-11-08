// @ts-check

/**
 * @typedef {Object} TelegramChat
 * @property {number} id
 * @property {string} type
 */

/**
 * @typedef {Object} TelegramUser
 * @property {number} id
 */

/**
 * @typedef {Object} TelegramMessage
 * @property {number} message_id
 * @property {string} [text]
 * @property {TelegramChat} chat
 * @property {TelegramUser} [from]
 */

/**
 * @typedef {Object} TelegramCallbackQuery
 * @property {string} id
 * @property {string} [data]
 * @property {TelegramUser} from
 * @property {TelegramMessage} [message]
 */

/**
 * @typedef {Object} TelegramUpdate
 * @property {number} [update_id]
 * @property {TelegramMessage} [message]
 * @property {TelegramCallbackQuery} [callback_query]
 */

/**
 * @typedef {Object} InlineButton
 * @property {string} text
 * @property {string} [callback_data]
 * @property {string} [url]
 */

/**
 * @typedef {Object} InlineKeyboard
 * @property {InlineButton[][]} inline_keyboard
 */

export {};
