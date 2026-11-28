// Events: named messages from one player's game to everyone else's, or from the game server: an emote, a goal, a
// door opening. The game names them once, so a typo is said at once instead of going nowhere.
import { jsonSizeBytes, refuse, refuseUnknown } from "../wire.js";
import { defineKind } from "./define.js";

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** An event's payload as JSON, at most: well under a room message's 16 KB. */
export const MAXIMUM_EVENT_PAYLOAD_SIZE_BYTES = 8 * 1024;

/**
 * Events. eventNames is the closed list of the game's events, each lowercase words joined by underscores. On a
 * game server the hook beforeEvent may stop a player's event before it reaches anyone.
 */
export function eventsKind(given) {
  refuseUnknown(given, ["eventNames"], "eventsKind");
  const { eventNames } = given ?? {};
  if (!Array.isArray(eventNames) || !eventNames.length || eventNames.length > 200 || eventNames.some((eventName) => typeof eventName !== "string" || !EVENT_NAME_PATTERN.test(eventName)) || new Set(eventNames).size !== eventNames.length) {
    refuse("bad_event_names", "eventNames is a list of 1 to 200 different event names, each lowercase words joined by underscores.", "eventNames", 'Give a list like ["emote", "goal_scored"].');
  }
  const known = (eventName) => {
    if (!eventNames.includes(eventName)) refuse("unknown_event", `There's no event ${JSON.stringify(eventName)}.`, "eventName", `This game's events: ${eventNames.join(", ")}. Name others in eventsKind's eventNames.`);
    return eventName;
  };
  const checkedPayload = (payload) => {
    if (jsonSizeBytes(payload) > MAXIMUM_EVENT_PAYLOAD_SIZE_BYTES) refuse("payload_too_big", `The event's payload is over ${MAXIMUM_EVENT_PAYLOAD_SIZE_BYTES} bytes as JSON, or isn't JSON.`, "payload", "Send plain JSON of up to 8 KB; share bigger things as objects, or in pieces.");
    return payload === undefined ? null : payload;
  };
  const sendOptionsOf = (sendOptions, eventName) => {
    refuseUnknown(sendOptions, ["delivery"], "sendOptions");
    return sendOptions?.delivery === "latest_only" ? { delivery: "latest_only", latestKey: `event:${eventName}`.slice(0, 40) } : undefined;
  };

  return defineKind({
    name: "events",
    client(kindContext) {
      const listeners = new Map(eventNames.map((eventName) => [eventName, new Set()]));
      kindContext.onMessage((kindMessage, fromPlayerId) => {
        if (!kindMessage || typeof kindMessage.event_name !== "string" || !listeners.has(kindMessage.event_name)) return;
        for (const listener of [...listeners.get(kindMessage.event_name)]) listener(kindMessage.payload ?? null, fromPlayerId);
      });
      return {
        /** Sends an event to everyone else in the room. payload is plain JSON, or left out. */
        send(eventName, payload = null, sendOptions) {
          return kindContext.send({ event_name: known(eventName), payload: checkedPayload(payload) }, sendOptionsOf(sendOptions, eventName));
        },
        /** Hears an event: listener(payload, fromPlayerId), fromPlayerId null when the game server itself sent it. Answers a function that stops listening. */
        on(eventName, listener) {
          if (typeof listener !== "function") refuse("bad_argument", "on takes a listener function.", "listener", "Give (payload, fromPlayerId) => { ... }.");
          listeners.get(known(eventName)).add(listener);
          return () => listeners.get(eventName).delete(listener);
        },
      };
    },
    server: {
      setup: () => ({}),
      onMessage(kindState, player, kindMessage, kindContext) {
        if (!kindMessage || !eventNames.includes(kindMessage.event_name)) return;
        const payload = kindMessage.payload ?? null;
        if (jsonSizeBytes(payload) > MAXIMUM_EVENT_PAYLOAD_SIZE_BYTES) return;
        if (kindContext.ask("beforeEvent", true, { playerId: player.id, eventName: kindMessage.event_name, payload, roomState: kindContext.roomState }) !== true) return;
        kindContext.broadcast({ event_name: kindMessage.event_name, payload }, { exceptPlayerId: player.id, fromPlayerId: player.id });
      },
      api: (kindState, kindContext) => ({
        /** From the game server to every player, or all but one. */
        broadcast(eventName, payload = null, broadcastOptions) {
          refuseUnknown(broadcastOptions, ["exceptPlayerId"], "broadcastOptions");
          kindContext.broadcast({ event_name: known(eventName), payload: checkedPayload(payload) }, broadcastOptions?.exceptPlayerId ? { exceptPlayerId: broadcastOptions.exceptPlayerId } : undefined);
        },
        /** From the game server to one player. */
        send(playerId, eventName, payload = null) {
          kindContext.send(playerId, { event_name: known(eventName), payload: checkedPayload(payload) });
        },
      }),
    },
  });
}
