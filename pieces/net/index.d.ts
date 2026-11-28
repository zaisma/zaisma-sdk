/**
 * @zaisma/net: the online core, in a player's game. One room carries every kind of sync a game uses: characters,
 * objects, events and turns. Each piece says what it shares, never how: the core decides how it's sent, the same
 * way on Zaisma's relay (no server code), on a game server in Zaisma's rooms, and on that game server run on the
 * developer's own machine. Only one word in the game changes between them: authorityKind.
 *
 * - Characters move every step from inputs: a player's character, a bot. With a game server, each player's own
 *   moves at once (prediction), the server's word arrives later and anything that was off eases away; everyone
 *   else's are drawn a moment behind, blended, as late as their snapshots need and no later.
 * - Objects are shared things with an owner: a ball, a door, a dropped item.
 * - Events are named messages: an emote, a goal.
 * - Turns say whose turn it is, check each move, pass a turn that runs out or whose player leaves.
 *
 * @example
 * // A game with no server code (Zaisma's relay): each player's game is the word on its own character, the host's on the rest.
 * import { createNet, charactersKind, eventsKind } from "./pieces/@zaisma/net/index.js";
 * import { walker } from "./walker.js"; // charactersKind({ stateFields, inputFields, step }): shared with the game server when there is one
 *
 * const room = await Zaisma.joinRoom();
 * const net = createNet(room);                                  // with a game server: createNet(room, { authorityKind: "server" })
 * const characters = net.use(walker);
 * const events = net.use(eventsKind({ eventNames: ["emote"] }));
 *
 * function frame() {
 *   characters.setInput({ moveX: keys.right - keys.left, jump: keys.justPressedJump });
 *   net.update();                                               // runs the fixed steps that are due, sends and eases
 *   for (const characterId of characters.ids()) drawCharacter(characterId, characters.drawn(characterId));
 *   requestAnimationFrame(frame);
 * }
 * events.on("emote", (payload, fromPlayerId) => showEmote(fromPlayerId, payload.name));
 *
 * @example
 * // Turned while playing, like every piece's settings.
 * net.settings.set({ minimumInterpolationDelayMs: 30 });
 * net.hooks.on("characterCorrected", ({ difference }) => console.log("off by", difference));
 */

import type { Hooks, ListedSetting, PieceError, SettingChange, Settings } from "../piece/index.js";

export { PieceError } from "../piece/index.js";

// ---- The core ----

/** What createNet reads of a room: Zaisma.joinRoom()'s answer has all of it. */
export interface NetRoom {
  readonly me: { id: string };
  readonly players: readonly { id: string }[];
  readonly hostPlayerId: string | null;
  readonly isSpectator?: boolean;
  serverTimeMs(): number;
  send(message: unknown, sendOptions?: SendOptions): boolean;
  sendBytes(bytes: ArrayBuffer | ArrayBufferView, sendOptions?: SendOptions): boolean;
  on(eventName: string, listener: (...given: any[]) => void): unknown;
  off(eventName: string, listener: (...given: any[]) => void): unknown;
}

/** As the room's own: "latest_only" may be dropped for a newer send with the same latestKey while a connection is backed up. */
export interface SendOptions {
  delivery?: "reliable" | "latest_only";
  latestKey?: string;
}

/** Who is in charge of the room: its host's game on the relay, the game server when the game has one. */
export type AuthorityKind = "host" | "server";

/** The core's settings (piece.json): every one can be changed while playing, with net.settings.set. */
export interface NetSettingValues {
  /**
   * The least time behind the newest snapshot that others' characters are drawn, 0 to 500 ms; default 50. It grows by
   * itself to how late and unevenly snapshots arrive, so they never stall or jump: lower it for fights that need the
   * freshest view, raise it to smooth a poor connection more.
   */
  minimumInterpolationDelayMs: number;
  /** How far past the newest snapshot another character keeps moving while the next is late, before it holds, 0 to 250 ms; default 100. */
  maximumExtrapolationMs: number;
  /** How quickly a correction to the player's own character eases away, 0 to 1 second; default 0.045 (most of it gone in about 0.1 s). 0 jumps. */
  correctionSmoothingSec: number;
  /** How many times a second characters' places are sent by whoever is the word on them, 1 to 60; default 20. Never more than the steps a second. */
  snapshotsPerSec: number;
  /** How long a player has for their turn before it passes, 0 to 604800 seconds; default 0, no limit. */
  turnTimeLimitSec: number;
  /** What happens to a leaver's objects: "remove" (the default) or "give_to_authority" (whoever is in charge owns them). */
  objectsOwnerLeftMode: "remove" | "give_to_authority";
}

