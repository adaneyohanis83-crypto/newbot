// @ts-check

/** @type {Map<string, number[]>} */
const seenUpdates = new Map();
const MAX_SEEN = 500;

/**
 * @param {string} botName
 * @param {number} updateId
 */
export function hasSeenUpdate(botName, updateId) {
  return (seenUpdates.get(botName) ?? []).includes(updateId);
}

/**
 * @param {string} botName
 * @param {number} updateId
 */
export function rememberUpdate(botName, updateId) {
  const current = seenUpdates.get(botName) ?? [];
  current.push(updateId);
  seenUpdates.set(botName, current.slice(-MAX_SEEN));
}

export function resetSeenUpdates() {
  seenUpdates.clear();
}
