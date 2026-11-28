// The networking core, in a player's game: one room carries every kind of sync the game uses. Each kind gets the
// room's messages and bytes meant for it, the players as they change, fixed steps on the room's clock and a call
// every frame; the game's own messages pass by untouched.
import statement from "./piece.json.js";
import { openPiece } from "../piece/index.js";
import { createTicker } from "./timing.js";
import { refuse, refuseUnknown, unwrapBytes, unwrapMessage, wrapBytes, wrapMessage } from "./wire.js";

const AUTHORITY_KINDS = ["host", "server"];

/**
 * Starts sync on a room the game has joined (Zaisma.joinRoom(), on Zaisma or on a developer's own server).
 * authorityKind says who is in charge: "host" on the relay, where the game has no server code and the room's
 * host decides; "server" when the game has a game server made with defineNetServer. Call net.update() every frame.
 */
export function createNet(room, given = {}) {
  refuseUnknown(given, ["authorityKind", "ticksPerSec", "settings", "hooks"], "createNet");
  const { authorityKind = "host", ticksPerSec = 30 } = given;
  if (!AUTHORITY_KINDS.includes(authorityKind)) refuse("bad_authority_kind", `authorityKind is ${JSON.stringify(authorityKind)}.`, "authorityKind", 'Use "host" for a game with no server code (the relay), "server" for one whose game server is made with defineNetServer.');
  if (!room || typeof room.send !== "function" || typeof room.on !== "function" || typeof room.serverTimeMs !== "function" || !room.me) {
    refuse("room_missing", "createNet needs the room the game joined.", "room", "Give what Zaisma.joinRoom() answered, once it has joined.");
  }
  const { settings, hooks, ask, tell } = openPiece(statement, { settings: given.settings, hooks: given.hooks });
  const ticker = createTicker({ ticksPerSec });
  const kinds = new Map();
  const tickListeners = new Set();
  const frameListeners = new Set();
  const isSpectator = Boolean(room.isSpectator);
  const authorityPlayerId = () => (authorityKind === "host" ? (room.hostPlayerId ?? null) : null);
  const playerIds = () => room.players.map((player) => player.id);
  let isDisposed = false;

  const onMessage = (message, fromPlayerId) => {
    const unwrapped = unwrapMessage(message);
    const kind = unwrapped && kinds.get(unwrapped.kindName);
    if (kind) for (const listener of kind.messageListeners) listener(unwrapped.kindMessage, fromPlayerId ?? null);
  };
  const onBytes = (bytes, fromPlayerId) => {
    const unwrapped = unwrapBytes(bytes, [...kinds.keys()]);
    if (unwrapped) for (const listener of kinds.get(unwrapped.kindName).bytesListeners) listener(unwrapped.kindBytes, fromPlayerId ?? null);
  };
  let lastAuthorityPlayerId = authorityPlayerId();
  let lastPlayerIdsText = playerIds().join(" ");
  const onPlayers = () => {
    lastAuthorityPlayerId = authorityPlayerId();
    lastPlayerIdsText = playerIds().join(" ");
    for (const kind of kinds.values()) for (const listener of kind.playersListeners) listener(playerIds(), lastAuthorityPlayerId);
  };
  // The game server moved this player to another room: what each kind held was the old room's.
  const onMoved = () => {
    for (const kind of kinds.values()) for (const listener of kind.resetListeners) listener();
    onPlayers();
  };
  room.on("message", onMessage);
  room.on("bytes", onBytes);
  room.on("players", onPlayers);
  room.on("moved", onMoved);

  let lastFrameAtMs = null;
  const net = {
    room,
    authorityKind,
    ticker,
    settings,
    hooks,
    /** This player's id. */
    get myPlayerId() {
      return room.me.id;
    },
    /** The player in charge of the room on the relay (its host), or null when a game server is. */
    get authorityPlayerId() {
      return authorityPlayerId();
    },
    /** Whether this player's game is the one in charge: the host's, on the relay. Never with a game server. */
    get isAuthority() {
      return authorityKind === "host" && !isSpectator && authorityPlayerId() === room.me.id;
    },
    /** Adds a kind of sync to this room and answers what the game calls on it. Each kind is added once. */
    use(kind) {
      if (isDisposed) refuse("net_disposed", "This net was disposed.", null, "Make a new one with createNet for the room.");
      if (!kind || typeof kind.client !== "function" || typeof kind.name !== "string") refuse("not_a_kind", "use takes a kind of sync.", "kind", "Give one made by eventsKind, objectsKind, charactersKind, turnsKind or defineKind.");
      if (kinds.has(kind.name)) refuse("kind_already_used", `The kind "${kind.name}" is already in use on this room.`, "kind", "Call use once for each kind and keep what it answers.");
      const entry = { messageListeners: new Set(), bytesListeners: new Set(), playersListeners: new Set(), resetListeners: new Set(), api: null };
      kinds.set(kind.name, entry);
      const listen = (listeners) => (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      entry.api = kind.client({
        authorityKind,
        isSpectator,
        ticker,
        settings,
        ask,
        tell,
        get myPlayerId() {
          return room.me.id;
        },
        isAuthority: () => net.isAuthority,
        authorityPlayerId,
        playerIds,
        serverTimeMs: () => room.serverTimeMs(),
        send: (kindMessage, sendOptions) => !isSpectator && room.send(wrapMessage(kind.name, kindMessage), sendOptions),
        sendBytes: (bytes, sendOptions) => !isSpectator && room.sendBytes(wrapBytes(kind.name, bytes), sendOptions),
        onMessage: listen(entry.messageListeners),
        onBytes: listen(entry.bytesListeners),
        onPlayersChanged: listen(entry.playersListeners),
        onReset: listen(entry.resetListeners),
        onTick: listen(tickListeners),
        onFrame: listen(frameListeners),
      });
      return entry.api;
    },
    /** Runs a function at every fixed step: the same step numbers for every player. Answers a function that stops it. */
    onTick(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    /** Every frame: runs the fixed steps that are due on the room's clock, eases what's drawn, and notices a change of host. */
    update() {
      if (isDisposed) return;
      if (authorityPlayerId() !== lastAuthorityPlayerId || playerIds().join(" ") !== lastPlayerIdsText) onPlayers();
      const nowMs = room.serverTimeMs();
      for (const tickIndex of ticker.advance(nowMs)) for (const listener of [...tickListeners]) listener(tickIndex, ticker.tickDurationSec);
      const frameDurationSec = lastFrameAtMs === null ? 0 : Math.min(Math.max((nowMs - lastFrameAtMs) / 1000, 0), 1);
      lastFrameAtMs = nowMs;
      for (const listener of [...frameListeners]) listener(frameDurationSec, nowMs);
    },
    /** Stops listening to the room. The room itself stays joined. */
    dispose() {
      isDisposed = true;
      room.off("message", onMessage);
      room.off("bytes", onBytes);
      room.off("players", onPlayers);
      room.off("moved", onMoved);
      kinds.clear();
      tickListeners.clear();
      frameListeners.clear();
    },
  };
  return net;
}