/** The core's hooks (piece.json): a decision answers what happens; an event is only told. */
export interface NetHookHandlers {
  /** On a game server: before a player's event reaches anyone. Answer false to stop it. */
  beforeEvent: (isAllowed: boolean, attempt: { playerId: string; eventName: string; payload: unknown; roomState: any }) => boolean | void;
  /** On a game server: before a player makes, changes or removes an object. Answer false to refuse; their copy is put right. */
  beforeObjectChange: (isAllowed: boolean, attempt: { playerId: string; changeKind: "create" | "change" | "remove"; object: SharedObject | null; changes: Record<string, any> | null; roomState: any }) => boolean | void;
  /** On a game server: before a player's input moves their character, checked against inputFields. Answer another input, or null to drop it. */
  beforeCharacterInput: (input: Record<string, any>, attempt: { characterId: string; playerId: string; roomState: any }) => Record<string, any> | null | void;
  /** Where the room is decided (the game server, or the host's game on the relay): before a player's move counts. Answer false to refuse it. */
  beforeTurnMove: (isAllowed: boolean, attempt: { playerId: string; turnNumber: number; move: unknown; roomState: any }) => boolean | void;
  /** In a player's game: the game server saw the own character somewhere else; difference is how far each number or angle field was off (this game's minus the server's). */
  characterCorrected: (correction: { characterId: string; difference: Record<string, number>; isSnapped: boolean }) => void;
}

export interface CreateNetOptions {
  /** "host" (the default) for a game with no server code, on the relay; "server" for one whose game server is made with defineNetServer. */
  authorityKind?: AuthorityKind;
  /** Fixed steps a second on the room's clock, 1 to 60; default 30. With a game server, its rate is taken from it. */
  ticksPerSec?: number;
  /** Settings to start with. */
  settings?: Partial<NetSettingValues>;
  /** A handler for any hook. */
  hooks?: Partial<NetHookHandlers>;
}

export interface Net {
  readonly room: NetRoom;
  readonly authorityKind: AuthorityKind;
  readonly ticker: Ticker;
  /** The core's settings: get, set (while playing too), reset, list, onChange. */
  readonly settings: Settings<NetSettingValues>;
  /** The core's hooks: on, off, list. */
  readonly hooks: Hooks<NetHookHandlers>;
  readonly myPlayerId: string;
  /** The player in charge of the room on the relay (its host), or null with a game server. */
  readonly authorityPlayerId: string | null;
  /** Whether this game is the one in charge: the host's, on the relay. Never with a game server. */
  readonly isAuthority: boolean;
  /** Adds a kind of sync and answers what the game calls on it. Each kind once per room. Throws PieceError "kind_already_used", "not_a_kind". */
  use<Api>(kind: Kind<Api, any>): Api;
  /** Runs a function at every fixed step, the same step numbers in every game. Answers a function that stops it. */
  onTick(listener: (tickIndex: number, tickDurationSec: number) => void): () => void;
  /** Call every frame: runs the fixed steps that are due, sends what's due, eases what's drawn, and notices who's in the room. */
  update(): void;
  /** Stops listening to the room. The room itself stays joined. */
  dispose(): void;
}

/** Starts sync on a room the game has joined. Throws PieceError "room_missing", "bad_authority_kind", "bad_ticks_per_sec", "unknown_argument". */
export declare function createNet(room: NetRoom, createOptions?: CreateNetOptions): Net;

// ---- Shapes: what a kind of sync shares, field by field ----

