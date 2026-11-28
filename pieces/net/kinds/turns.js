// Turns: whose turn it is, the moves made in them, a time limit, and what happens when a player leaves in theirs.
// Whoever is in charge keeps the turns (the game server, or the host's game on the relay): a player asks to move,
// it checks the move is theirs to make, asks the game's beforeTurnMove, and tells everyone what happened. The board
// itself is the game's: keep it in shared objects or the game server's state, so a late joiner sees it.
import { isPlainObject, jsonSizeBytes, refuse, refuseUnknown } from "../wire.js";
import { defineKind } from "./define.js";

/** A move as JSON, at most. */
export const MAXIMUM_MOVE_SIZE_BYTES = 2 * 1024;
/** The newest moves the turns carry, as JSON, at most: older ones drop off the front. */
const MAXIMUM_RECENT_MOVES_SIZE_BYTES = 8 * 1024;
const MAXIMUM_ORDER_PLAYER_COUNT = 100;
const TURN_REASONS = ["started", "moved", "timed_out", "left", "skipped", "order_changed", "ended"];

/** Turns not started yet. */
const newTurns = () => ({ is_started: false, is_ended: false, order: [], turn_player_id: null, turn_number: 0, deadline_ms: null, move_count: 0, recent_moves: [], end_result: null });

/** Turns as the game reads them. */
const shownTurns = (turns, myPlayerId) => ({
  isStarted: turns.is_started,
  isEnded: turns.is_ended,
  order: [...turns.order],
  turnPlayerId: turns.turn_player_id,
  turnNumber: turns.turn_number,
  deadlineMs: turns.deadline_ms,
  isMyTurn: myPlayerId !== null && turns.turn_player_id === myPlayerId && turns.is_started && !turns.is_ended,
  moveCount: turns.move_count,
  recentMoves: turns.recent_moves.map((recent) => ({ turnNumber: recent.turn_number, playerId: recent.player_id, move: structuredClone(recent.move) })),
  endResult: structuredClone(turns.end_result),
});

/** Whether something sent is turns, checked without throwing: what the host sends on the relay is checked like anything else. */
function isTurns(given) {
  return (
    isPlainObject(given) &&
    typeof given.is_started === "boolean" &&
    typeof given.is_ended === "boolean" &&
    Array.isArray(given.order) &&
    given.order.length <= MAXIMUM_ORDER_PLAYER_COUNT &&
    given.order.every((playerId) => typeof playerId === "string") &&
    (given.turn_player_id === null || typeof given.turn_player_id === "string") &&
    Number.isInteger(given.turn_number) &&
    (given.deadline_ms === null || Number.isFinite(given.deadline_ms)) &&
    Number.isInteger(given.move_count) &&
    Array.isArray(given.recent_moves) &&
    jsonSizeBytes(given) <= MAXIMUM_RECENT_MOVES_SIZE_BYTES * 2
  );
}

// ---- The turns themselves: the same steps for the game server and the host's game ----

const deadlineFrom = (nowMs, timeLimitSec) => (timeLimitSec > 0 ? nowMs + timeLimitSec * 1000 : null);

/** Passes the turn to the next player in the order after the one whose turn it was (or the first). */
function passTurn(turns, nowMs, timeLimitSec) {
  if (!turns.order.length) {
    turns.is_ended = true;
    turns.turn_player_id = null;
    turns.deadline_ms = null;
    return;
  }
  const index = turns.order.indexOf(turns.turn_player_id);
  turns.turn_player_id = turns.order[(index + 1) % turns.order.length];
  turns.turn_number += 1;
  turns.deadline_ms = deadlineFrom(nowMs, timeLimitSec);
}

function startTurns(turns, order, nowMs, timeLimitSec) {
  Object.assign(turns, newTurns(), { is_started: true, order: [...order], turn_player_id: order[0], turn_number: 1, deadline_ms: deadlineFrom(nowMs, timeLimitSec) });
}

function recordMove(turns, playerId, move) {
  turns.move_count += 1;
  turns.recent_moves.push({ turn_number: turns.turn_number, player_id: playerId, move });
  while (turns.recent_moves.length > 1 && jsonSizeBytes(turns.recent_moves) > MAXIMUM_RECENT_MOVES_SIZE_BYTES) turns.recent_moves.shift();
}

