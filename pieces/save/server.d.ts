/**
 * The save piece on the game server: answers the requests serverStore sends, keeping each signed-in player's save
 * in the game's own database, so it follows them to every device. Plain game server code: the same in Zaisma's
 * rooms and on the Node runner on a developer's own server (@zaisma/game-server/node). Its rows hold player_id, so
 * server.database.erasePlayer (which Zaisma runs when an account is deleted) erases a player's saves with the rest.
 *
 * @example
 * // zaisma-server/index.js
 * import { answerSaveRequest } from "./pieces/@zaisma/save/server.js";
 * export default {
 *   async onRequest(player, request, server) {
 *     const saveAnswer = await answerSaveRequest(player, request, server);
 *     if (saveAnswer !== undefined) return saveAnswer;
 *     // ... the game's own requests ...
 *   },
 * };
 */

/** What answerSaveRequest reaches: the player its pass names, and the game's database. */
export interface SavePlayer {
  id: string;
  kind: string;
}
export interface SaveServer {
  database: {
    query(sql: string, values?: (string | number | null | Uint8Array)[]): Promise<Record<string, string | number | null | Uint8Array>[]>;
    batch(statements: { sql: string; values?: (string | number | null | Uint8Array)[] }[]): Promise<Record<string, string | number | null | Uint8Array>[][]>;
  };
}

/**
 * Answers a request of the save piece's, or undefined for any other request, for the game's own onRequest to
 * answer. A guest's save isn't kept here (a guest's player ID lasts only for their pass): serverStore keeps it in the
 * browser. A refused request answers { error: { code, message, field, fix } }, with code unknown_field,
 * bad_save_request, bad_storage_key, save_parts_missing, save_too_big, too_many_saves or account_needed.
 */
export declare function answerSaveRequest(player: SavePlayer, request: unknown, server: SaveServer): Promise<object | undefined>;

/** The request types answerSaveRequest answers. */
export declare const SAVE_REQUEST_TYPES: readonly string[];
/** The tables it keeps in the game's database: the saves, and parts of a save still being sent. */
export declare const SAVE_TABLE_NAMES: readonly string[];
/** The most a save kept on a game server may take, in bytes (256 KB). */
export declare const MAXIMUM_SERVER_SAVE_SIZE_BYTES: number;
