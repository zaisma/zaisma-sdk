// The networking core, on the game server. defineNetServer wraps a game server so the kinds of sync its game uses
// run there too: each kind keeps its own state beside the game's (state.net), gets the players' messages meant for
// it, and the game's own handlers get everything else, unchanged. It's plain game server code, so it runs the same
// in Zaisma's rooms and on the Node runner on a developer's own machine. The reference is server.d.ts. MIT licensed.
import statement from "./piece.json.js";
import { openPiece } from "../piece/index.js";
import { OPENED, defineKind, serverContext } from "./kinds/define.js";
import { charactersKind } from "./kinds/characters.js";
import { eventsKind } from "./kinds/events.js";
import { objectsKind } from "./kinds/objects.js";
import { turnsKind } from "./kinds/turns.js";
import { defineShape } from "./shape.js";
import { MAXIMUM_TICKS_PER_SEC, createInputQueue, createSnapshotBuffer, createTicker, createTimeline } from "./timing.js";
import { refuse, unwrapBytes, unwrapMessage } from "./wire.js";

export { charactersKind, createInputQueue, createSnapshotBuffer, createTicker, createTimeline, defineKind, defineShape, eventsKind, objectsKind, turnsKind };
export { PieceError } from "../piece/index.js";

/** Ticks a second a game server gets when one of its kinds needs ticks and the game gave none. */
const DEFAULT_TICKS_PER_SEC = 30;

const isThenable = (given) => given !== null && typeof given === "object" && typeof given.then === "function";

/**
 * A game server with kinds of sync. Give it what defineGameServer takes, plus kinds (the same kinds the game uses
 * with createNet(room, { authorityKind: "server" })), and settings and hooks for the core. Answers the game server
 * to export or pass to defineGameServer. The room's state gains one field of the core's own, state.net, holding
 * each kind's state: leave it be.
 */
export function defineNetServer(definition) {
  const { kinds, settings: givenSettings, hooks: givenHooks, ...gameServer } = definition ?? {};
  if (!Array.isArray(kinds) || !kinds.length) refuse("kinds_missing", "defineNetServer needs kinds: the kinds of sync this game uses.", "kinds", "Give a list like [eventsKind({ eventNames: [...] }), objectsKind()]: the same kinds the game uses.");
  for (const kind of kinds) {
    if (!kind || typeof kind.name !== "string" || typeof kind.client !== "function" || !kind.server) refuse("not_a_kind", "kinds holds something that isn't a kind of sync.", "kinds", "Give kinds made by eventsKind, objectsKind, charactersKind, turnsKind or defineKind.");
  }
  const kindNames = kinds.map((kind) => kind.name);
  if (new Set(kindNames).size !== kindNames.length) refuse("kind_already_used", "A kind is listed twice.", "kinds", "List each kind once.");
  if (gameServer.ticksPerSec !== undefined && !(Number.isInteger(gameServer.ticksPerSec) && gameServer.ticksPerSec >= 1 && gameServer.ticksPerSec <= MAXIMUM_TICKS_PER_SEC)) {
    refuse("bad_ticks_per_sec", `ticksPerSec is ${JSON.stringify(gameServer.ticksPerSec)}.`, "ticksPerSec", `Give a whole number from 1 to ${MAXIMUM_TICKS_PER_SEC}, the same steps a second the game's createNet uses, or leave it out.`);
  }
  const { settings, hooks, ask, tell } = openPiece(statement, { settings: givenSettings, hooks: givenHooks });
  const isTickNeeded = kinds.some((kind) => kind.isTickNeeded) || typeof gameServer.onTick === "function";
  const ticksPerSec = gameServer.ticksPerSec ?? (isTickNeeded ? DEFAULT_TICKS_PER_SEC : undefined);
  const opened = { settings, hooks, ask, tell, ticksPerSec: ticksPerSec ?? DEFAULT_TICKS_PER_SEC };

  /** The state with every kind's own in state.net, made the first time and after a restore. */
  const withKinds = (state) => {
    if (state.net === undefined || state.net === null) state.net = {};
    for (const kind of kinds) if (!(kind.name in state.net)) state.net[kind.name] = kind.server.setup ? kind.server.setup() : {};
    state.net[OPENED] = opened;
    return state;
  };
  // A handler may change the state in place or answer a new one; either way the kinds' state stays with it.
  const kept = (earlier, answered) => {
    const next = answered === undefined || answered === null ? earlier : answered;
    if (next !== earlier && typeof next === "object" && next.net === undefined) next.net = earlier.net;
    return next;
  };
  const afterGame = (state, answered, then) => {
    if (isThenable(answered)) return answered.then((resolved) => then(kept(state, resolved)));
    return then(kept(state, answered));
  };
  const eachKind = (state, room, handlerName, ...given) => {
    for (const kind of kinds) kind.server[handlerName]?.(state.net[kind.name], ...given, serverContext(kind.name, room, opened, state));
  };

  const wrapped = {
    ...gameServer,
    setup: (...given) => withKinds((gameServer.setup ? gameServer.setup(...given) : null) ?? {}),
    onJoin(state, player, room, ...rest) {
      withKinds(state);
      eachKind(state, room, "onJoin", player);
      return afterGame(state, gameServer.onJoin?.(state, player, room, ...rest), (next) => next);
    },
    onLeave(state, player, room, ...rest) {
      withKinds(state);
      // The game's onLeave first, so it can still read the leaver's character and objects.
      return afterGame(state, gameServer.onLeave?.(state, player, room, ...rest), (next) => {
        withKinds(next);
        eachKind(next, room, "onLeave", player);
        return next;
      });
    },
    onBack(state, player, room, ...rest) {
      withKinds(state);
      eachKind(state, room, "onBack", player);
      return afterGame(state, gameServer.onBack?.(state, player, room, ...rest), (next) => next);
    },
    onMessage(state, player, room, message, ...rest) {
      withKinds(state);
      const unwrapped = unwrapMessage(message);
      const kind = unwrapped && kinds.find((entry) => entry.name === unwrapped.kindName);
      if (unwrapped) {
        kind?.server.onMessage?.(state.net[kind.name], player, unwrapped.kindMessage, serverContext(kind.name, room, opened, state));
        return state;
      }
      return afterGame(state, gameServer.onMessage?.(state, player, room, message, ...rest), (next) => next);
    },
    onBytes(state, player, room, bytes, ...rest) {
      withKinds(state);
      const unwrapped = unwrapBytes(bytes, kindNames);
      if (unwrapped) {
        kinds.find((entry) => entry.name === unwrapped.kindName).server.onBytes?.(state.net[unwrapped.kindName], player, unwrapped.kindBytes, serverContext(unwrapped.kindName, room, opened, state));
        return state;
      }
      return afterGame(state, gameServer.onBytes?.(state, player, room, bytes, ...rest), (next) => next);
    },
  };
  if (ticksPerSec !== undefined) {
    wrapped.ticksPerSec = ticksPerSec;
    // The kinds step first, so the game's own tick sees where every character is now.
    wrapped.onTick = (state, tickDurationSec, room, ...rest) => {
      withKinds(state);
      eachKind(state, room, "onTick", tickDurationSec);
      return afterGame(state, gameServer.onTick?.(state, tickDurationSec, room, ...rest), (next) => next);
    };
  }
  if (gameServer.stateSyncEnabled) {
    // What players see of the state never holds the core's own: input buffers and history stay on the server.
    wrapped.stateView = (state, viewer, room) => {
      const { net, ...rest } = state;
      return gameServer.stateView ? gameServer.stateView(rest, viewer, room) : rest;
    };
  }
  return wrapped;
}