/** Takes a player out of the order; when it was their turn, the turn passes. Answers whether anything changed. */
function removeFromOrder(turns, playerId, nowMs, timeLimitSec) {
  const index = turns.order.indexOf(playerId);
  if (index === -1 || !turns.is_started || turns.is_ended) return false;
  if (turns.turn_player_id === playerId) {
    // The next after the leaver is the one after them in the order as it was.
    const nextPlayerId = turns.order.length > 1 ? turns.order[(index + 1) % turns.order.length] : null;
    turns.order.splice(index, 1);
    if (nextPlayerId === null) {
      turns.is_ended = true;
      turns.turn_player_id = null;
      turns.deadline_ms = null;
    } else {
      turns.turn_player_id = nextPlayerId;
      turns.turn_number += 1;
      turns.deadline_ms = deadlineFrom(nowMs, timeLimitSec);
    }
  } else turns.order.splice(index, 1);
  return true;
}

function checkOrder(order, playerIds) {
  if (!Array.isArray(order) || !order.length || order.length > MAXIMUM_ORDER_PLAYER_COUNT || new Set(order).size !== order.length || order.some((playerId) => !playerIds.includes(playerId))) {
    refuse("bad_order", "The order is a list of 1 to 100 different players in the room.", "playerIds", "Give player ids from the room's players, each once, in the order they take turns; or leave it out for everyone in join order.");
  }
  return order;
}

function checkMove(move) {
  if (jsonSizeBytes(move) > MAXIMUM_MOVE_SIZE_BYTES) refuse("move_too_big", `A move is over ${MAXIMUM_MOVE_SIZE_BYTES} bytes as JSON, or isn't JSON.`, "move", "Send what the move is, in plain JSON up to 2 KB, like { column: 3 }; keep the board in shared objects.");
  return move === undefined ? null : move;
}

/**
 * Turns. A game starts them with start() (the host on the relay, or the game server), players move in their
 * turn with move(), and everyone hears each change. The setting turnTimeLimitSec passes a turn that runs out;
 * the hook beforeTurnMove, where the room is decided, may refuse a move.
 */
