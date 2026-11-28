/**
 * @zaisma/net on the game server. defineNetServer wraps a game server so the kinds of sync its game uses run there
 * too: each kind keeps its own state beside the game's (state.net), gets the players' messages meant for it, and the
 * game's own handlers get everything else, unchanged. It's plain game server code, so it runs the same in Zaisma's
 * rooms and on the Node runner on a developer's own machine (npx @zaisma/game-server, or play-locally).
 *
 * `zaisma pieces add` puts this file in zaisma-server/pieces/@zaisma/net/, where a game server on Zaisma imports it.
 *
 * @example
 * // zaisma-server/index.js: the same kinds the game uses. A kind from a piece (the Character module's) comes to both
 * // sides with the piece; a game's own declaration is one file, copied into zaisma-server/ (players never get its files).
 * import { defineNetServer, eventsKind, objectsKind } from "./pieces/@zaisma/net/server.js";
 * import { walker } from "./walker.js";
 *
 * const events = eventsKind({ eventNames: ["emote", "goal"] });
 * const objects = objectsKind();
 *
 * export default defineNetServer({
 *   kinds: [walker, events, objects],
 *   ticksPerSec: 30,
 *   settings: { objectsOwnerLeftMode: "give_to_authority" },
 *   hooks: {
 *     beforeEvent: (isAllowed, { eventName }) => isAllowed && eventName !== "goal",   // only the server says "goal"
 *   },
 *   setup: () => ({ score: 0 }),
 *   onJoin(state, player, room) {
 *     objects.onServer(state, room).create("ball", { x: 0, z: 0 });                  // false once it exists
 *   },
 *   onTick(state, tickDurationSec, room) {
 *     const characters = walker.onServer(state, room);
 *     for (const characterId of characters.ids()) if (characters.state(characterId).y < -20) characters.set(characterId, { x: 0, y: 2 });
 *   },
 * });
 *
 * // In the game: the same code as on the relay, with one word changed.
 * const net = createNet(room, { authorityKind: "server" });
 */
import type { CreateNetOptions, Kind } from "./index.js";

export { PieceError, charactersKind, createInputQueue, createSnapshotBuffer, createTicker, createTimeline, defineKind, defineShape, eventsKind, objectsKind, turnsKind } from "./index.js";
export type * from "./index.js";

/**
 * A game server with kinds of sync. Give it what defineGameServer takes, plus kinds (the same kinds the game uses with
 * createNet(room, { authorityKind: "server" })) and the core's settings and hooks, which rule the room: with a game
 * server, the players' games' own settings for objects and turns don't count. Answers the game server to export.
 *
 * - The room's state gains state.net, each kind's state: plain JSON, saved with the room's. Leave it be.
 * - With characters, the room ticks: ticksPerSec as given, else 30 a second. The kinds step before the game's onTick.
 * - The game's onLeave runs before the kinds forget the leaver, so it can still read their character and objects.
 * - With stateSyncEnabled, what players see of the state never holds state.net.
 *
 * Throws PieceError "kinds_missing", "not_a_kind", "kind_already_used", "bad_ticks_per_sec", and @zaisma/piece's
 * "unknown_setting", "bad_setting", "unknown_hook", "bad_hook".
 */
export declare function defineNetServer<GameServer extends object>(definition: GameServer & { kinds: Kind<any, any>[]; settings?: CreateNetOptions["settings"]; hooks?: CreateNetOptions["hooks"] }): Omit<GameServer, "kinds" | "settings" | "hooks">;