/**
 * One field of what's shared. From these the core checks what others send, packs it in a few bytes, blends two of
 * them and eases a correction: a piece declares them and never writes how.
 *
 * - "number": a decimal with its range (minimumNumber, maximumNumber); stepSizeNumber, when given, is how fine it's sent
 *   (0.001 for a place to the millimetre: smaller messages), else it's sent as a 32-bit float. Blends smoothly.
 * - "integer": a whole number with its range. Changes at once, never blended.
 * - "angle": radians, any value (kept from -PI to PI), sent in two bytes, blended the short way round.
 * - "boolean": yes or no, a bit. Changes at once.
 * - "choice": one of choices (2 to 255 words), like an animation's name. Changes at once.
 * - "press" (inputs only): true for one step when pressed, like a jump: never lost, even when inputs are late or skipped.
 *
 * snapAboveNumber, on a number or angle: a correction bigger than this jumps instead of easing (a teleport the game didn't mark).
 */
export interface FieldDeclaration {
  /** In JavaScript's style, up to 40 characters: "x", "isGrounded". */
  name: string;
  valueKind: "number" | "integer" | "angle" | "boolean" | "choice" | "press";
  minimumNumber?: number;
  maximumNumber?: number;
  stepSizeNumber?: number;
  choices?: string[];
  /** What it starts as; default 0 in range (or the range's nearest end), false, or the first choice. */
  defaultValue?: number | boolean | string;
  snapAboveNumber?: number;
}

/** A checked list of fields. */
export interface Shape {
  readonly what: string;
  readonly fields: readonly (Required<Omit<FieldDeclaration, "minimumNumber" | "maximumNumber" | "stepSizeNumber" | "choices" | "snapAboveNumber">> & { minimumNumber: number | null; maximumNumber: number | null; stepSizeNumber: number | null; choices: string[] | null; snapAboveNumber: number | null })[];
  /** How many bytes one value takes on the wire. */
  readonly byteCount: number;
}

/** Checks a list of fields, for a kind of a game's own. Throws PieceError "bad_fields" naming the field at fault. */
export declare function defineShape(fields: FieldDeclaration[], shapeOptions: { what: string; isPressAllowed: boolean }): Shape;

// ---- Characters ----

/** What step is told besides the state and input. */
export interface StepContext {
  characterId: string;
  /** The fixed step's length: 1 / ticksPerSec. Always the same, so every game and the game server step alike. */
  tickDurationSec: number;
  /** true when a player's game runs an input again after the game server's word: play no sound, start no effect. */
  isReplay: boolean;
}

export interface CharactersDeclaration<State extends Record<string, any>, Input extends Record<string, any>> {
  /** What a character shares, every step: its place, facing, what it's doing. */
  stateFields: FieldDeclaration[];
  /** What moves it: a player's sticks and buttons, as fields. */
  inputFields: FieldDeclaration[];
  /**
   * The state one fixed step later, from a state (a copy: change it and answer it, or answer a new one) and an
   * input. The same function in every player's game and on the game server, and only these two decide it, so every
   * side lands in the same place: read the world (the map, its walls) but never the clock or random numbers.
   * What it answers is kept in range and on the fields' steps.
   */
  step(state: State, input: Input, stepContext: StepContext): State | void;
  /** Where a character starts, by its id: the fields it gives (the rest start at their defaults). */
  startState?(characterId: string): Partial<State>;
  /** "on_join" (the default): every player gets a character with their id as they join. "by_game": the game adds them. */
  playerCharacterMode?: "on_join" | "by_game";
}

