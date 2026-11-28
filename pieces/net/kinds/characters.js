// Characters: things that move every step from inputs, like a player's character or a bot. A piece declares what
// a character shares (its state's fields, its input's fields) and how it moves (step); the core decides how it's
// sent, the way Shieldbreak's netcode proved it:
//
// - With a game server, the server is the word. Each player's game moves its own character at once from its own
//   inputs (prediction), numbers and sends them, and when the server's state arrives starts from it and applies
//   the inputs it hasn't answered yet again; what was off eases away instead of jumping. The server applies inputs
//   one a step behind a buffer as deep as their arrival's jitter, catches up a backlog two a step, never runs a
//   player faster than time allows, and repeats the last movement for a moment when inputs stop coming.
// - On the relay, each player's game is the word on its own character and the host's on the bots.
// - Everyone else's characters are drawn a moment behind, blended between snapshots, with a short guess when one
//   is late, and the game server keeps half a second of where everyone was so a hit can be judged by what the
//   attacker saw.
import { addOffsets, createReader, createWriter, defaultValueOf, defineShape, fromList, isOffsetZero, offsetValue, quantizeValue, readValue, scaleOffset, settleValue, toList, valueDifference, blendValues, checkChanges, writeValue } from "../shape.js";
import { createSnapshotBuffer, createTimeline } from "../timing.js";
import { isPlainObject, refuse, refuseUnknown } from "../wire.js";
import { defineKind } from "./define.js";

const PLAYER_CHARACTER_MODES = ["on_join", "by_game"];
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Characters one room holds, at most: one snapshot carries them all. */
export const MAXIMUM_CHARACTER_COUNT = 64;
const SNAPSHOT_FORMAT_NUMBER = 1;
const OWNER_KIND_AUTHORITY_CODE = 0;
const OWNER_KIND_PLAYER_CODE = 1;

// The game server's input buffer, as Shieldbreak tuned it (shared/src/constants.ts), counted in steps.
/** Time a player may bank while no inputs arrive, so a burst after a stall catches up. */
const MAXIMUM_INPUT_CREDIT_TICK_COUNT = 8;
/** Inputs one character takes in one step at most. */
const MAXIMUM_INPUT_COUNT_PER_TICK = 6;
/** Steps without input before the last movement repeats. */
const INPUT_STARVE_GRACE_TICK_COUNT = 6;
/** The deepest the buffer grows to cover jitter in arrival. */
const MAXIMUM_INPUT_BUFFER_TICK_COUNT = 3;
/** How fast the measured jitter decays a step: one step of buffer every 3 seconds at 60. */
const INPUT_JITTER_DECAY_TICK_COUNT_PER_TICK = 1 / 180;
/** Queued beyond this, the server catches up faster than two inputs a step. */
const MAXIMUM_INPUT_LAG_COUNT = 8;
/** Inputs the server repeats at most while none come; that many late ones are skipped when they do. */
const MAXIMUM_REPEATED_INPUT_COUNT = 12;
/** Inputs one character holds waiting at most; more are dropped as they come. */
const MAXIMUM_QUEUED_INPUT_COUNT = 30;
/** Inputs one message carries at most. */
const MAXIMUM_INPUT_COUNT_PER_MESSAGE = 8;
/** A player's game slows its steps a little while more than this many of its inputs wait on the server, and goes back to time at this. */
const SLOW_DOWN_ABOVE_COUNT = MAXIMUM_INPUT_BUFFER_TICK_COUNT + 3;
const SLOW_DOWN_UNTIL_COUNT = MAXIMUM_INPUT_BUFFER_TICK_COUNT + 1;
/** While slowed, one step in this many is skipped: about 3% slower. */
const SLOW_DOWN_SKIP_EVERY_TICK_COUNT = 33;
/** How far back the game server keeps where every character was, for judging a hit by what the attacker saw. */
const HISTORY_DURATION_MS = 500;
/** The furthest back a player's view counts: more than this behind, it's judged at this. */
const MAXIMUM_VIEW_DELAY_MS = 500;
/** A correction smaller than this in every field isn't told: it's the rounding of numbers on their trip. */
const MINIMUM_TOLD_CORRECTION_NUMBER = 1e-4;

function checkCharacterId(characterId) {
  if (typeof characterId !== "string" || !CHARACTER_ID_PATTERN.test(characterId)) refuse("bad_character_id", `${JSON.stringify(characterId)} isn't a character's id.`, "characterId", 'Give 1 to 64 letters, digits, "_", ".", ":" or "-", like "bot:1". A player\'s character has the player\'s id.');
  return characterId;
}

