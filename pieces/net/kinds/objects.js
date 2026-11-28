// Objects: shared things, each with an owner (a ball, a door, a dropped item). Only an object's owner changes it;
// everyone else's copy follows, a player who joins late gets them all, and a leaver's objects are removed or handed
// on. The owner of an object nobody owns is whoever is in charge of the room.
import { isPlainObject, jsonSizeBytes, refuse, refuseUnknown } from "../wire.js";
import { defineKind } from "./define.js";

const OBJECT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** One object's properties as JSON, at most. */
export const MAXIMUM_OBJECT_SIZE_BYTES = 8 * 1024;
/** Objects one room holds, at most. */
export const MAXIMUM_OBJECT_COUNT = 2000;

const shown = (objectId, object) => ({ id: objectId, ownerPlayerId: object.owner_player_id, properties: object.properties });
const copyOf = (object) => ({ owner_player_id: object.owner_player_id, revision_number: object.revision_number, properties: structuredClone(object.properties) });

/** A short key for an object's latest-only sends: the same id always gives the same key, and different ids almost never share one. */
function latestKeyOf(objectId) {
  let hashNumber = 0x811c9dc5;
  for (let index = 0; index < objectId.length; index += 1) hashNumber = Math.imul(hashNumber ^ objectId.charCodeAt(index), 0x01000193) >>> 0;
  return `o:${hashNumber.toString(36)}`;
}

function checkId(objectId) {
  if (typeof objectId !== "string" || !OBJECT_ID_PATTERN.test(objectId)) refuse("bad_object_id", `${JSON.stringify(objectId)} isn't an object's id.`, "objectId", 'Give 1 to 64 letters, digits, "_", ".", ":" or "-", like "ball" or "door:3".');
  return objectId;
}
function checkProperties(properties, field) {
  if (!isPlainObject(properties)) refuse("bad_properties", `${field} isn't an object.`, field, "Give plain JSON like { x: 0, color: \"red\" }.");
  if (jsonSizeBytes(properties) > MAXIMUM_OBJECT_SIZE_BYTES) refuse("object_too_big", `${field} is over ${MAXIMUM_OBJECT_SIZE_BYTES} bytes as JSON, or isn't JSON.`, field, "Keep an object's properties under 8 KB of plain JSON: split a big thing into several objects.");
  return properties;
}
/** Properties another player sent, checked without throwing: what others send is never trusted. */
const isSentPropertiesFine = (properties) => isPlainObject(properties) && jsonSizeBytes(properties) <= MAXIMUM_OBJECT_SIZE_BYTES;
/** A player's id as sent, checked without throwing. */
const isPlayerIdOrNull = (given) => given === null || (typeof given === "string" && given.length > 0 && given.length <= 128);

/** What every copy does when a player is gone, the same everywhere: their objects go, or pass to whoever is in charge. */
function settleOwnerLeft(objects, playerId, ownerLeftMode) {
  const changes = [];
  for (const [objectId, object] of Object.entries(objects)) {
    if (object.owner_player_id !== playerId) continue;
    if (ownerLeftMode === "remove") {
      delete objects[objectId];
      changes.push({ changeKind: "removed", objectId, object });
    } else {
      object.owner_player_id = null;
      changes.push({ changeKind: "changed", objectId, object });
    }
  }
  return changes;
}

/**
 * Shared objects. Each has an id, an owner and properties (plain JSON up to 8 KB). The setting objectsOwnerLeftMode
 * says what happens to a leaver's objects; on a game server the hook beforeObjectChange may refuse a player's change.
 */