export interface Characters<State extends Record<string, any> = Record<string, any>, Input extends Record<string, any> = Record<string, any>> {
  readonly stateShape: Shape;
  readonly inputShape: Shape;
  /** This player's own character's id: their player id. */
  readonly ownCharacterId: string;
  /** Every character's id here, in the order they came: players' have the players' ids. */
  ids(): string[];
  has(characterId: string): boolean;
  /**
   * The input for the own character from now on, or with { characterId } a bot's (the host's game, on the relay). Only
   * the fields given change; a press counts once, at the next step. Call it whenever input changes, or every frame.
   * Answers false when this game doesn't move that character. Throws PieceError "bad_value" for a field the inputs
   * don't have or a value outside it.
   */
  setInput(input: Partial<Input>, setOptions?: { characterId?: string }): boolean;
  /** Where to draw a character this frame: the own one smooth between steps with any correction easing away, the rest a moment behind, blended. null for one not here yet. */
  drawn(characterId: string): State | null;
  /** The moment on the room's clock a character is drawn at: the room's now for one this game moves, a moment behind for the rest. null for one not here. */
  drawnAtMs(characterId: string): number | null;
  /** A character's newest state: this game's own simulation's, or the newest snapshot's. null for one not here yet. */
  state(characterId: string): State | null;
  /** Whether this game moves a character itself: its own, and the bots while it's the host on the relay. */
  isSimulated(characterId: string): boolean;
  /**
   * On the relay: adds a character this game is the word on: the own one (playerCharacterMode "by_game"), or with
   * another id a bot, by the host. Answers false when the id is taken or it isn't this game's to add. With a game
   * server, throws PieceError "not_in_charge": add it there. Also "bad_character_id", "too_many_characters" (64 a room).
   */
  add(characterId: string, addOptions?: { state?: Partial<State> }): boolean;
  /** On the relay: removes a character this game is the word on. Answers false otherwise. */
  remove(characterId: string): boolean;
  /**
   * On the relay: sets fields of a character this game is the word on, at once, like a respawn. With isTeleport (the
   * default) everyone jumps there instead of blending. Answers false otherwise; with a game server, the server does it.
   */
  set(characterId: string, changes: Partial<State>, setOptions?: { isTeleport?: boolean }): boolean;
  /** Hears "added" or "removed": listener(characterId). Answers a function that stops listening. */
  on(eventName: "added" | "removed", listener: (characterId: string) => void): () => void;
}

export interface ServerCharacters<State extends Record<string, any> = Record<string, any>, Input extends Record<string, any> = Record<string, any>> {
  ids(): string[];
  has(characterId: string): boolean;
  /** A character's state now. Throws PieceError "unknown_character". */
  state(characterId: string): State;
  /** Adds a character: with a player's id, theirs (playerCharacterMode "by_game"); with another id, a bot moved by setInput. Answers false when the id is taken. */
  add(characterId: string, addOptions?: { state?: Partial<State> }): boolean;
  remove(characterId: string): boolean;
  /** Sets fields of any character at once: a respawn, a knockback. With isTeleport (the default) everyone jumps there, its own player too; false eases it there. */
  set(characterId: string, changes: Partial<State>, setOptions?: { isTeleport?: boolean }): boolean;
  /** A bot's input from now on; only the fields given change, a press counts once. Answers false for a player's character. */
  setInput(characterId: string, input: Partial<Input>): boolean;
  /**
   * Where a character was at a moment on the room's clock, from the last half second, blended. To judge a hit by what
   * the attacker saw (lag compensation): stateAt(targetId, viewTimeMs(attackerPlayerId)).
   */
  stateAt(characterId: string, timeMs: number): State;
  /** The moment on the room's clock a player last saw the others at (their newest input's), at most half a second back; the room's now when they haven't said. */
  viewTimeMs(playerId: string): number;
}

/**
 * Characters: things that move every step from inputs. A piece (the Character module) declares what they share and
 * how they move; the core sends them the way Shieldbreak's netcode proved: prediction and replay with eased
 * corrections, a jitter buffer on the server that never runs a player faster than time, a short repeat through a
 * stall with no press lost, others drawn a moment behind, and half a second of history to judge hits fairly.
 * Throws PieceError "bad_fields", "step_missing", "bad_argument".
 */
export declare function charactersKind<State extends Record<string, any> = Record<string, any>, Input extends Record<string, any> = Record<string, any>>(declaration: CharactersDeclaration<State, Input>): Kind<Characters<State, Input>, ServerCharacters<State, Input>>;

// ---- Objects ----

