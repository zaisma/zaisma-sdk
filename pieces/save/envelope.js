// What a save looks like stored, and the limits both sides of the save piece keep: its browser half (index.js,
// stores.js) and its game server half (server.js). Plain JavaScript with no dependencies. MIT licensed.

/** The most a save kept in the browser may take, in bytes: Zaisma's cloud saves take no more. */
export const MAXIMUM_BROWSER_SAVE_SIZE_BYTES = 5 * 1024 * 1024;
/** The most a save kept on a game server may take, in bytes: sent in parts, each one request. */
export const MAXIMUM_SERVER_SAVE_SIZE_BYTES = 256 * 1024;
/** The most one part of a save sent to a game server takes, in bytes as it travels: a request is up to 16 KB. */
export const MAXIMUM_PART_SIZE_BYTES = 14000;
/** The most parts one save is sent in. */
export const MAXIMUM_PART_COUNT = 64;
/** The most saves one player keeps on a game server, each under its own storage key. */
export const MAXIMUM_SERVER_SAVE_COUNT = 8;
/** A storage key: letters, digits and . _ : -, up to 100 characters. */
export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
/** The requests the save piece sends to its game server half. */
export const SAVE_REQUEST_TYPES = ["zaisma_save_read", "zaisma_save_part", "zaisma_save_write"];

const encoder = new TextEncoder();
/** How many bytes text takes in UTF-8. */
export const sizeBytesOf = (text) => encoder.encode(text).length;

/** When a stored save was written, as an ISO time, or null for text that isn't a save. */
export function savedAtOf(saveText) {
  if (typeof saveText !== "string") return null;
  try {
    const stored = JSON.parse(saveText);
    return typeof stored?.saved_at === "string" ? stored.saved_at : null;
  } catch {
    return null;
  }
}

/** Whether one stored save was written after another: the one played most recently wins, as on Zaisma. */
export function isSavedLater(oneText, otherText) {
  const oneAtMs = Date.parse(savedAtOf(oneText) ?? "");
  const otherAtMs = Date.parse(savedAtOf(otherText) ?? "");
  if (Number.isNaN(otherAtMs)) return !Number.isNaN(oneAtMs);
  return !Number.isNaN(oneAtMs) && oneAtMs > otherAtMs;
}

/** Splits a save's text into parts that each travel as at most MAXIMUM_PART_SIZE_BYTES of JSON. */
export function partsOf(saveText) {
  const parts = [];
  let startIndex = 0;
  while (startIndex < saveText.length || parts.length === 0) {
    let endIndex = Math.min(saveText.length, startIndex + MAXIMUM_PART_SIZE_BYTES);
    // Shrink until it fits as JSON (quotes and other characters take more there), never splitting a surrogate pair.
    while (endIndex > startIndex + 1 && sizeBytesOf(JSON.stringify(saveText.slice(startIndex, endIndex))) > MAXIMUM_PART_SIZE_BYTES) {
      endIndex = startIndex + Math.floor((endIndex - startIndex) * 0.9);
    }
    const lastCode = saveText.charCodeAt(endIndex - 1);
    if (endIndex < saveText.length && lastCode >= 0xd800 && lastCode <= 0xdbff) endIndex -= 1;
    parts.push(saveText.slice(startIndex, endIndex));
    startIndex = endIndex;
  }
  return parts;
}