/** A snapshot: every character a sender is the word on, in a few bytes each. */
function writeSnapshot(stateShape, { ticksPerSec, timeMs, characters }) {
  const writer = createWriter(32 + characters.length * (stateShape.byteCount + 48));
  writer.uint8(SNAPSHOT_FORMAT_NUMBER);
  writer.uint8(ticksPerSec);
  writer.float64(timeMs);
  writer.uint8(characters.length);
  for (const character of characters) {
    writer.text(character.characterId);
    writer.uint8(character.ownerKind);
    writer.uint8(character.resetNumber & 0xff);
    writer.uint32(character.lastInputNumber >>> 0);
    writer.uint8(Math.min(character.queuedInputCount, 255));
    writeValue(stateShape, writer, character.state);
  }
  return writer.done();
}

/** A snapshot read back, or null when it isn't one whole. */
function readSnapshot(stateShape, bytes) {
  const reader = createReader(bytes);
  if (reader.uint8() !== SNAPSHOT_FORMAT_NUMBER) return null;
  const ticksPerSec = reader.uint8();
  const timeMs = reader.float64();
  const characterCount = reader.uint8();
  if (characterCount === null || !Number.isFinite(timeMs) || characterCount > MAXIMUM_CHARACTER_COUNT) return null;
  const characters = [];
  for (let index = 0; index < characterCount; index += 1) {
    const characterId = reader.text();
    const ownerKind = reader.uint8();
    const resetNumber = reader.uint8();
    const lastInputNumber = reader.uint32();
    const queuedInputCount = reader.uint8();
    const state = readValue(stateShape, reader);
    if (state === null || typeof characterId !== "string" || !CHARACTER_ID_PATTERN.test(characterId)) return null;
    characters.push({ characterId, ownerKind, resetNumber, lastInputNumber, queuedInputCount, state });
  }
  return reader.isAtEnd ? { ticksPerSec, timeMs, characters } : null;
}

/**
 * Characters. stateFields and inputFields declare what a character shares and what moves it (index.d.ts,
 * "Shapes"); step(state, input, stepContext) answers the state one fixed step later, the same function in every
 * player's game and on the game server; startState(characterId) answers where a character starts (fields left
 * out start at their defaults). playerCharacterMode "on_join" (the default) gives every player a character as
 * they join, with their id; "by_game" leaves it to the game.
 */
