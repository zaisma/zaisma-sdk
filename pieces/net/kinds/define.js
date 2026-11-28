// A kind of sync: one way of sharing something through a room, with a half in each player's game and, for a
// game with a game server, a half there. The four built in (events, objects, characters, turns) are made with
// defineKind, as a kind of another piece's or a game's own is.
import { KIND_NAME_PATTERN, isPlainObject, refuse, refuseUnknown, wrapBytes, wrapMessage } from "../wire.js";

const SERVER_HANDLER_NAMES = ["setup", "onJoin", "onLeave", "onBack", "onMessage", "onBytes", "onTick", "api"];

/**
 * What a kind's half on the game server works through: the room, with every message and run of bytes marked as
 * the kind's, the core's settings and hooks, and the game's own state for its hooks to read.
 */
export function serverContext(kindName, room, opened, roomState) {
  return {
    room,
    roomState,
    settings: opened.settings,
    ask: opened.ask,
    tell: opened.tell,
    ticksPerSec: opened.ticksPerSec,
    serverTimeMs: () => room.serverTimeMs(),
    playerIds: () => room.players.map((player) => player.id),
    send: (playerId, kindMessage, sendOptions) => room.send(playerId, wrapMessage(kindName, kindMessage), sendOptions),
    broadcast: (kindMessage, broadcastOptions) => room.broadcast(wrapMessage(kindName, kindMessage), broadcastOptions),
    sendBytes: (playerId, bytes, sendOptions) => room.sendBytes(playerId, wrapBytes(kindName, bytes), sendOptions),
    broadcastBytes: (bytes, broadcastOptions) => room.broadcastBytes(wrapBytes(kindName, bytes), broadcastOptions),
  };
}

/**
 * Makes a kind of sync. name is the kind's own, the same in every game that uses it. client(kindContext) runs in each
 * player's game and answers what the game calls. server, for games with a game server, holds the kind's handlers
 * there: setup() answers its own state (plain JSON, kept with the room's), the handlers get that state first, and
 * api(kindState, kindContext) answers what the game server's own code calls, reached as kind.onServer(state, room).
 * isTickNeeded says the server half's onTick must run even when the game gave its game server no ticksPerSec.
 */
export function defineKind(definition) {
  refuseUnknown(definition, ["name", "client", "server", "isTickNeeded"], "defineKind");
  const { name, client, server = {}, isTickNeeded = false } = definition ?? {};
  if (typeof name !== "string" || !KIND_NAME_PATTERN.test(name)) refuse("bad_kind_name", `"${name}" isn't a kind's name.`, "name", 'Give lowercase words joined by underscores, up to 40 characters, like "vehicles".');
  if (typeof client !== "function") refuse("kind_client_missing", `The kind "${name}" has no client.`, "client", "Give client(kindContext): what runs in each player's game.");
  if (!isPlainObject(server)) refuse("bad_argument", `The kind "${name}"'s server isn't an object of handlers.`, "server", `Give { ${SERVER_HANDLER_NAMES.join(", ")} }, each optional.`);
  refuseUnknown(server, SERVER_HANDLER_NAMES, `The kind "${name}"'s server`);
  for (const [handlerName, handler] of Object.entries(server)) {
    if (typeof handler !== "function") refuse("bad_argument", `The kind "${name}"'s server.${handlerName} isn't a function.`, handlerName, "Give a function, or leave it out.");
  }
  return {
    name,
    client,
    server,
    isTickNeeded: Boolean(isTickNeeded),
    /** In a game server's own code: this kind's calls there, for the room's state as its handlers get it. */
    onServer(state, room) {
      const opened = state?.net?.[OPENED];
      if (!opened || !(name in state.net)) refuse("kind_not_on_server", `The kind "${name}" isn't one of this game server's kinds.`, null, "List it in defineNetServer's kinds, and call onServer with the state the handler got.");
      return server.api ? server.api(state.net[name], serverContext(name, room, opened, state)) : {};
    },
  };
}

/**
 * Where the game server keeps what defineNetServer opened (settings, hooks), beside the kinds' states in
 * state.net. A symbol: it never goes into the room's saved or synced state, and is put back after a restore.
 */
export const OPENED = Symbol.for("zaisma.net.opened");