export function turnsKind(given = {}) {
  refuseUnknown(given, [], "turnsKind");

  /** What whoever is in charge does with a player's move. Answers the reason to tell, or null when it's refused. */
  function judgeMove(turns, playerId, sent, kindContext, nowMs) {
    if (!isPlainObject(sent) || !turns.is_started || turns.is_ended || turns.turn_player_id !== playerId || sent.turn_number !== turns.turn_number) return null;
    const move = sent.move ?? null;
    if (jsonSizeBytes(move) > MAXIMUM_MOVE_SIZE_BYTES) return null;
    if (kindContext.ask("beforeTurnMove", true, { playerId, turnNumber: turns.turn_number, move, roomState: kindContext.roomState ?? null }) !== true) return null;
    if (sent.is_move !== false) recordMove(turns, playerId, move);
    if (sent.is_turn_passed !== false) passTurn(turns, nowMs, kindContext.settings.get("turnTimeLimitSec"));
    return sent.is_move === false ? "skipped" : "moved";
  }

  /** Passes a turn whose time ran out. Answers whether it did. */
  function checkDeadline(turns, nowMs, kindContext) {
    if (!turns.is_started || turns.is_ended || turns.deadline_ms === null || nowMs < turns.deadline_ms) return false;
    passTurn(turns, nowMs, kindContext.settings.get("turnTimeLimitSec"));
    return true;
  }

  return defineKind({
    name: "turns",
    client(kindContext) {
      const isOnHost = kindContext.authorityKind === "host";
      let turns = newTurns();
      let isSynced = !isOnHost || kindContext.isAuthority();
      let helloAuthorityPlayerId = null;
      const listeners = { changed: new Set(), moved: new Set() };
      const myPlayerId = () => (kindContext.isSpectator ? null : kindContext.myPlayerId);

      const telling = (reason, lastMove) => {
        const shown = shownTurns(turns, myPlayerId());
        if (lastMove) for (const listener of [...listeners.moved]) listener({ turnNumber: lastMove.turn_number, playerId: lastMove.player_id, move: structuredClone(lastMove.move) }, shown);
        for (const listener of [...listeners.changed]) listener(shown, reason);
      };
      /** On the relay, the host tells everyone the turns as they are now. */
      const share = (reason, lastMove, forPlayerId = null) => kindContext.send({ type: "turns", turns, reason, last_move: lastMove, for_player_id: forPlayerId });
      const sayHello = () => {
        helloAuthorityPlayerId = kindContext.authorityPlayerId();
        kindContext.send({ type: "hello" });
      };
      const decide = (reason, lastMove) => {
        share(reason, lastMove);
        telling(reason, lastMove);
      };

      kindContext.onMessage((kindMessage, fromPlayerId) => {
        if (!isPlainObject(kindMessage)) return;
        if (kindMessage.type === "turns") {
          const isFromInCharge = isOnHost ? fromPlayerId === kindContext.authorityPlayerId() : fromPlayerId === null;
          if (!isFromInCharge || !isTurns(kindMessage.turns) || (kindMessage.for_player_id && kindMessage.for_player_id !== myPlayerId())) return;
          if (isOnHost && kindContext.isAuthority()) return;
          const isSame = JSON.stringify(kindMessage.turns) === JSON.stringify(turns);
          turns = kindMessage.turns;
          isSynced = true;
          // A copy sent to catch this game up that changes nothing isn't news.
          if (isSame && kindMessage.reason === "order_changed") return;
          const lastMove = isPlainObject(kindMessage.last_move) ? kindMessage.last_move : null;
          telling(TURN_REASONS.includes(kindMessage.reason) ? kindMessage.reason : "order_changed", lastMove);
          return;
        }
        if (!isOnHost || !kindContext.isAuthority() || !fromPlayerId) return;
        if (kindMessage.type === "hello") share("order_changed", null, fromPlayerId);
        else if (kindMessage.type === "move") {
          const reason = judgeMove(turns, fromPlayerId, kindMessage, kindContext, kindContext.serverTimeMs());
          if (reason) decide(reason, reason === "moved" ? turns.recent_moves[turns.recent_moves.length - 1] : null);
        }
      });
      kindContext.onPlayersChanged((playerIds, authorityPlayerId) => {
        if (!isOnHost) return;
        if (!isSynced && authorityPlayerId === kindContext.myPlayerId) isSynced = true;
        else if (!isSynced && authorityPlayerId && authorityPlayerId !== helloAuthorityPlayerId) sayHello();
        if (!kindContext.isAuthority()) return;
        for (const playerId of [...turns.order]) {
          if (!playerIds.includes(playerId) && removeFromOrder(turns, playerId, kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"))) decide("left", null);
        }
      });
      kindContext.onTick(() => {
        if (isOnHost && kindContext.isAuthority() && checkDeadline(turns, kindContext.serverTimeMs(), kindContext)) decide("timed_out", null);
      });
      kindContext.onReset(() => {
        turns = newTurns();
        isSynced = !isOnHost || kindContext.isAuthority();
        if (!isSynced) sayHello();
      });
      if (!isSynced) sayHello();

      const inCharge = (what) => {
        if (!isOnHost) refuse("not_in_charge", `With a game server, ${what} happens there.`, null, "Call it in the game server's code: turns.onServer(state, room).");
        if (!kindContext.isAuthority()) refuse("not_in_charge", `Only the room's host may ${what} on the relay.`, null, "Check turns' isInCharge first, or let the host's game do it.");
      };

      return {
        /** The turns as they are now: whose turn, its number, the order, the deadline on the room's clock, the newest moves. */
        get current() {
          return shownTurns(turns, myPlayerId());
        },
        /** Whether this game keeps the turns: the host's on the relay. */
        get isInCharge() {
          return isOnHost && kindContext.isAuthority();
        },
        /** On the relay, by the host: starts turns, with the order given or everyone in join order. Starting again starts over. */
        start(startOptions) {
          refuseUnknown(startOptions, ["playerIds"], "startOptions");
          inCharge("start turns");
          startTurns(turns, checkOrder(startOptions?.playerIds ?? kindContext.playerIds(), kindContext.playerIds()), kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"));
          decide("started", null);
        },
        /** On the relay, by the host: changes the order (a player joining in). Whose turn it is stays, if they're still in it. */
        setOrder(playerIds) {
          inCharge("change the order");
          checkOrder(playerIds, kindContext.playerIds());
          if (!turns.is_started || turns.is_ended) refuse("turns_not_running", "Turns aren't running.", null, "Start them first.");
          turns.order = [...playerIds];
          if (!turns.order.includes(turns.turn_player_id)) {
            turns.turn_player_id = turns.order[0];
            turns.turn_number += 1;
            turns.deadline_ms = deadlineFrom(kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"));
          }
          decide("order_changed", null);
        },
        /** On the relay, by the host: ends the turns with an end result (plain JSON, like { winnerPlayerId }), or null. */
        end(endResult = null) {
          inCharge("end turns");
          checkMove(endResult);
          turns.is_ended = true;
          turns.turn_player_id = null;
          turns.deadline_ms = null;
          turns.end_result = endResult;
          decide("ended", null);
        },
        /**
         * Makes a move in this player's turn: plain JSON up to 2 KB. By default the turn then passes; with
         * { isTurnPassed: false } the player moves again. Whoever is in charge checks it; everyone hears it as "moved".
         * Answers false when it isn't this player's turn.
         */
        move(move, moveOptions) {
          refuseUnknown(moveOptions, ["isTurnPassed"], "moveOptions");
          const sent = { type: "move", turn_number: turns.turn_number, move: checkMove(move), is_turn_passed: moveOptions?.isTurnPassed !== false, is_move: true };
          if (!shownTurns(turns, myPlayerId()).isMyTurn) return false;
          if (isOnHost && kindContext.isAuthority()) {
            const reason = judgeMove(turns, kindContext.myPlayerId, sent, kindContext, kindContext.serverTimeMs());
            if (reason) decide(reason, turns.recent_moves[turns.recent_moves.length - 1]);
            return Boolean(reason);
          }
          return kindContext.send(sent);
        },
        /** Passes this player's turn without a move. Answers false when it isn't their turn. */
        pass() {
          if (!shownTurns(turns, myPlayerId()).isMyTurn) return false;
          const sent = { type: "move", turn_number: turns.turn_number, move: null, is_turn_passed: true, is_move: false };
          if (isOnHost && kindContext.isAuthority()) {
            const reason = judgeMove(turns, kindContext.myPlayerId, sent, kindContext, kindContext.serverTimeMs());
            if (reason) decide(reason, null);
            return Boolean(reason);
          }
          return kindContext.send(sent);
        },
        /**
         * Hears "changed": listener(turns, reason), reason one of started, moved, timed_out, left, skipped,
         * order_changed, ended; or "moved": listener(move, turns) for each move made. Answers a function that stops listening.
         */
        on(eventName, listener) {
          if (!(eventName in listeners)) refuse("unknown_event", `There's no event ${JSON.stringify(eventName)}.`, "eventName", "Listen for: changed, moved.");
          if (typeof listener !== "function") refuse("bad_argument", "on takes a listener function.", "listener", "Give a function.");
          listeners[eventName].add(listener);
          return () => listeners[eventName].delete(listener);
        },
      };
    },
    server: {
      setup: newTurns,
      onJoin: (turns, player, kindContext) => kindContext.send(player.id, { type: "turns", turns, reason: "order_changed", last_move: null, for_player_id: null }),
      onBack: (turns, player, kindContext) => kindContext.send(player.id, { type: "turns", turns, reason: "order_changed", last_move: null, for_player_id: null }),
      onLeave(turns, player, kindContext) {
        if (removeFromOrder(turns, player.id, kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"))) kindContext.broadcast({ type: "turns", turns, reason: "left", last_move: null, for_player_id: null });
      },
      onMessage(turns, player, kindMessage, kindContext) {
        const nowMs = kindContext.serverTimeMs();
        // A room that doesn't tick still passes a turn that ran out, the next time anyone does anything.
        if (checkDeadline(turns, nowMs, kindContext)) kindContext.broadcast({ type: "turns", turns, reason: "timed_out", last_move: null, for_player_id: null });
        if (!isPlainObject(kindMessage) || kindMessage.type !== "move") return;
        const reason = judgeMove(turns, player.id, kindMessage, kindContext, nowMs);
        if (reason) kindContext.broadcast({ type: "turns", turns, reason, last_move: reason === "moved" ? turns.recent_moves[turns.recent_moves.length - 1] : null, for_player_id: null });
      },
      onTick(turns, tickDurationSec, kindContext) {
        if (checkDeadline(turns, kindContext.serverTimeMs(), kindContext)) kindContext.broadcast({ type: "turns", turns, reason: "timed_out", last_move: null, for_player_id: null });
      },
      api: (turns, kindContext) => {
        const tellAll = (reason) => kindContext.broadcast({ type: "turns", turns, reason, last_move: null, for_player_id: null });
        return {
          get current() {
            return shownTurns(turns, null);
          },
          /** Starts turns, with the order given or every player in join order. Starting again starts over. */
          start(startOptions) {
            refuseUnknown(startOptions, ["playerIds"], "startOptions");
            startTurns(turns, checkOrder(startOptions?.playerIds ?? kindContext.playerIds(), kindContext.playerIds()), kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"));
            tellAll("started");
          },
          setOrder(playerIds) {
            checkOrder(playerIds, kindContext.playerIds());
            if (!turns.is_started || turns.is_ended) refuse("turns_not_running", "Turns aren't running.", null, "Start them first.");
            turns.order = [...playerIds];
            if (!turns.order.includes(turns.turn_player_id)) {
              turns.turn_player_id = turns.order[0];
              turns.turn_number += 1;
              turns.deadline_ms = deadlineFrom(kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"));
            }
            tellAll("order_changed");
          },
          /** Passes the turn on, as if its player passed. */
          skip() {
            if (!turns.is_started || turns.is_ended) return false;
            passTurn(turns, kindContext.serverTimeMs(), kindContext.settings.get("turnTimeLimitSec"));
            tellAll("skipped");
            return true;
          },
          end(endResult = null) {
            checkMove(endResult);
            turns.is_ended = true;
            turns.turn_player_id = null;
            turns.deadline_ms = null;
            turns.end_result = endResult;
            tellAll("ended");
          },
        };
      },
    },
  });
}
