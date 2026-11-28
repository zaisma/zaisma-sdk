// How kinds of sync share one room: every message and every run of bytes says which kind it belongs to, so many
// pieces send through the same room without knowing about each other, and the game's own messages pass by
// untouched. The same in a player's game and on a game server.
import { PieceError } from "../piece/index.js";

export const PIECE_NAME = "@zaisma/net";

/** Throws this piece's error: code stable, field the argument at fault (or null), fix what to do. */
export function refuse(code, message, field, fix) {
  throw new PieceError(PIECE_NAME, code, { message, field: field ?? null, fix });
}

/** Refuses an argument the call doesn't take, naming the ones it does. */
export function refuseUnknown(given, known, what) {
  if (given === undefined) return;
  if (given === null || typeof given !== "object" || Array.isArray(given)) refuse("bad_argument", `${what} takes an object.`, what, `Give { ${known.join(", ")} }, each optional unless its reference says otherwise.`);
  for (const key of Object.keys(given)) {
    if (!known.includes(key)) refuse("unknown_argument", `${what} has no "${key}".`, key, `It takes: ${known.join(", ")}.`);
  }
}

/** A kind's name: lowercase words joined by underscores, up to 40 characters. */
export const KIND_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** A kind's message, wrapped for the room. */
export const wrapMessage = (kindName, kindMessage) => ({ sync_kind: kindName, sync_message: kindMessage });

/** The kind and message of a room message, or null when it isn't a kind's (the game's own). */
export function unwrapMessage(message) {
  if (message === null || typeof message !== "object" || typeof message.sync_kind !== "string" || !("sync_message" in message)) return null;
  return { kindName: message.sync_kind, kindMessage: message.sync_message };
}

// Bytes carry their kind's name in front: one marker byte, the name's length, the name, then the kind's bytes.
const BYTES_MARKER_CODE = 0xa5;

/** A kind's bytes, wrapped for the room. */
export function wrapBytes(kindName, bytes) {
  const payload = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  const wrapped = new Uint8Array(2 + kindName.length + payload.length);
  wrapped[0] = BYTES_MARKER_CODE;
  wrapped[1] = kindName.length;
  for (let index = 0; index < kindName.length; index += 1) wrapped[2 + index] = kindName.charCodeAt(index);
  wrapped.set(payload, 2 + kindName.length);
  return wrapped;
}

/** The kind and bytes of a run of bytes from the room, or null when they aren't one of the known kinds' (the game's own). */
export function unwrapBytes(bytes, knownKindNames) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 3 || bytes[0] !== BYTES_MARKER_CODE || bytes.length < 2 + bytes[1]) return null;
  const kindName = String.fromCharCode(...bytes.subarray(2, 2 + bytes[1]));
  if (!knownKindNames.includes(kindName)) return null;
  return { kindName, kindBytes: bytes.subarray(2 + bytes[1]) };
}

/** Whether something is a plain object (not null, not a list). */
export const isPlainObject = (given) => given !== null && typeof given === "object" && !Array.isArray(given);

/** How many bytes something takes as JSON: what the room would carry. */
export function jsonSizeBytes(given) {
  try {
    const text = JSON.stringify(given);
    return text === undefined ? 0 : new TextEncoder().encode(text).length;
  } catch {
    return Infinity;
  }
}