export function charactersKind(given) {
  refuseUnknown(given, ["stateFields", "inputFields", "step", "startState", "playerCharacterMode"], "charactersKind");
  const { step, startState = null, playerCharacterMode = "on_join" } = given ?? {};
  const stateShape = defineShape(given?.stateFields, { what: "stateFields", isPressAllowed: false });
  const inputShape = defineShape(given?.inputFields, { what: "inputFields", isPressAllowed: true });
  if (typeof step !== "function") refuse("step_missing", "charactersKind needs step: how a character moves in one fixed step.", "step", "Give step(state, input, { characterId, tickDurationSec, isReplay }) answering the next state, the same function in the game and on its game server.");
  if (startState !== null && typeof startState !== "function") refuse("bad_argument", "startState isn't a function.", "startState", "Give startState(characterId) answering the fields a character starts with, or leave it out.");
  if (!PLAYER_CHARACTER_MODES.includes(playerCharacterMode)) refuse("bad_argument", `playerCharacterMode is ${JSON.stringify(playerCharacterMode)}.`, "playerCharacterMode", `Use: ${PLAYER_CHARACTER_MODES.join(", ")}.`);
  const pressNames = inputShape.fields.filter((field) => field.valueKind === "press").map((field) => field.name);
  const idleInput = defaultValueOf(inputShape);

  const startOf = (characterId, givenState) => {
    const base = { ...defaultValueOf(stateShape), ...(startState ? startState(characterId) ?? {} : {}), ...(givenState ?? {}) };
    return quantizeValue(stateShape, base);
  };
  /** One fixed step of a character, settled and put on the shape's steps, so every side holds exactly the same. */
  const runStep = (state, input, characterId, tickDurationSec, isReplay) => {
    const copy = { ...state };
    const answered = step(copy, { ...input }, { characterId, tickDurationSec, isReplay });
    return quantizeValue(stateShape, answered === undefined ? copy : answered);
  };
  const withoutPresses = (input) => {
    const held = { ...input };
    for (const name of pressNames) held[name] = false;
    return held;
  };

  return defineKind({
    name: "characters",
    isTickNeeded: true,
    client(kindContext) {
      const isOnHost = kindContext.authorityKind === "host";
      /** Every character this game knows: { ownerKind, resetNumber, buffer } for those drawn from snapshots. */
      const characters = new Map();
      /** The characters this game moves itself: its own, and the bots while it's the host on the relay. */
      const simulated = new Map();
      const listeners = { added: new Set(), removed: new Set() };
      let tickCount = 0;
      // With a game server: the own character's inputs not yet answered, those not yet sent, and the pace.
      let waitingInputs = [];
      let unsentInputs = [];
      let nextInputNumber = 1;
      let isSlowedDown = false;
      let lastSnapshotTimeMs = -Infinity;

      /** When to draw what each sender sends: the game server's, or on the relay each player's own. */
      const timelines = new Map();
      const timelineOf = (senderKey) => {
        if (!timelines.has(senderKey)) timelines.set(senderKey, createTimeline({ minimumDelayMs: kindContext.settings.get("minimumInterpolationDelayMs") }));
        return timelines.get(senderKey);
      };
      const telling = (eventName, characterId) => {
        for (const listener of [...listeners[eventName]]) listener(characterId);
      };
      const bufferOf = () =>
        createSnapshotBuffer({
          mix: (earlier, later, fractionNumber) => blendValues(stateShape, earlier, later, fractionNumber),
          maximumExtrapolationMs: kindContext.settings.get("maximumExtrapolationMs"),
        });
      const addKnown = (characterId, ownerKind, senderKey) => {
        if (characters.has(characterId)) {
          const known = characters.get(characterId);
          if (senderKey) known.senderKey = senderKey;
          return known;
        }
        const known = { ownerKind, resetNumber: 0, buffer: bufferOf(), senderKey: senderKey ?? "server" };
        characters.set(characterId, known);
        telling("added", characterId);
        return known;
      };
      const forget = (characterId) => {
        simulated.delete(characterId);
        if (characters.delete(characterId)) telling("removed", characterId);
      };
      /** The own character's input set before it's here (with a game server, until its first snapshot): it starts with it. */
      let earlyOwnInput = { ...idleInput };
      const simulate = (characterId, state, ownerKind) => {
        const known = addKnown(characterId, ownerKind);
        const quantized = quantizeValue(stateShape, state);
        const input = characterId === ownId() ? earlyOwnInput : { ...idleInput };
        if (characterId === ownId()) earlyOwnInput = { ...idleInput };
        simulated.set(characterId, { state: quantized, previousState: quantized, correction: {}, input, lastTickAtMs: kindContext.serverTimeMs() });
        return known;
      };
      const ownId = () => kindContext.myPlayerId;
      const isPlayerId = (characterId) => kindContext.playerIds().includes(characterId);
      const snapshotEveryTickCount = () => Math.max(1, Math.round(kindContext.ticker.ticksPerSec / Math.min(kindContext.settings.get("snapshotsPerSec"), kindContext.ticker.ticksPerSec)));

      // Settings changed while playing reach the buffers already made.
      kindContext.settings.onChange(({ name, newValue }) => {
        if (name === "minimumInterpolationDelayMs") for (const timeline of timelines.values()) timeline.minimumDelayMs = newValue;
        if (name === "maximumExtrapolationMs") for (const known of characters.values()) known.buffer.maximumExtrapolationMs = newValue;
      });

      /** Applies the game server's state for this player's own character, and the inputs it hasn't answered on top. */
      function reconcile(snapshotCharacter) {
        const own = simulated.get(snapshotCharacter.characterId);
        const known = characters.get(snapshotCharacter.characterId);
        if (!own) {
          simulate(snapshotCharacter.characterId, snapshotCharacter.state, OWNER_KIND_PLAYER_CODE).resetNumber = snapshotCharacter.resetNumber;
          waitingInputs = waitingInputs.filter((numbered) => numbered.inputNumber > snapshotCharacter.lastInputNumber);
          return;
        }
        waitingInputs = waitingInputs.filter((numbered) => numbered.inputNumber > snapshotCharacter.lastInputNumber);
        let next = snapshotCharacter.state;
        for (const numbered of waitingInputs) next = runStep(next, numbered.input, snapshotCharacter.characterId, kindContext.ticker.tickDurationSec, true);
        const isSnapped = snapshotCharacter.resetNumber !== known.resetNumber;
        known.resetNumber = snapshotCharacter.resetNumber;
        const difference = valueDifference(stateShape, own.state, next);
        if (isSnapped) {
          own.correction = {};
          own.previousState = next;
        } else {
          own.correction = addOffsets(stateShape, own.correction, difference);
          own.previousState = offsetValue(stateShape, own.previousState, scaleOffset(difference, -1));
        }
        own.state = next;
        if (isSnapped || Object.values(difference).some((by) => Math.abs(by) > MINIMUM_TOLD_CORRECTION_NUMBER)) kindContext.tell("characterCorrected", { characterId: snapshotCharacter.characterId, difference, isSnapped });
        // The pace: a game far ahead of the server slows a little until it's back in step.
        if (snapshotCharacter.queuedInputCount > SLOW_DOWN_ABOVE_COUNT) isSlowedDown = true;
        else if (snapshotCharacter.queuedInputCount <= SLOW_DOWN_UNTIL_COUNT) isSlowedDown = false;
      }

      kindContext.onBytes((bytes, fromPlayerId) => {
        const snapshot = readSnapshot(stateShape, bytes);
        if (!snapshot) return;
        if (!isOnHost) {
          // The game server is the word on everyone, and its snapshot holds every character there is.
          if (snapshot.timeMs <= lastSnapshotTimeMs) return;
          lastSnapshotTimeMs = snapshot.timeMs;
          if (snapshot.ticksPerSec !== kindContext.ticker.ticksPerSec && snapshot.ticksPerSec >= 1) kindContext.ticker.setTicksPerSec(Math.min(snapshot.ticksPerSec, 60));
          timelineOf("server").noteArrival(snapshot.timeMs, kindContext.serverTimeMs());
          const present = new Set();
          for (const each of snapshot.characters) {
            present.add(each.characterId);
            if (each.characterId === ownId() && each.ownerKind === OWNER_KIND_PLAYER_CODE && !kindContext.isSpectator) {
              reconcile(each);
              continue;
            }
            const known = addKnown(each.characterId, each.ownerKind, "server");
            if (each.resetNumber !== known.resetNumber) known.buffer.clear();
            known.resetNumber = each.resetNumber;
            known.buffer.add(snapshot.timeMs, each.state);
          }
          for (const characterId of [...characters.keys()]) if (!present.has(characterId)) forget(characterId);
          return;
        }
        // On the relay a player is the word on their own character, and the host on the bots.
        if (!fromPlayerId || fromPlayerId === ownId()) return;
        const isFromAuthority = fromPlayerId === kindContext.authorityPlayerId();
        const botIdsSent = new Set();
        timelineOf(fromPlayerId).noteArrival(snapshot.timeMs, kindContext.serverTimeMs());
        for (const each of snapshot.characters) {
          const isOwnersOwn = each.ownerKind === OWNER_KIND_PLAYER_CODE && each.characterId === fromPlayerId;
          const isBot = each.ownerKind === OWNER_KIND_AUTHORITY_CODE && isFromAuthority && !isPlayerId(each.characterId);
          if (!isOwnersOwn && !isBot) continue;
          if (isBot) botIdsSent.add(each.characterId);
          if (simulated.has(each.characterId)) continue;
          if (!characters.has(each.characterId) && characters.size >= MAXIMUM_CHARACTER_COUNT) continue;
          const known = addKnown(each.characterId, each.ownerKind, fromPlayerId);
          if (each.resetNumber !== known.resetNumber) known.buffer.clear();
          known.resetNumber = each.resetNumber;
          known.buffer.add(snapshot.timeMs, each.state);
        }
        if (isFromAuthority) {
          for (const [characterId, known] of characters) if (known.ownerKind === OWNER_KIND_AUTHORITY_CODE && !botIdsSent.has(characterId) && !simulated.has(characterId)) forget(characterId);
        }
      });

      kindContext.onPlayersChanged((playerIds, authorityPlayerId) => {
        const present = new Set(playerIds);
        for (const [characterId, known] of [...characters]) if (known.ownerKind === OWNER_KIND_PLAYER_CODE && !present.has(characterId)) forget(characterId);
        for (const senderKey of [...timelines.keys()]) if (senderKey !== "server" && !present.has(senderKey)) timelines.delete(senderKey);
        if (!isOnHost) return;
        // A new host takes the bots on from where it last saw them; one that isn't the host any more lets them go.
        for (const [characterId, known] of characters) {
          if (known.ownerKind !== OWNER_KIND_AUTHORITY_CODE) continue;
          if (authorityPlayerId === ownId() && !simulated.has(characterId)) {
            const newest = known.buffer.newest();
            if (newest) simulated.set(characterId, { state: newest, previousState: newest, correction: {}, input: { ...idleInput }, lastTickAtMs: kindContext.serverTimeMs() });
          } else if (authorityPlayerId !== ownId() && simulated.has(characterId)) {
            known.buffer.clear();
            known.senderKey = authorityPlayerId ?? "server";
            simulated.delete(characterId);
          }
        }
      });
      kindContext.onReset(() => {
        for (const characterId of [...characters.keys()]) forget(characterId);
        timelines.clear();
        waitingInputs = [];
        unsentInputs = [];
        lastSnapshotTimeMs = -Infinity;
        if (isOnHost && playerCharacterMode === "on_join" && !kindContext.isSpectator) simulate(ownId(), startOf(ownId()), OWNER_KIND_PLAYER_CODE);
      });

      kindContext.onTick(() => {
        tickCount += 1;
        const nowMs = kindContext.serverTimeMs();
        const tickDurationSec = kindContext.ticker.tickDurationSec;
        if (!isOnHost) {
          const own = simulated.get(ownId());
          if (!own || kindContext.isSpectator) return;
          if (isSlowedDown && tickCount % SLOW_DOWN_SKIP_EVERY_TICK_COUNT === 0) return;
          const input = own.input;
          own.input = withoutPresses(input);
          own.previousState = own.state;
          own.state = runStep(own.state, input, ownId(), tickDurationSec, false);
          own.lastTickAtMs = nowMs;
          const inputNumber = nextInputNumber;
          nextInputNumber += 1;
          waitingInputs.push({ inputNumber, input });
          if (waitingInputs.length > 120) waitingInputs.shift();
          unsentInputs.push([inputNumber, toList(inputShape, input)]);
          if (unsentInputs.length >= Math.ceil(kindContext.ticker.ticksPerSec / 30)) {
            kindContext.send({ type: "inputs", view_time_ms: timelineOf("server").drawnAtMs(nowMs), inputs: unsentInputs });
            unsentInputs = [];
          }
          return;
        }
        for (const [characterId, moving] of simulated) {
          const input = moving.input;
          moving.input = withoutPresses(input);
          moving.previousState = moving.state;
          moving.state = runStep(moving.state, input, characterId, tickDurationSec, false);
          moving.lastTickAtMs = nowMs;
        }
        if (simulated.size && tickCount % snapshotEveryTickCount() === 0) {
          const sent = [...simulated].map(([characterId, moving]) => ({ characterId, ownerKind: characters.get(characterId).ownerKind, resetNumber: characters.get(characterId).resetNumber, lastInputNumber: 0, queuedInputCount: 0, state: moving.state }));
          kindContext.sendBytes(writeSnapshot(stateShape, { ticksPerSec: kindContext.ticker.ticksPerSec, timeMs: nowMs, characters: sent }), { delivery: "latest_only", latestKey: "characters" });
        }
      });

      kindContext.onFrame((frameDurationSec) => {
        const smoothingSec = kindContext.settings.get("correctionSmoothingSec");
        const keptFractionNumber = smoothingSec > 0 ? Math.exp(-frameDurationSec / smoothingSec) : 0;
        for (const moving of simulated.values()) if (!isOffsetZero(moving.correction)) moving.correction = scaleOffset(moving.correction, keptFractionNumber);
      });

      if (isOnHost && playerCharacterMode === "on_join" && !kindContext.isSpectator) simulate(ownId(), startOf(ownId()), OWNER_KIND_PLAYER_CODE);

      /** Whether this game is the word on a character now. */
      const isInChargeOf = (characterId) => isOnHost && simulated.has(characterId);
      const knownOrRefuse = (characterId) => {
        if (!characters.has(characterId)) refuse("unknown_character", `There's no character ${JSON.stringify(characterId)} here.`, "characterId", "Give the id of a character in ids(): a player's has the player's id.");
        return characters.get(characterId);
      };

      return {
        stateShape,
        inputShape,
        /** This player's own character's id: their player id. */
        get ownCharacterId() {
          return ownId();
        },
        /** Every character's id, in the order they came. */
        ids: () => [...characters.keys()],
        /** Whether there's a character with this id. */
        has: (characterId) => characters.has(characterId),
        /**
         * The input for this player's own character from now on, or with { characterId } a bot's the host moves
         * on the relay. Only the fields given change; a press (valueKind "press") counts once, at the next step.
         */
        setInput(input, setOptions) {
          refuseUnknown(setOptions, ["characterId"], "setOptions");
          const characterId = setOptions?.characterId ?? ownId();
          checkChanges(inputShape, input, "input");
          const moving = simulated.get(characterId);
          const isEarlyOwn = !moving && characterId === ownId() && !kindContext.isSpectator && !characters.has(characterId);
          if (!moving && !isEarlyOwn) return false;
          const target = moving ? moving.input : earlyOwnInput;
          for (const [name, givenValue] of Object.entries(input)) target[name] = pressNames.includes(name) ? target[name] || givenValue : givenValue;
          return true;
        },
        /**
         * Where to draw a character now: the own character a step behind its newest with any correction easing
         * away, everyone else blended a moment behind. null for a character not here yet.
         */
        drawn(characterId) {
          const moving = simulated.get(characterId);
          if (moving) {
            const tickDurationMs = kindContext.ticker.tickDurationSec * 1000;
            const fractionNumber = Math.min(Math.max((kindContext.serverTimeMs() - moving.lastTickAtMs) / tickDurationMs, 0), 1);
            return offsetValue(stateShape, blendValues(stateShape, moving.previousState, moving.state, fractionNumber), moving.correction);
          }
          const known = characters.get(characterId);
          return known ? known.buffer.snapshotAt(timelineOf(known.senderKey).drawnAtMs(kindContext.serverTimeMs())) : null;
        },
        /**
         * The moment on the room's clock a character is drawn at now: the room's now for one this game moves, a
         * moment behind for everyone else's. null for a character not here.
         */
        drawnAtMs(characterId) {
          if (simulated.has(characterId)) return kindContext.serverTimeMs();
          const known = characters.get(characterId);
          return known ? timelineOf(known.senderKey).drawnAtMs(kindContext.serverTimeMs()) : null;
        },
        /** A character's newest state: its own simulation's, or the newest snapshot's. null for a character not here yet. */
        state(characterId) {
          const moving = simulated.get(characterId);
          if (moving) return { ...moving.state };
          const known = characters.get(characterId);
          const newest = known?.buffer.newest();
          return newest ? { ...newest } : null;
        },
        /** Whether this game moves a character itself: its own, and the bots while it's the host on the relay. */
        isSimulated: (characterId) => simulated.has(characterId),
        /**
         * On the relay: adds a character this game is the word on: the own one (playerCharacterMode "by_game"), or
         * with another id a bot, by the host. With a game server, characters are added there. Answers false when
         * the id is taken or it isn't this game's to add.
         */
        add(characterId, addOptions) {
          refuseUnknown(addOptions, ["state"], "addOptions");
          checkCharacterId(characterId);
          if (addOptions?.state !== undefined) checkChanges(stateShape, addOptions.state, "state");
          if (!isOnHost) refuse("not_in_charge", "With a game server, characters are added there.", "characterId", "Add it in the game server's code: characters.onServer(state, room).add(characterId).");
          if (kindContext.isSpectator || characters.has(characterId)) return false;
          const isOwn = characterId === ownId();
          if (!isOwn && (!kindContext.isAuthority() || isPlayerId(characterId))) return false;
          if (characters.size >= MAXIMUM_CHARACTER_COUNT) refuse("too_many_characters", `A room holds at most ${MAXIMUM_CHARACTER_COUNT} characters.`, "characterId", "Remove characters nobody needs.");
          simulate(characterId, startOf(characterId, addOptions?.state), isOwn ? OWNER_KIND_PLAYER_CODE : OWNER_KIND_AUTHORITY_CODE);
          return true;
        },
        /** On the relay: removes a character this game is the word on. Answers false otherwise. */
        remove(characterId) {
          if (!isInChargeOf(characterId)) return false;
          forget(characterId);
          return true;
        },
        /**
         * On the relay: sets fields of a character this game is the word on, at once and for everyone, like a
         * respawn. With isTeleport (the default) others jump to it instead of blending there. Answers false
         * otherwise; with a game server, the server does this.
         */
        set(characterId, changes, setOptions) {
          refuseUnknown(setOptions, ["isTeleport"], "setOptions");
          checkChanges(stateShape, changes, "changes");
          knownOrRefuse(characterId);
          if (!isInChargeOf(characterId)) return false;
          const moving = simulated.get(characterId);
          moving.state = quantizeValue(stateShape, { ...moving.state, ...changes });
          if (setOptions?.isTeleport !== false) {
            moving.previousState = moving.state;
            moving.correction = {};
            characters.get(characterId).resetNumber = (characters.get(characterId).resetNumber + 1) & 0xff;
          }
          return true;
        },
        /** Hears "added" or "removed": listener(characterId). Answers a function that stops listening. */
        on(eventName, listener) {
          if (!(eventName in listeners)) refuse("unknown_event", `There's no event ${JSON.stringify(eventName)}.`, "eventName", "Listen for: added, removed.");
          if (typeof listener !== "function") refuse("bad_argument", "on takes a listener function.", "listener", "Give (characterId) => { ... }.");
          listeners[eventName].add(listener);
          return () => listeners[eventName].delete(listener);
        },
      };
    },
    server: {
      setup: () => ({ characters: {}, tick_count: 0 }),
      onJoin(kindState, player, kindContext) {
        if (playerCharacterMode !== "on_join" || kindState.characters[player.id] || Object.keys(kindState.characters).length >= MAXIMUM_CHARACTER_COUNT) return;
        kindState.characters[player.id] = newServerCharacter(player.id, startOf(player.id));
      },
      onLeave(kindState, player) {
        if (kindState.characters[player.id]?.owner_player_id === player.id) delete kindState.characters[player.id];
      },
      onMessage(kindState, player, kindMessage, kindContext) {
        const character = kindState.characters[player.id];
        if (!character || character.owner_player_id !== player.id || !isPlainObject(kindMessage) || kindMessage.type !== "inputs" || !Array.isArray(kindMessage.inputs)) return;
        const nowMs = kindContext.serverTimeMs();
        if (Number.isFinite(kindMessage.view_time_ms)) character.view_time_ms = Math.min(Math.max(kindMessage.view_time_ms, nowMs - MAXIMUM_VIEW_DELAY_MS), nowMs);
        let newestInputNumber = character.queue.length ? character.queue[character.queue.length - 1][0] : character.last_input_number;
        for (const sent of kindMessage.inputs.slice(0, MAXIMUM_INPUT_COUNT_PER_MESSAGE)) {
          if (!Array.isArray(sent) || !Number.isInteger(sent[0]) || sent[0] <= newestInputNumber || sent[0] > newestInputNumber + 1000) continue;
          newestInputNumber = sent[0];
          character.arrived_count += 1;
          if (character.queue.length >= MAXIMUM_QUEUED_INPUT_COUNT) continue;
          const checked = fromList(inputShape, sent[1]);
          const answered = kindContext.ask("beforeCharacterInput", checked, { characterId: player.id, playerId: player.id, roomState: kindContext.roomState });
          // A dropped input still counts as answered, so the player's game stops waiting on it.
          character.queue.push([sent[0], answered === null ? null : toList(inputShape, settleValue(inputShape, answered))]);
        }
      },
      onTick(kindState, tickDurationSec, kindContext) {
        kindState.tick_count += 1;
        const fixedTickDurationSec = 1 / kindContext.ticksPerSec;
        const nowMs = kindContext.serverTimeMs();
        for (const [characterId, character] of Object.entries(kindState.characters)) {
          const apply = (input) => {
            character.state = runStep(character.state, input, characterId, fixedTickDurationSec, false);
          };
          if (character.owner_player_id !== null) drainInputs(character, apply);
          else {
            apply(fromList(inputShape, character.bot_input));
            character.bot_input = toList(inputShape, withoutPresses(fromList(inputShape, character.bot_input)));
          }
          character.history.push([nowMs, toList(stateShape, character.state)]);
          while (character.history.length > 2 && character.history[1][0] < nowMs - HISTORY_DURATION_MS) character.history.shift();
        }
        const snapshotEveryTickCount = Math.max(1, Math.round(kindContext.ticksPerSec / Math.min(kindContext.settings.get("snapshotsPerSec"), kindContext.ticksPerSec)));
        if (kindState.tick_count % snapshotEveryTickCount !== 0 || !Object.keys(kindState.characters).length) return;
        const sent = Object.entries(kindState.characters).map(([characterId, character]) => ({
          characterId,
          ownerKind: character.owner_player_id === null ? OWNER_KIND_AUTHORITY_CODE : OWNER_KIND_PLAYER_CODE,
          resetNumber: character.reset_number,
          lastInputNumber: character.last_input_number,
          queuedInputCount: character.queue.length,
          state: character.state,
        }));
        kindContext.broadcastBytes(writeSnapshot(stateShape, { ticksPerSec: kindContext.ticksPerSec, timeMs: nowMs, characters: sent }), { delivery: "latest_only", latestKey: "characters" });
      },
      api: (kindState, kindContext) => {
        const characterOf = (characterId) => {
          const character = kindState.characters[characterId];
          if (!character) refuse("unknown_character", `There's no character ${JSON.stringify(characterId)} here.`, "characterId", "Give the id of a character in ids(): a player's has the player's id.");
          return character;
        };
        return {
          /** Every character's id. */
          ids: () => Object.keys(kindState.characters),
          has: (characterId) => characterId in kindState.characters,
          /** A character's state now. */
          state: (characterId) => ({ ...characterOf(characterId).state }),
          /**
           * Adds a character: with a player's id, that player's (playerCharacterMode "by_game"), moved by their
           * inputs; with another id, a bot the server moves with setInput. Answers false when the id is taken.
           */
          add(characterId, addOptions) {
            refuseUnknown(addOptions, ["state"], "addOptions");
            checkCharacterId(characterId);
            if (addOptions?.state !== undefined) checkChanges(stateShape, addOptions.state, "state");
            if (characterId in kindState.characters) return false;
            if (Object.keys(kindState.characters).length >= MAXIMUM_CHARACTER_COUNT) refuse("too_many_characters", `A room holds at most ${MAXIMUM_CHARACTER_COUNT} characters.`, "characterId", "Remove characters nobody needs.");
            const ownerPlayerId = kindContext.playerIds().includes(characterId) ? characterId : null;
            kindState.characters[characterId] = newServerCharacter(ownerPlayerId, startOf(characterId, addOptions?.state));
            kindState.characters[characterId].bot_input = toList(inputShape, idleInput);
            return true;
          },
          /** Removes a character. Answers false when there's none. */
          remove(characterId) {
            if (!(characterId in kindState.characters)) return false;
            delete kindState.characters[characterId];
            return true;
          },
          /** Sets fields of any character at once, like a respawn or a knockback. With isTeleport (the default) everyone jumps to it, its own player included, instead of easing there. */
          set(characterId, changes, setOptions) {
            refuseUnknown(setOptions, ["isTeleport"], "setOptions");
            checkChanges(stateShape, changes, "changes");
            const character = characterOf(characterId);
            character.state = quantizeValue(stateShape, { ...character.state, ...changes });
            if (setOptions?.isTeleport !== false) character.reset_number = (character.reset_number + 1) & 0xff;
            return true;
          },
          /** A bot's input from now on: only the fields given change; a press counts once. Answers false for a player's character. */
          setInput(characterId, input) {
            checkChanges(inputShape, input, "input");
            const character = characterOf(characterId);
            if (character.owner_player_id !== null) return false;
            const current = fromList(inputShape, character.bot_input);
            for (const [name, givenValue] of Object.entries(input)) current[name] = pressNames.includes(name) ? current[name] || givenValue : givenValue;
            character.bot_input = toList(inputShape, current);
            return true;
          },
          /**
           * Where a character was at a time on the room's clock, blended, from the last half second: to judge a hit
           * by what the attacker saw, ask at viewTimeMs(attackerPlayerId). The oldest or newest held outside it.
           */
          stateAt(characterId, timeMs) {
            const { history, state } = characterOf(characterId);
            if (!history.length) return { ...state };
            if (timeMs <= history[0][0]) return fromList(stateShape, history[0][1]);
            for (let index = 1; index < history.length; index += 1) {
              const [laterMs, later] = history[index];
              if (laterMs < timeMs) continue;
              const [earlierMs, earlier] = history[index - 1];
              return blendValues(stateShape, fromList(stateShape, earlier), fromList(stateShape, later), (timeMs - earlierMs) / (laterMs - earlierMs || 1));
            }
            return { ...state };
          },
          /** When on the room's clock a player last saw everyone else (their newest input's), or the room's now when they haven't said. */
          viewTimeMs(playerId) {
            return kindState.characters[playerId]?.view_time_ms ?? kindContext.serverTimeMs();
          },
        };
      },
    },
  });

  /** A character as the game server keeps it: plain JSON, with its input buffer. */
  function newServerCharacter(ownerPlayerId, state) {
    return {
      owner_player_id: ownerPlayerId,
      state,
      reset_number: 0,
      last_input_number: 0,
      queue: [],
      arrived_count: 0,
      credit_count: 1,
      jitter_tick_count: 0,
      starved_tick_count: 0,
      repeated_count: 0,
      carried_press_names: [],
      last_input: null,
      bot_input: toList(inputShape, idleInput),
      view_time_ms: null,
      history: [],
    };
  }

  /**
   * Applies this step's inputs for one player's character, as Shieldbreak's World.drainInputs does: one a step,
   * a few kept back as a buffer as deep as the jitter in their arrival, a backlog beyond it caught up two a step
   * (faster only when far behind), always within the time banked; starved past a grace, the last movement repeats
   * and as many late inputs are skipped when they come. A press in a skipped or dropped input is never lost.
   */
  function drainInputs(character, apply) {
    character.credit_count = Math.min(character.credit_count + 1, MAXIMUM_INPUT_CREDIT_TICK_COUNT);
    const burstCount = character.arrived_count - 1;
    character.arrived_count = 0;
    if (burstCount > character.jitter_tick_count) character.jitter_tick_count = Math.min(burstCount, MAXIMUM_INPUT_BUFFER_TICK_COUNT);
    else character.jitter_tick_count = Math.max(character.jitter_tick_count - INPUT_JITTER_DECAY_TICK_COUNT_PER_TICK, 0);
    const keptCount = Math.ceil(character.jitter_tick_count - 1e-6);
    let appliedCount = 0;
    let isSkipped = false;
    const carry = (list) => {
      if (!list) return;
      const input = fromList(inputShape, list);
      for (const name of pressNames) if (input[name] && !character.carried_press_names.includes(name)) character.carried_press_names.push(name);
    };
    while (character.queue.length && appliedCount < MAXIMUM_INPUT_COUNT_PER_TICK) {
      const [inputNumber, list] = character.queue[0];
      if (character.repeated_count > 0) {
        // Already run by a repeat: answered, its presses kept, and its movement the one repeats follow now.
        character.repeated_count -= 1;
        carry(list);
        if (list) character.last_input = list;
        character.last_input_number = inputNumber;
        character.queue.shift();
        isSkipped = true;
        continue;
      }
      if (character.credit_count < 1) break;
      if (appliedCount >= 1 && (character.queue.length <= keptCount || (appliedCount >= 2 && character.queue.length <= MAXIMUM_INPUT_LAG_COUNT))) break;
      character.queue.shift();
      character.last_input_number = inputNumber;
      if (!list) continue; // dropped by the game's beforeCharacterInput: answered, never run
      const input = fromList(inputShape, list);
      for (const name of character.carried_press_names) input[name] = true;
      character.carried_press_names = [];
      apply(input);
      character.last_input = list;
      character.credit_count -= 1;
      appliedCount += 1;
    }
    if (appliedCount > 0) {
      character.starved_tick_count = 0;
      return;
    }
    if (character.queue.length > 0) return; // waiting for time to be banked
    if (isSkipped) {
      character.starved_tick_count = 0;
      return;
    }
    character.starved_tick_count += 1;
    if (character.starved_tick_count > INPUT_STARVE_GRACE_TICK_COUNT && character.last_input && character.credit_count >= 1 && character.repeated_count < MAXIMUM_REPEATED_INPUT_COUNT) {
      apply(withoutPresses(fromList(inputShape, character.last_input)));
      character.credit_count -= 1;
      character.repeated_count += 1;
    }
  }
}
