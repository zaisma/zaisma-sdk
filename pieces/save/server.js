// The save piece on the game server: answers the requests serverStore sends, keeping each player's save in the
// game's own database (server.database), so a save follows a player to every device. It's plain game server code:
// it runs the same in Zaisma's rooms and on the Node runner on a developer's own server. A row holds player_id, so
// erasing a player (server.database.erasePlayer, which Zaisma runs when an account is deleted) erases their saves.
// The reference is server.d.ts. MIT licensed.
import { MAXIMUM_PART_COUNT, MAXIMUM_PART_SIZE_BYTES, MAXIMUM_SERVER_SAVE_COUNT, MAXIMUM_SERVER_SAVE_SIZE_BYTES, SAVE_REQUEST_TYPES, STORAGE_KEY_PATTERN, sizeBytesOf } from "./envelope.js";

export { MAXIMUM_SERVER_SAVE_SIZE_BYTES, SAVE_REQUEST_TYPES };

/** The tables the save piece keeps in the game's database. */
export const SAVE_TABLE_NAMES = ["zaisma_save_saves", "zaisma_save_parts"];

const MAKE_TABLES = [
  { sql: "CREATE TABLE IF NOT EXISTS zaisma_save_saves (player_id TEXT NOT NULL, storage_key TEXT NOT NULL, save_text TEXT NOT NULL, revision_number INTEGER NOT NULL, saved_at_ms INTEGER NOT NULL, PRIMARY KEY (player_id, storage_key))" },
  { sql: "CREATE TABLE IF NOT EXISTS zaisma_save_parts (player_id TEXT NOT NULL, storage_key TEXT NOT NULL, upload_id TEXT NOT NULL, part_index INTEGER NOT NULL, part_text TEXT NOT NULL, PRIMARY KEY (player_id, storage_key, upload_id, part_index))" },
];

const FIELDS_BY_TYPE = {
  zaisma_save_read: ["type", "storage_key"],
  zaisma_save_part: ["type", "storage_key", "upload_id", "part_index", "part_text"],
  zaisma_save_write: ["type", "storage_key", "upload_id", "part_count", "part_text", "expected_revision_number"],
};
const UPLOAD_ID_PATTERN = /^upload_[a-z0-9]{1,24}$/;

/** The databases whose tables are made, so each copy of the game server makes them once. */
const madeDatabases = new WeakSet();

const refusal = (code, message, field, fix) => ({ error: { code, message, field, fix } });

/** What's wrong with a request, as the answer to give, or null when it's one the save piece takes. */
function refusalOf(request) {
  const fields = FIELDS_BY_TYPE[request.type];
  for (const name of Object.keys(request)) if (!fields.includes(name)) return refusal("unknown_field", `A ${request.type} request has no field "${name}".`, name, "Send the save piece's requests through its serverStore, as they are.");
  for (const name of fields) if (!Object.hasOwn(request, name)) return refusal("bad_save_request", `A ${request.type} request needs ${name}.`, name, "Send the save piece's requests through its serverStore, as they are.");
  if (typeof request.storage_key !== "string" || !STORAGE_KEY_PATTERN.test(request.storage_key)) return refusal("bad_storage_key", "A storage key is letters, digits and . _ : -, up to 100 characters.", "storage_key", 'Give a key like "save".');
  if (request.type === "zaisma_save_read") return null;
  if (typeof request.upload_id !== "string" || !UPLOAD_ID_PATTERN.test(request.upload_id)) return refusal("bad_save_request", "upload_id isn't one serverStore makes.", "upload_id", "Send the save piece's requests through its serverStore, as they are.");
  if (typeof request.part_text !== "string" || sizeBytesOf(request.part_text) > MAXIMUM_PART_SIZE_BYTES) return refusal("bad_save_request", `part_text is text of up to ${MAXIMUM_PART_SIZE_BYTES} bytes.`, "part_text", "Send the save piece's requests through its serverStore, which splits a save into parts that fit.");
  if (request.type === "zaisma_save_part") {
    if (!Number.isInteger(request.part_index) || request.part_index < 0 || request.part_index > MAXIMUM_PART_COUNT - 2) return refusal("bad_save_request", `part_index is a whole number from 0 to ${MAXIMUM_PART_COUNT - 2}: the last part comes with the write.`, "part_index", "Send the save piece's requests through its serverStore, as they are.");
    return null;
  }
  if (!Number.isInteger(request.part_count) || request.part_count < 1 || request.part_count > MAXIMUM_PART_COUNT) return refusal("save_too_big", `A save is sent in up to ${MAXIMUM_PART_COUNT} parts.`, "part_count", `Keep the save under ${MAXIMUM_SERVER_SAVE_SIZE_BYTES} bytes: progress and settings, never what the game can rebuild.`);
  if (request.expected_revision_number !== null && (!Number.isInteger(request.expected_revision_number) || request.expected_revision_number < 1)) return refusal("bad_save_request", "expected_revision_number is a whole number from 1, or null for a player with no save yet.", "expected_revision_number", "Send the save piece's requests through its serverStore, as they are.");
  return null;
}

async function makeTables(database) {
  if (madeDatabases.has(database)) return;
  await database.batch(MAKE_TABLES);
  madeDatabases.add(database);
}