/** A shared object. ownerPlayerId null: it belongs to whoever is in charge of the room. */
export interface SharedObject<Properties = Record<string, any>> {
  id: string;
  ownerPlayerId: string | null;
  properties: Properties;
}

export interface Objects {
  /**
   * Makes an object this player owns, or with ownerPlayerId null one that belongs to whoever is in charge (only the
   * host may, on the relay). The id is 1 to 64 letters, digits, "_", ".", ":" or "-"; properties plain JSON up to 8 KB.
   * Answers false when the id is taken or it isn't this player's to make. Throws PieceError "bad_object_id",
   * "bad_properties", "object_too_big", "too_many_objects" (2000 a room).
   */
  create(objectId: string, properties?: Record<string, any>, createOptions?: { ownerPlayerId?: string | null }): boolean;
  /**
   * Changes some of an object's properties, for everyone. Only whoever may change it can: answers false otherwise.
   * With { delivery: "latest_only" } a send may be dropped for a newer one: for something that changes every frame.
   */
  set(objectId: string, changes: Record<string, any>, sendOptions?: { delivery?: "reliable" | "latest_only" }): boolean;
  /** Hands an object to another player in the room, or with null to whoever is in charge. Only whoever may change it can. */
  setOwner(objectId: string, ownerPlayerId: string | null): boolean;
  /** Removes an object. Only whoever may change it can: answers false otherwise. */
  remove(objectId: string): boolean;
  /** One object (a copy), or null. */
  get(objectId: string): SharedObject | null;
  /** Every object (copies), in the order they were made. */
  all(): SharedObject[];
  /** Whether this player may change an object now. */
  canChange(objectId: string): boolean;
  /** Hears "created", "changed" or "removed", for this player's own changes too. Answers a function that stops listening. */
  on(eventName: "created" | "changed" | "removed", listener: (object: SharedObject) => void): () => void;
}

export interface ServerObjects {
  /** Makes an object: the server's own, or with ownerPlayerId a player's. Answers false when the id is taken. */
  create(objectId: string, properties?: Record<string, any>, createOptions?: { ownerPlayerId?: string | null }): boolean;
  /** Changes any object's properties. Answers false when there's none. */
  set(objectId: string, changes: Record<string, any>): boolean;
  setOwner(objectId: string, ownerPlayerId: string | null): boolean;
  remove(objectId: string): boolean;
  get(objectId: string): SharedObject | null;
  all(): SharedObject[];
}

/**
 * Shared objects: a ball, a door, a dropped item. Only an object's owner changes it and everyone else's copy follows;
 * a late joiner gets them all; a leaver's are removed or handed on (setting objectsOwnerLeftMode). On a game server,
 * the hook beforeObjectChange may refuse a player's change.
 */
export declare function objectsKind(): Kind<Objects, ServerObjects>;

// ---- Events ----

export interface Events {
  /** Sends an event to everyone else in the room: payload plain JSON up to 8 KB, or left out. Throws PieceError "unknown_event", "payload_too_big". */
  send(eventName: string, payload?: unknown, sendOptions?: { delivery?: "reliable" | "latest_only" }): boolean;
  /** Hears an event: fromPlayerId is who sent it, null when the game server itself did. Answers a function that stops listening. */
  on(eventName: string, listener: (payload: any, fromPlayerId: string | null) => void): () => void;
}
export interface ServerEvents {
  /** From the game server to every player, or all but one. */
  broadcast(eventName: string, payload?: unknown, broadcastOptions?: { exceptPlayerId?: string }): void;
  /** From the game server to one player. */
  send(playerId: string, eventName: string, payload?: unknown): void;
}
/**
 * Named messages: an emote, a goal, a door opening. eventNames is the closed list of them, lowercase words joined by
 * underscores, so a typo is said at once. On a game server, the hook beforeEvent may stop a player's event.
 * Throws PieceError "bad_event_names".
 */
export declare function eventsKind(eventsOptions: { eventNames: string[] }): Kind<Events, ServerEvents>;

// ---- Turns ----