export function objectsKind(given = {}) {
  refuseUnknown(given, [], "objectsKind");
  return defineKind({
    name: "objects",
    client(kindContext) {
      const isOnHost = kindContext.authorityKind === "host";
      const objects = {};
      const listeners = { created: new Set(), changed: new Set(), removed: new Set() };
      let knownPlayerIds = new Set(kindContext.playerIds());
      // On the relay a late joiner holds what it hears until the host's copy comes, then applies what's newer.
      let isSynced = !isOnHost || kindContext.isAuthority();
      let heldMessages = [];
      let helloAuthorityPlayerId = null;
      const tell = (eventName, objectId, object) => {
        const view = shown(objectId, object);
        for (const listener of [...listeners[eventName]]) listener(view);
      };
      const mayChange = (object, playerId) => (object.owner_player_id === null ? isOnHost && playerId !== null && playerId === kindContext.authorityPlayerId() : object.owner_player_id === playerId);
      const sayHello = () => {
        helloAuthorityPlayerId = kindContext.authorityPlayerId();
        kindContext.send({ type: "hello" });
      };

      /** Applies one message. trusted: from a game server, which is the word on everything. */
      function apply(kindMessage, fromPlayerId) {
        const isTrusted = !isOnHost;
        const objectId = kindMessage.object_id;
        if (kindMessage.type !== "snapshot" && (typeof objectId !== "string" || !OBJECT_ID_PATTERN.test(objectId))) return;
        const object = objects[objectId];
        if (kindMessage.type === "create") {
          const ownerPlayerId = kindMessage.owner_player_id ?? null;
          if (!isPlayerIdOrNull(ownerPlayerId) || !isSentPropertiesFine(kindMessage.properties)) return;
          if (!isTrusted && (object || (ownerPlayerId === null ? fromPlayerId !== kindContext.authorityPlayerId() : ownerPlayerId !== fromPlayerId))) return;
          if (Object.keys(objects).length >= MAXIMUM_OBJECT_COUNT && !object) return;
          objects[objectId] = { owner_player_id: ownerPlayerId, revision_number: Number.isInteger(kindMessage.revision_number) ? kindMessage.revision_number : 0, properties: kindMessage.properties };
          tell(object ? "changed" : "created", objectId, objects[objectId]);
        } else if (kindMessage.type === "change") {
          if (!object || !(isTrusted || mayChange(object, fromPlayerId))) return;
          // A change older than the copy's (a latest-only send overtaken, or one the host's copy already had) is dropped.
          if (!Number.isInteger(kindMessage.revision_number) || kindMessage.revision_number <= object.revision_number) return;
          if (isSentPropertiesFine(kindMessage.properties)) object.properties = kindMessage.properties;
          else if (isSentPropertiesFine(kindMessage.changes) && jsonSizeBytes({ ...object.properties, ...kindMessage.changes }) <= MAXIMUM_OBJECT_SIZE_BYTES) Object.assign(object.properties, kindMessage.changes);
          else return;
          object.revision_number = kindMessage.revision_number;
          tell("changed", objectId, object);
        } else if (kindMessage.type === "owner") {
          if (!object || !(isTrusted || mayChange(object, fromPlayerId)) || !isPlayerIdOrNull(kindMessage.owner_player_id)) return;
          if (!Number.isInteger(kindMessage.revision_number) || kindMessage.revision_number <= object.revision_number) return;
          object.owner_player_id = kindMessage.owner_player_id;
          object.revision_number = kindMessage.revision_number;
          tell("changed", objectId, object);
        } else if (kindMessage.type === "remove") {
          if (!object || !(isTrusted || mayChange(object, fromPlayerId))) return;
          delete objects[objectId];
          tell("removed", objectId, object);
        } else if (kindMessage.type === "refused") {
          // The game server refused this player's change: its copy is the true one.
          if (!isTrusted) return;
          if (kindMessage.object === null) {
            if (object) {
              delete objects[objectId];
              tell("removed", objectId, object);
            }
          } else if (isPlainObject(kindMessage.object) && isSentPropertiesFine(kindMessage.object.properties)) {
            objects[objectId] = kindMessage.object;
            tell(object ? "changed" : "created", objectId, kindMessage.object);
          }
        }
      }

      /**
       * Replaces every object with a full copy (the game server's, or the host's for this late joiner). This player's
       * own objects that are newer here than in the copy stay: they were made or changed while the copy was on its
       * way, and whoever sent it has them by now (or answers that it refused them).
       */
      function replaceAll(given) {
        const next = { ...given };
        for (const [objectId, object] of Object.entries(objects)) {
          if (object.owner_player_id !== kindContext.myPlayerId) continue;
          const copied = next[objectId];
          if (!isPlainObject(copied) || !(copied.revision_number >= object.revision_number)) next[objectId] = object;
        }
        for (const objectId of Object.keys(objects)) {
          if (objectId in next) continue;
          const removed = objects[objectId];
          delete objects[objectId];
          tell("removed", objectId, removed);
        }
        for (const [objectId, object] of Object.entries(next)) {
          if (!OBJECT_ID_PATTERN.test(objectId) || !isPlainObject(object) || !isSentPropertiesFine(object.properties) || !isPlayerIdOrNull(object.owner_player_id ?? null)) continue;
          const earlier = objects[objectId];
          objects[objectId] = { owner_player_id: object.owner_player_id ?? null, revision_number: Number.isInteger(object.revision_number) ? object.revision_number : 0, properties: object.properties };
          if (!earlier) tell("created", objectId, objects[objectId]);
          else if (JSON.stringify(earlier) !== JSON.stringify(objects[objectId])) tell("changed", objectId, objects[objectId]);
        }
      }

      kindContext.onMessage((kindMessage, fromPlayerId) => {
        if (!isPlainObject(kindMessage)) return;
        if (kindMessage.type === "hello") {
          // On the relay the host answers a late joiner with its copy, meant for that player alone.
          if (isOnHost && kindContext.isAuthority() && fromPlayerId) kindContext.send({ type: "snapshot", for_player_id: fromPlayerId, objects });
          return;
        }
        if (kindMessage.type === "snapshot") {
          if (!isPlainObject(kindMessage.objects)) return;
          if (isOnHost) {
            if (fromPlayerId !== kindContext.authorityPlayerId() || kindMessage.for_player_id !== kindContext.myPlayerId || isSynced) return;
            replaceAll(kindMessage.objects);
            isSynced = true;
            const held = heldMessages;
            heldMessages = [];
            for (const each of held) apply(each.kindMessage, each.fromPlayerId);
          } else replaceAll(kindMessage.objects);
          return;
        }
        if (!isSynced) {
          if (heldMessages.length < 1000) heldMessages.push({ kindMessage, fromPlayerId });
          return;
        }
        apply(kindMessage, fromPlayerId);
      });

      // On the relay nobody announces who left, so every game settles a leaver's objects itself, the same way.
      kindContext.onPlayersChanged((playerIds, authorityPlayerId) => {
        const present = new Set(playerIds);
        if (isOnHost) {
          for (const playerId of knownPlayerIds) {
            if (present.has(playerId)) continue;
            for (const change of settleOwnerLeft(objects, playerId, kindContext.settings.get("objectsOwnerLeftMode"))) tell(change.changeKind, change.objectId, change.object);
          }
          // Still waiting for a copy whose host left: ask the new one.
          if (!isSynced && authorityPlayerId === kindContext.myPlayerId) {
            isSynced = true;
            const held = heldMessages;
            heldMessages = [];
            for (const each of held) apply(each.kindMessage, each.fromPlayerId);
          } else if (!isSynced && authorityPlayerId && authorityPlayerId !== helloAuthorityPlayerId) sayHello();
        }
        knownPlayerIds = present;
      });
      kindContext.onReset(() => {
        for (const objectId of Object.keys(objects)) delete objects[objectId];
        isSynced = !isOnHost || kindContext.isAuthority();
        heldMessages = [];
        if (!isSynced) sayHello();
      });
      // A game that joins a room under way on the relay asks the host for what's there.
      if (!isSynced) sayHello();

      const sendOptionsOf = (sendOptions, objectId) => {
        refuseUnknown(sendOptions, ["delivery"], "sendOptions");
        return sendOptions?.delivery === "latest_only" ? { delivery: "latest_only", latestKey: latestKeyOf(objectId) } : undefined;
      };

      return {
        /** Makes an object this player owns, or with ownerPlayerId null one that belongs to whoever is in charge (only they may). Answers false when the id is taken or it isn't this player's to make. */
        create(objectId, properties = {}, createOptions) {
          refuseUnknown(createOptions, ["ownerPlayerId"], "createOptions");
          checkId(objectId);
          checkProperties(properties, "properties");
          const ownerPlayerId = createOptions?.ownerPlayerId === undefined ? kindContext.myPlayerId : createOptions.ownerPlayerId;
          const isMine = ownerPlayerId === kindContext.myPlayerId || (ownerPlayerId === null && isOnHost && kindContext.isAuthority());
          if (kindContext.isSpectator || objectId in objects || !isMine) return false;
          if (Object.keys(objects).length >= MAXIMUM_OBJECT_COUNT) refuse("too_many_objects", `A room holds at most ${MAXIMUM_OBJECT_COUNT} objects.`, "objectId", "Remove objects nobody needs, or keep many small things in one object.");
          objects[objectId] = { owner_player_id: ownerPlayerId, revision_number: 0, properties: structuredClone(properties) };
          kindContext.send({ type: "create", object_id: objectId, owner_player_id: ownerPlayerId, revision_number: 0, properties });
          tell("created", objectId, objects[objectId]);
          return true;
        },
        /**
         * Changes some of an object's properties. Only whoever may change it can: answers false otherwise. With
         * { delivery: "latest_only" } a send may be dropped for a newer one, for something that changes every frame.
         */
        set(objectId, changes, sendOptions) {
          const object = objects[objectId];
          checkProperties(changes, "changes");
          const options = sendOptionsOf(sendOptions, objectId);
          if (kindContext.isSpectator || !object || !mayChange(object, kindContext.myPlayerId)) return false;
          checkProperties({ ...object.properties, ...changes }, "properties");
          object.revision_number += 1;
          Object.assign(object.properties, structuredClone(changes));
          // A latest-only send may be dropped, so it carries every property, never only what changed.
          kindContext.send(options ? { type: "change", object_id: objectId, revision_number: object.revision_number, properties: object.properties } : { type: "change", object_id: objectId, revision_number: object.revision_number, changes }, options);
          tell("changed", objectId, object);
          return true;
        },
        /** Hands an object to another player, or with null to whoever is in charge. Only whoever may change it can: answers false otherwise. */
        setOwner(objectId, ownerPlayerId) {
          const object = objects[objectId];
          if (ownerPlayerId !== null && !kindContext.playerIds().includes(ownerPlayerId)) refuse("unknown_player", `${JSON.stringify(ownerPlayerId)} isn't a player in the room.`, "ownerPlayerId", "Give the id of a player in the room, or null.");
          if (kindContext.isSpectator || !object || !mayChange(object, kindContext.myPlayerId)) return false;
          object.revision_number += 1;
          object.owner_player_id = ownerPlayerId;
          kindContext.send({ type: "owner", object_id: objectId, revision_number: object.revision_number, owner_player_id: ownerPlayerId });
          tell("changed", objectId, object);
          return true;
        },
        /** Removes an object. Only whoever may change it can: answers false otherwise. */
        remove(objectId) {
          const object = objects[objectId];
          if (kindContext.isSpectator || !object || !mayChange(object, kindContext.myPlayerId)) return false;
          delete objects[objectId];
          kindContext.send({ type: "remove", object_id: objectId });
          tell("removed", objectId, object);
          return true;
        },
        /** One object, { id, ownerPlayerId, properties }, or null. */
        get: (objectId) => (objectId in objects ? shown(objectId, copyOf(objects[objectId])) : null),
        /** Every object, in the order they were made. */
        all: () => Object.entries(objects).map(([objectId, object]) => shown(objectId, copyOf(object))),
        /** Whether this player may change an object now. */
        canChange: (objectId) => !kindContext.isSpectator && objectId in objects && mayChange(objects[objectId], kindContext.myPlayerId),
        /** Hears "created", "changed" or "removed": listener(object), for this player's own changes too. Answers a function that stops listening. */
        on(eventName, listener) {
          if (!(eventName in listeners)) refuse("unknown_event", `There's no event ${JSON.stringify(eventName)}.`, "eventName", "Listen for: created, changed, removed.");
          if (typeof listener !== "function") refuse("bad_argument", "on takes a listener function.", "listener", "Give (object) => { ... }.");
          listeners[eventName].add(listener);
          return () => listeners[eventName].delete(listener);
        },
      };
    },
    server: {
      setup: () => ({ objects: {} }),
      onJoin: (kindState, player, kindContext) => kindContext.send(player.id, { type: "snapshot", objects: kindState.objects }),
      onBack: (kindState, player, kindContext) => kindContext.send(player.id, { type: "snapshot", objects: kindState.objects }),
      onLeave(kindState, player, kindContext) {
        for (const change of settleOwnerLeft(kindState.objects, player.id, kindContext.settings.get("objectsOwnerLeftMode"))) {
          if (change.changeKind === "removed") kindContext.broadcast({ type: "remove", object_id: change.objectId });
          else {
            change.object.revision_number += 1;
            kindContext.broadcast({ type: "owner", object_id: change.objectId, revision_number: change.object.revision_number, owner_player_id: null });
          }
        }
      },
      onMessage(kindState, player, kindMessage, kindContext) {
        if (!isPlainObject(kindMessage) || typeof kindMessage.object_id !== "string" || !OBJECT_ID_PATTERN.test(kindMessage.object_id)) return;
        const objectId = kindMessage.object_id;
        const object = kindState.objects[objectId] ?? null;
        const refuseChange = () => kindContext.send(player.id, { type: "refused", object_id: objectId, object });
        const allows = (changeKind, changes) => kindContext.ask("beforeObjectChange", true, { playerId: player.id, changeKind, object: object ? shown(objectId, copyOf(object)) : null, changes, roomState: kindContext.roomState }) === true;
        if (kindMessage.type === "create") {
          // A player makes only objects of their own; the server's own come from its code.
          if (object || kindMessage.owner_player_id !== player.id || !isSentPropertiesFine(kindMessage.properties) || Object.keys(kindState.objects).length >= MAXIMUM_OBJECT_COUNT || !allows("create", kindMessage.properties)) return refuseChange();
          kindState.objects[objectId] = { owner_player_id: player.id, revision_number: 0, properties: kindMessage.properties };
          kindContext.broadcast({ type: "create", object_id: objectId, owner_player_id: player.id, revision_number: 0, properties: kindMessage.properties }, { exceptPlayerId: player.id });
        } else if (kindMessage.type === "change") {
          if (!object || object.owner_player_id !== player.id) return refuseChange();
          if (!Number.isInteger(kindMessage.revision_number) || kindMessage.revision_number <= object.revision_number) return;
          const isWhole = isSentPropertiesFine(kindMessage.properties);
          const changes = isWhole ? kindMessage.properties : kindMessage.changes;
          if (!isSentPropertiesFine(changes)) return refuseChange();
          const next = isWhole ? changes : { ...object.properties, ...changes };
          if (jsonSizeBytes(next) > MAXIMUM_OBJECT_SIZE_BYTES || !allows("change", changes)) return refuseChange();
          object.properties = next;
          object.revision_number = kindMessage.revision_number;
          // Everyone else gets the whole object: a later latest-only send never leaves a copy missing a change.
          kindContext.broadcast({ type: "change", object_id: objectId, revision_number: object.revision_number, properties: object.properties }, { exceptPlayerId: player.id, ...(isWhole ? { delivery: "latest_only", latestKey: latestKeyOf(objectId) } : {}) });
        } else if (kindMessage.type === "owner") {
          if (!object || object.owner_player_id !== player.id || !isPlayerIdOrNull(kindMessage.owner_player_id)) return refuseChange();
          const ownerPlayerId = kindMessage.owner_player_id;
          if (ownerPlayerId !== null && !kindContext.playerIds().includes(ownerPlayerId)) return refuseChange();
          if (!allows("change", null)) return refuseChange();
          object.revision_number += 1;
          object.owner_player_id = ownerPlayerId;
          kindContext.broadcast({ type: "owner", object_id: objectId, revision_number: object.revision_number, owner_player_id: ownerPlayerId });
        } else if (kindMessage.type === "remove") {
          if (!object || object.owner_player_id !== player.id || !allows("remove", null)) return refuseChange();
          delete kindState.objects[objectId];
          kindContext.broadcast({ type: "remove", object_id: objectId }, { exceptPlayerId: player.id });
        }
      },
      api: (kindState, kindContext) => ({
        /** Makes an object: the server's own, or with ownerPlayerId a player's. Answers false when the id is taken. */
        create(objectId, properties = {}, createOptions) {
          refuseUnknown(createOptions, ["ownerPlayerId"], "createOptions");
          checkId(objectId);
          checkProperties(properties, "properties");
          if (objectId in kindState.objects) return false;
          if (Object.keys(kindState.objects).length >= MAXIMUM_OBJECT_COUNT) refuse("too_many_objects", `A room holds at most ${MAXIMUM_OBJECT_COUNT} objects.`, "objectId", "Remove objects nobody needs, or keep many small things in one object.");
          const ownerPlayerId = createOptions?.ownerPlayerId ?? null;
          kindState.objects[objectId] = { owner_player_id: ownerPlayerId, revision_number: 0, properties: structuredClone(properties) };
          kindContext.broadcast({ type: "create", object_id: objectId, owner_player_id: ownerPlayerId, revision_number: 0, properties });
          return true;
        },
        /** Changes some of any object's properties: the server may change them all. Answers false when there's no such object. */
        set(objectId, changes) {
          const object = kindState.objects[objectId];
          checkProperties(changes, "changes");
          if (!object) return false;
          checkProperties({ ...object.properties, ...changes }, "properties");
          object.revision_number += 1;
          Object.assign(object.properties, structuredClone(changes));
          kindContext.broadcast({ type: "change", object_id: objectId, revision_number: object.revision_number, properties: object.properties });
          return true;
        },
        /** Hands any object to a player, or with null to the server. Answers false when there's no such object. */
        setOwner(objectId, ownerPlayerId) {
          const object = kindState.objects[objectId];
          if (!object) return false;
          if (ownerPlayerId !== null && !kindContext.playerIds().includes(ownerPlayerId)) refuse("unknown_player", `${JSON.stringify(ownerPlayerId)} isn't a player in the room.`, "ownerPlayerId", "Give the id of a player in the room, or null.");
          object.revision_number += 1;
          object.owner_player_id = ownerPlayerId;
          kindContext.broadcast({ type: "owner", object_id: objectId, revision_number: object.revision_number, owner_player_id: ownerPlayerId });
          return true;
        },
        remove(objectId) {
          if (!(objectId in kindState.objects)) return false;
          delete kindState.objects[objectId];
          kindContext.broadcast({ type: "remove", object_id: objectId });
          return true;
        },
        get: (objectId) => (objectId in kindState.objects ? shown(objectId, copyOf(kindState.objects[objectId])) : null),
        all: () => Object.entries(kindState.objects).map(([objectId, object]) => shown(objectId, copyOf(object))),
      }),
    },
  });
}