async function storedSave(database, playerId, storageKey) {
  const [row] = await database.query("SELECT save_text, revision_number FROM zaisma_save_saves WHERE player_id = ? AND storage_key = ?", [playerId, storageKey]);
  return row ? { save_text: String(row.save_text), revision_number: Number(row.revision_number) } : { save_text: null, revision_number: null };
}

/**
 * Answers a request of the save piece's (its type is one of SAVE_REQUEST_TYPES), or undefined for any other, for
 * the game server's own onRequest to answer. Call it first thing in onRequest. A guest's save isn't kept here (a
 * guest's player ID lasts only for their pass): serverStore keeps it in the browser instead.
 */
export async function answerSaveRequest(player, request, server) {
  if (request === null || typeof request !== "object" || Array.isArray(request) || !SAVE_REQUEST_TYPES.includes(request.type)) return undefined;
  const refused = refusalOf(request);
  if (refused) return refused;
  if (player?.kind === "guest" || typeof player?.id !== "string") {
    return request.type === "zaisma_save_read" ? { player_id: null, is_kept_on_server: false, save_text: null, revision_number: null } : refusal("account_needed", "A guest's save isn't kept on the game server.", null, "It stays in the browser: serverStore does this by itself.");
  }
  const database = server.database;
  await makeTables(database);
  const playerId = player.id;
  const storageKey = request.storage_key;

  if (request.type === "zaisma_save_read") return { player_id: playerId, is_kept_on_server: true, ...(await storedSave(database, playerId, storageKey)) };

  if (request.type === "zaisma_save_part") {
    // The first part of a send clears what any earlier, unfinished send left.
    await database.batch([
      ...(request.part_index === 0 ? [{ sql: "DELETE FROM zaisma_save_parts WHERE player_id = ? AND storage_key = ?", values: [playerId, storageKey] }] : []),
      { sql: "INSERT INTO zaisma_save_parts (player_id, storage_key, upload_id, part_index, part_text) VALUES (?, ?, ?, ?, ?) ON CONFLICT (player_id, storage_key, upload_id, part_index) DO UPDATE SET part_text = excluded.part_text", values: [playerId, storageKey, request.upload_id, request.part_index, request.part_text] },
    ]);
    return { is_received: true };
  }

  // zaisma_save_write: the earlier parts, then the last, written only over the revision the player's game last saw.
  const partCount = request.part_count;
  const rows = partCount > 1 ? await database.query("SELECT part_index, part_text FROM zaisma_save_parts WHERE player_id = ? AND storage_key = ? AND upload_id = ? ORDER BY part_index", [playerId, storageKey, request.upload_id]) : [];
  if (rows.length !== partCount - 1 || rows.some((row, rowIndex) => Number(row.part_index) !== rowIndex)) return refusal("save_parts_missing", `The save came in ${rows.length + 1} of its ${partCount} parts.`, "part_count", "Send it again: serverStore does this by itself.");
  const saveText = rows.map((row) => String(row.part_text)).join("") + request.part_text;
  const sizeBytes = sizeBytesOf(saveText);
  if (sizeBytes > MAXIMUM_SERVER_SAVE_SIZE_BYTES) return refusal("save_too_big", `The save is ${sizeBytes} bytes, over the ${MAXIMUM_SERVER_SAVE_SIZE_BYTES} a game server keeps.`, null, "Keep progress and settings in the save, never what the game can rebuild.");
  if (request.expected_revision_number === null) {
    const [counted] = await database.query("SELECT count(*) AS save_count FROM zaisma_save_saves WHERE player_id = ? AND storage_key <> ?", [playerId, storageKey]);
    if (Number(counted?.save_count ?? 0) >= MAXIMUM_SERVER_SAVE_COUNT) return refusal("too_many_saves", `A player keeps up to ${MAXIMUM_SERVER_SAVE_COUNT} saves on the game server, each under its own storage key.`, "storage_key", "Keep the game's slots in fewer storage keys.");
  }
  const nowMs = Date.now();
  const writeStatement = request.expected_revision_number === null
    ? { sql: "INSERT INTO zaisma_save_saves (player_id, storage_key, save_text, revision_number, saved_at_ms) VALUES (?, ?, ?, 1, ?) ON CONFLICT (player_id, storage_key) DO NOTHING RETURNING revision_number", values: [playerId, storageKey, saveText, nowMs] }
    : { sql: "UPDATE zaisma_save_saves SET save_text = ?, revision_number = revision_number + 1, saved_at_ms = ? WHERE player_id = ? AND storage_key = ? AND revision_number = ? RETURNING revision_number", values: [saveText, nowMs, playerId, storageKey, request.expected_revision_number] };
  const [written] = await database.batch([writeStatement, { sql: "DELETE FROM zaisma_save_parts WHERE player_id = ? AND storage_key = ?", values: [playerId, storageKey] }]);
  if (written.length) return { is_written: true, revision_number: Number(written[0].revision_number) };
  // Another of the player's devices wrote since this one last saw it: it gets what's there, to settle.
  return { is_written: false, ...(await storedSave(database, playerId, storageKey)) };
}