/** The turns as the game reads them. */
export interface TurnsNow {
  isStarted: boolean;
  isEnded: boolean;
  /** The players who take turns, in order. */
  order: string[];
  /** Whose turn it is, or null before the start and after the end. */
  turnPlayerId: string | null;
  /** Counts from 1 at the start, up by one each time the turn passes. */
  turnNumber: number;
  /** When this turn runs out, on the room's clock (room.serverTimeMs()), or null with no limit. */
  deadlineMs: number | null;
  isMyTurn: boolean;
  /** Moves made since the start. */
  moveCount: number;
  /** The newest moves, up to 8 KB of them: for showing what just happened. Keep the board in objects or the game server's state. */
  recentMoves: { turnNumber: number; playerId: string; move: unknown }[];
  /** What end() was given, or null. */
  endResult: unknown;
}
/** Why the turns changed. */
export type TurnsReason = "started" | "moved" | "timed_out" | "left" | "skipped" | "order_changed" | "ended";

export interface Turns {
  readonly current: TurnsNow;
  /** Whether this game keeps the turns: the host's on the relay. */
  readonly isInCharge: boolean;
  /** On the relay, by the host: starts turns, in the order given or everyone in join order. Throws PieceError "not_in_charge", "bad_order". */
  start(startOptions?: { playerIds?: string[] }): void;
  /** On the relay, by the host: changes the order. Whose turn it is stays, if they're still in it. */
  setOrder(playerIds: string[]): void;
  /** On the relay, by the host: ends the turns with an end result (plain JSON up to 2 KB), or null. */
  end(endResult?: unknown): void;
  /**
   * A move in this player's turn: plain JSON up to 2 KB. The turn then passes, unless { isTurnPassed: false }. Whoever is
   * in charge checks it (beforeTurnMove) and everyone hears it. Answers false when it isn't this player's turn.
   */
  move(move: unknown, moveOptions?: { isTurnPassed?: boolean }): boolean;
  /** Passes this player's turn without a move. Answers false when it isn't their turn. */
  pass(): boolean;
  /** "changed": every change, with why; "moved": each move as it's made. Answers a function that stops listening. */
  on(eventName: "changed", listener: (turns: TurnsNow, reason: TurnsReason) => void): () => void;
  on(eventName: "moved", listener: (move: { turnNumber: number; playerId: string; move: unknown }, turns: TurnsNow) => void): () => void;
}
export interface ServerTurns {
  readonly current: TurnsNow;
  start(startOptions?: { playerIds?: string[] }): void;
  setOrder(playerIds: string[]): void;
  /** Passes the turn on, as if its player passed. Answers false when turns aren't running. */
  skip(): boolean;
  end(endResult?: unknown): void;
}
/**
 * Turns, kept by whoever is in charge (the game server, or the host's game on the relay, and the next host's when it
 * leaves). The setting turnTimeLimitSec passes a turn that runs out (a game server that doesn't tick passes it the
 * next time anyone sends anything: give it ticksPerSec 2 for exact timing); a leaver's turn passes at once.
 */
export declare function turnsKind(): Kind<Turns, ServerTurns>;

// ---- A kind of your own ----

