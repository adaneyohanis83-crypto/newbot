// @ts-check

/**
 * @typedef {Object} TelegramChat
 * @property {number} id
 * @property {string} type
 */

/**
 * @typedef {Object} TelegramUser
 * @property {number} id
 * @property {string} [username]
 * @property {string} [first_name]
 */

/**
 * @typedef {Object} TelegramSuccessfulPayment
 * @property {string} currency
 * @property {number} total_amount
 * @property {string} invoice_payload
 * @property {string} telegram_payment_charge_id
 * @property {string} [provider_payment_charge_id]
 */

/**
 * @typedef {Object} TelegramMessage
 * @property {number} message_id
 * @property {string} [text]
 * @property {TelegramChat} chat
 * @property {TelegramUser} [from]
 * @property {TelegramSuccessfulPayment} [successful_payment]
 */

/**
 * @typedef {Object} TelegramCallbackQuery
 * @property {string} id
 * @property {string} [data]
 * @property {TelegramUser} from
 * @property {TelegramMessage} [message]
 */

/**
 * @typedef {Object} TelegramPreCheckoutQuery
 * @property {string} id
 * @property {TelegramUser} from
 * @property {string} currency
 * @property {number} total_amount
 * @property {string} invoice_payload
 */

/**
 * @typedef {Object} TelegramUpdate
 * @property {number} [update_id]
 * @property {TelegramMessage} [message]
 * @property {TelegramCallbackQuery} [callback_query]
 * @property {TelegramPreCheckoutQuery} [pre_checkout_query]
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