/** What a kind's half in a player's game is given. */
export interface KindClientContext {
  readonly authorityKind: AuthorityKind;
  readonly isSpectator: boolean;
  readonly myPlayerId: string;
  readonly ticker: Ticker;
  readonly settings: Settings<NetSettingValues>;
  /** Asks a decision hook of the core's. */
  ask<Proposal>(hookName: keyof NetHookHandlers, proposal: Proposal, ...details: unknown[]): Proposal;
  /** Tells an event hook of the core's. */
  tell(hookName: keyof NetHookHandlers, ...details: unknown[]): void;
  isAuthority(): boolean;
  authorityPlayerId(): string | null;
  playerIds(): string[];
  serverTimeMs(): number;
  /** Sends this kind's message: to the game server, or on the relay to everyone else. Spectators send nothing. */
  send(kindMessage: unknown, sendOptions?: SendOptions): boolean;
  sendBytes(bytes: ArrayBuffer | ArrayBufferView, sendOptions?: SendOptions): boolean;
  /** Hears this kind's messages: fromPlayerId is who sent it (on the relay always; with a game server, a player's the server passed on), or null from the server. */
  onMessage(listener: (kindMessage: any, fromPlayerId: string | null) => void): () => void;
  onBytes(listener: (kindBytes: Uint8Array, fromPlayerId: string | null) => void): () => void;
  /** Hears that the players, or who's in charge, changed. */
  onPlayersChanged(listener: (playerIds: string[], authorityPlayerId: string | null) => void): () => void;
  /** Hears that the game server moved this player to another room: what the kind held was the old room's. */
  onReset(listener: () => void): () => void;
  onTick(listener: (tickIndex: number, tickDurationSec: number) => void): () => void;
  /** Every frame, after the steps: how long since the last, and the room's clock. */
  onFrame(listener: (frameDurationSec: number, nowMs: number) => void): () => void;
}
/** What a kind's half on the game server works through. */
export interface KindServerContext {
  /** The game server's room, as its handlers get it. */
  room: any;
  /** The room's whole state, for hooks to read. */
  roomState: any;
  readonly settings: Settings<NetSettingValues>;
  ask<Proposal>(hookName: keyof NetHookHandlers, proposal: Proposal, ...details: unknown[]): Proposal;
  tell(hookName: keyof NetHookHandlers, ...details: unknown[]): void;
  /** The game server's fixed steps a second. */
  ticksPerSec: number;
  serverTimeMs(): number;
  playerIds(): string[];
  send(playerId: string, kindMessage: unknown, sendOptions?: SendOptions & { fromPlayerId?: string }): void;
  broadcast(kindMessage: unknown, broadcastOptions?: SendOptions & { exceptPlayerId?: string; fromPlayerId?: string }): void;
  sendBytes(playerId: string, bytes: Uint8Array, sendOptions?: SendOptions): void;
  broadcastBytes(bytes: Uint8Array, broadcastOptions?: SendOptions & { exceptPlayerId?: string }): void;
}
export interface KindDefinition<Api, ServerApi> {
  /** The kind's own name, the same in every game that uses it: lowercase words joined by underscores, up to 40 characters. */
  name: string;
  /** Runs in each player's game and answers what the game calls. */
  client(kindContext: KindClientContext): Api;
  /** For games with a game server: the kind's handlers there. Its state is plain JSON, kept with the room's in state.net. */
  server?: {
    setup?(): any;
    onJoin?(kindState: any, player: { id: string }, kindContext: KindServerContext): void;
    onLeave?(kindState: any, player: { id: string }, kindContext: KindServerContext): void;
    onBack?(kindState: any, player: { id: string }, kindContext: KindServerContext): void;
    onMessage?(kindState: any, player: { id: string }, kindMessage: any, kindContext: KindServerContext): void;
    onBytes?(kindState: any, player: { id: string }, kindBytes: Uint8Array, kindContext: KindServerContext): void;
    onTick?(kindState: any, tickDurationSec: number, kindContext: KindServerContext): void;
    /** What the game server's own code calls, reached as kind.onServer(state, room). */
    api?(kindState: any, kindContext: KindServerContext): ServerApi;
  };
  /** Whether the server half's onTick must run though the game gave its game server no ticksPerSec (it then ticks 30 a second). */
  isTickNeeded?: boolean;
}
export interface Kind<Api, ServerApi> {
  readonly name: string;
  readonly isTickNeeded: boolean;
  client(kindContext: KindClientContext): Api;
  readonly server: NonNullable<KindDefinition<Api, ServerApi>["server"]>;
  /** In the game server's own code: this kind's calls there, with the state and room its handler got. Throws PieceError "kind_not_on_server". */
  onServer(state: any, room: any): ServerApi;
}
/** Makes a kind of sync of a piece's or a game's own. Throws PieceError "bad_kind_name", "kind_client_missing", "unknown_argument". */
export declare function defineKind<Api, ServerApi = {}>(definition: KindDefinition<Api, ServerApi>): Kind<Api, ServerApi>;

// ---- The parts real-time sync is built from ----

export interface Ticker {
  readonly ticksPerSec: number;
  readonly tickDurationSec: number;
  /** The step a time on the room's clock falls in. */
  tickIndexAt(timeMs: number): number;
  /** When a step starts, on the room's clock. */
  tickStartMs(tickIndex: number): number;
  /** The steps to run now, oldest first; after a long pause only the newest few. */
  advance(nowMs: number): number[];
  /** Takes another rate; counting starts again from now. */
  setTicksPerSec(ticksPerSec: number): void;
}
/** Fixed steps on the room's clock: every game and the game server count the same step numbers. */
export declare function createTicker(tickerOptions?: { ticksPerSec?: number; maximumCatchUpTickCount?: number }): Ticker;

export interface InputQueue<Input> {
  /** Adds an input and answers it numbered, to send. */
  add(input: Input): { inputNumber: number; input: Input };
  /** The server has applied every input up to this number: they stop waiting. */
  acknowledge(inputNumber: number): void;
  /** The inputs the server hasn't answered, oldest first: apply them again on top of its state. */
  readonly waiting: { inputNumber: number; input: Input }[];
  readonly nextInputNumber: number;
  clear(): void;
}
/** A player's inputs, numbered and kept until the server answers them, for prediction. */
export declare function createInputQueue<Input = unknown>(queueOptions?: { maximumWaitingCount?: number }): InputQueue<Input>;

export interface Timeline {
  /** The least it draws behind. Change it any time. */
  minimumDelayMs: number;
  /** A snapshot taken at snapshotTimeMs on the room's clock arrived at arrivedAtMs. */
  noteArrival(snapshotTimeMs: number, arrivedAtMs: number): void;
  /** How far behind it should draw now. */
  targetDelayMs(): number;
  /** The moment on the room's clock to draw now: slips back or catches up gently, never jumping or going backwards. */
  drawnAtMs(nowMs: number): number;
  readonly delayMs: number;
  clear(): void;
}
/** When to draw what someone sends: as little behind their newest snapshot as their snapshots' lateness and gaps allow. */
export declare function createTimeline(timelineOptions?: { minimumDelayMs?: number; windowDurationMs?: number }): Timeline;

export interface SnapshotBuffer<Snapshot> {
  maximumExtrapolationMs: number;
  /** Adds a snapshot taken at a time on the room's clock. */
  add(timeMs: number, snapshot: Snapshot): void;
  /** The snapshot to draw for a moment on the room's clock (a timeline's drawnAtMs): null before the first. */
  snapshotAt(drawnAtMs: number): Snapshot | null;
  newest(): Snapshot | null;
  readonly snapshotCount: number;
  clear(): void;
}
/** Snapshots of something that moves, blended around the moment drawn. Throws PieceError "mix_missing". */
export declare function createSnapshotBuffer<Snapshot>(bufferOptions: { mix: (earlier: Snapshot, later: Snapshot, fractionNumber: number) => Snapshot; maximumExtrapolationMs?: number; keptDurationMs?: number }): SnapshotBuffer<Snapshot>;

export type { Hooks, ListedSetting, SettingChange, Settings };
/**
 * Every error of this piece is a PieceError with pieceName "@zaisma/net": code is stable, field names the argument at
 * fault or is null, fix says what to do. Its codes: unknown_argument, bad_argument, room_missing, bad_authority_kind,
 * bad_ticks_per_sec, net_disposed, not_a_kind, kind_already_used, bad_kind_name, kind_client_missing,
 * kind_not_on_server, kinds_missing, bad_fields, bad_value, step_missing, bad_character_id, unknown_character,
 * too_many_characters, not_in_charge, bad_object_id, bad_properties, object_too_big, too_many_objects, unknown_player,
 * bad_event_names, unknown_event, payload_too_big, bad_order, move_too_big, turns_not_running, mix_missing; and
 * @zaisma/piece's unknown_setting, bad_setting, unknown_hook, bad_hook.
 */
export type NetErrorCode = PieceError["code"];
