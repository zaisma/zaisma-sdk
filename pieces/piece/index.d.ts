/**
 * @zaisma/piece: how a JavaScript piece opens its settings and hooks, the same way in every piece.
 *
 * A piece states its settings and hooks once, in its piece.json. Its code reads that statement (as
 * ./piece.json.js) and opens them with openPiece; a game then changes the piece only through them, never
 * through its files.
 *
 * In a piece:
 *
 *   import statement from "./piece.json.js";
 *   import { openPiece } from "../piece/index.js";          // from a piece of another scope: "../../@zaisma/piece/index.js"
 *
 *   export function createJumper(given = {}) {
 *     const { settings, hooks, tell, ask, refuse } = openPiece(statement, given);
 *     function jump() {
 *       const heightM = ask("beforeJump", settings.get("jumpHeightM"));   // a decision: the game may change it
 *       // ... jump heightM high ...
 *       tell("landed", { heightM });                                       // an event: the game hears of it
 *     }
 *     return { settings, hooks, jump };
 *   }
 *
 * In a game:
 *
 *   const jumper = createJumper({ settings: { jumpHeightM: 2 }, hooks: { landed: () => playThud() } });
 *   jumper.settings.set({ jumpHeightM: 12 });               // a super jump, turned up while playing
 *   jumper.hooks.on("beforeJump", (heightM) => (isOnMoon ? heightM * 6 : heightM));
 *
 * Names are the statement's, in JavaScript's style: the setting "jump_height_m" is jumpHeightM, the hook
 * "before_jump" is beforeJump. Works the same in a browser and on a game server. No dependencies.
 */

/** What a setting can hold: a number or integer, true or false, one of its choices, text, or a colour like "#3fa9f5". */
export type SettingValue = number | boolean | string;

/** A piece's statement: its piece.json, as ./piece.json.js gives it. Its settings are each a StatedSetting, its hooks each a StatedHook. */
export interface PieceStatement {
  readonly name: string;
  readonly settings: readonly object[];
  readonly hooks: readonly object[];
}

/** A setting as a piece.json states it. */
export interface StatedSetting {
  /** In lowercase with underscores, saying what it holds and its unit: "jump_height_m". */
  name: string;
  value_kind: "number" | "integer" | "boolean" | "choice" | "text" | "color";
  default_value: SettingValue;
  /** The range of a number or an integer; null for every other kind. */
  minimum_number: number | null;
  maximum_number: number | null;
  /** How long a text may be; null for every other kind. */
  maximum_character_count: number | null;
  /** What a choice can be; null for every other kind. */
  choices: readonly string[] | null;
  summary: string;
}

/** A hook as a piece.json states it. */
export interface StatedHook {
  /** In lowercase with underscores: "before_jump", "landed". */
  name: string;
  /** "event": the piece tells the game something happened. "decision": the piece asks the game before something does, and what the game answers is what happens. */
  hook_kind: "event" | "decision";
  summary: string;
}

/** One change to a setting, as onChange's listeners get it. */
export interface SettingChange<Values, Name extends keyof Values = keyof Values> {
  name: Name;
  newValue: Values[Name];
  earlierValue: Values[Name];
}

/** One setting as settings.list() gives it: enough to build a settings screen or a tuning panel from. */
export interface ListedSetting {
  /** Its name here, in JavaScript's style: "jumpHeightM". */
  name: string;
  /** Its name in the piece.json: "jump_height_m". */
  statedName: string;
  valueKind: StatedSetting["value_kind"];
  currentValue: SettingValue;
  defaultValue: SettingValue;
  minimumNumber: number | null;
  maximumNumber: number | null;
  maximumCharacterCount: number | null;
  choices: string[] | null;
  summary: string;
}

/**
 * A piece's settings, for the game and the piece alike. Values is the piece's own type of them, like
 * { jumpHeightM: number; shadowsEnabled: boolean }. Every setting can be changed while playing.
 */
export interface Settings<Values extends Record<string, SettingValue> = Record<string, SettingValue>> {
  /** What a setting is now. Throws PieceError "unknown_setting". */
  get<Name extends keyof Values & string>(name: Name): Values[Name];
  /**
   * Changes settings, while playing too: only the ones given change. Every one is checked before any applies,
   * so a refused set changes nothing. Throws PieceError "unknown_setting" (field: the name) or "bad_setting"
   * (field: the name; the message says what it takes).
   */
  set(changes: Partial<Values>): void;
  /** Puts settings back to their defaults: the ones named, or all of them. Throws PieceError "unknown_setting". */
  reset(names?: readonly (keyof Values & string)[]): void;
  /** Every setting as it is now: a copy. */
  readonly values: Values;
  /** Every setting with what it takes, its default and what it is now. */
  list(): ListedSetting[];
  /** Calls listener after each setting that changed. Answers a function that stops it. */
  onChange(listener: (change: SettingChange<Values>) => void): () => void;
}

/** One hook as hooks.list() gives it. */
export interface ListedHook {
  /** Its name here, in JavaScript's style: "beforeJump". */
  name: string;
  /** Its name in the piece.json: "before_jump". */
  statedName: string;
  hookKind: StatedHook["hook_kind"];
  summary: string;
}

/**
 * A piece's hooks, as the game sees them. Handlers is the piece's own type of them, like
 * { landed: (landing: Landing) => void; beforeJump: (heightM: number) => number | void }.
 *
 * A handler of an event is told and answers nothing. A handler of a decision gets what the piece proposes and
 * answers what should happen instead, or nothing to leave it; with several handlers, each gets the one before's
 * answer. A handler that throws is logged and skipped: it never stops the piece.
 */
export interface Hooks<Handlers extends Record<string, (...given: any[]) => unknown> = Record<string, (...given: any[]) => unknown>> {
  /** Adds a handler. Answers a function that removes it. Throws PieceError "unknown_hook" or "bad_hook". */
  on<Name extends keyof Handlers & string>(name: Name, handler: Handlers[Name]): () => void;
  /** Removes a handler. Throws PieceError "unknown_hook". */
  off<Name extends keyof Handlers & string>(name: Name, handler: Handlers[Name]): void;
  /** Every hook with its kind and what it's for. */
  list(): ListedHook[];
}

/** What a game gives a piece's create call, beside the piece's own arguments. */
export interface GivenToPiece<Values extends Record<string, SettingValue> = Record<string, SettingValue>, Handlers extends Record<string, (...given: any[]) => unknown> = Record<string, (...given: any[]) => unknown>> {
  /** Settings to start with; the rest start at their defaults. */
  settings?: Partial<Values>;
  /** A handler for any hook, by name. */
  hooks?: Partial<Handlers>;
}

/** What a piece's own code gets from openHooks: the game's side, and the two calls that run the hooks. */
export interface OpenedHooks<Handlers extends Record<string, (...given: any[]) => unknown> = Record<string, (...given: any[]) => unknown>> {
  hooks: Hooks<Handlers>;
  /** Whether the game handles a hook now: for a piece that does something of its own when nobody listens (prints a warning, say). */
  hasHandlers(name: keyof Handlers & string): boolean;
  /** Calls every handler of an event with details. Throws PieceError "wrong_hook_kind" when the statement has no such event. */
  tell(name: keyof Handlers & string, ...details: unknown[]): void;
  /**
   * Asks every handler of a decision in turn, starting from proposal, and answers what they made of it. The
   * answer is the game's: check it before using it. Throws PieceError "wrong_hook_kind" when the statement has
   * no such decision.
   */
  ask<Proposal>(name: keyof Handlers & string, proposal: Proposal, ...details: unknown[]): Proposal;
}

/** What a piece's own code gets from openPiece. */
export interface OpenedPiece<Values extends Record<string, SettingValue> = Record<string, SettingValue>, Handlers extends Record<string, (...given: any[]) => unknown> = Record<string, (...given: any[]) => unknown>> extends OpenedHooks<Handlers> {
  settings: Settings<Values>;
  /** Throws the piece's own PieceError: code stable and lowercase with underscores, field the argument at fault or null, fix what to do. */
  refuse(code: string, details: { message: string; field?: string | null; fix: string }): never;
}

/**
 * Opens a piece's settings from its statement: their defaults, with the game's own on top.
 * Throws PieceError "unknown_setting" or "bad_setting" for what the game gave.
 */
export declare function openSettings<Values extends Record<string, SettingValue> = Record<string, SettingValue>>(statement: PieceStatement, givenSettings?: NoInfer<Partial<Values>>): Settings<Values>;

/**
 * Opens a piece's hooks from its statement, with the handlers the game gave.
 * Throws PieceError "unknown_hook" or "bad_hook" for what the game gave.
 */
export declare function openHooks<Handlers extends Record<string, (...given: any[]) => unknown> = Record<string, (...given: any[]) => unknown>>(statement: PieceStatement, givenHooks?: NoInfer<Partial<Handlers>>): OpenedHooks<Handlers>;

/**
 * Opens both at once from what the game gave the piece's create call. A piece's create call takes
 * { settings, hooks } beside its own arguments and gives back an object with settings and hooks on it, so every
 * piece is changed the same way.
 */
export declare function openPiece<Values extends Record<string, SettingValue> = Record<string, SettingValue>, Handlers extends Record<string, (...given: any[]) => unknown> = Record<string, (...given: any[]) => unknown>>(statement: PieceStatement, given?: NoInfer<GivenToPiece<Values, Handlers>>): OpenedPiece<Values, Handlers>;

/** A stated name in JavaScript's style: camelName("jump_height_m") is "jumpHeightM". */
export declare function camelName(statedName: string): string;

/**
 * An error of a piece. code is stable: "unknown_setting", "bad_setting", "unknown_hook", "bad_hook" and
 * "wrong_hook_kind" are this piece's, and every piece adds its own. field names the setting, hook or argument at
 * fault, or is null. fix says what to do.
 */
export declare class PieceError extends Error {
  constructor(pieceName: string, code: string, details: { message: string; field?: string | null; fix: string });
  /** The piece that threw it, like "@zaisma/body". */
  pieceName: string;
  code: string;
  field: string | null;
  fix: string;
}

/**
 * What a piece keeps of its own between plays, as a save finds it on the piece (piece.kept): some of its settings
 * (the player's own choices) and state of its own (the controls the player chose). Any save can keep any piece
 * that has one: it reads it, keeps the record beside the game's progress, and gives it back when the game opens.
 */
export interface Kept {
  /** The piece's name, like "@zaisma/input": what a save keeps its record under. */
  readonly pieceName: string;
  /** The format of what it keeps: a newer version of the piece that keeps another shape raises it. */
  readonly keptFormatVersionNumber: number;
  /** What it keeps now, as plain data. */
  read(): KeptRecord;
  /**
   * Brings back what read answered in an earlier play, and answers whether it took it: a record from a newer
   * version of the piece is left alone (false), for the save to keep as it is. null puts back what the piece had
   * when it was made. A setting the piece no longer takes is skipped, and so is state its restore refuses.
   */
  restore(record: KeptRecord | null): boolean;
  /** Calls listener whenever what the piece keeps changes, so a save writes it. Answers a function that stops it. */
  onChange(listener: () => void): () => void;
}

/** What a piece keeps, as a save stores it. Names are the statement's, so any engine reads it. */
export interface KeptRecord {
  kept_format_version_number: number;
  /** Each kept setting that differs from what it was when the piece was made, by its stated name: { "invert_look_y_enabled": true }. */
  setting_values: Record<string, SettingValue>;
  /** The piece's own state, plain JSON; null when it keeps none. */
  piece_state: unknown;
}

/** What openKept takes. */
export interface KeptOptions {
  /** The format of what it keeps, from 1 (the default). Raise it when the shape of the piece's own state changes. */
  keptFormatVersionNumber?: number;
  /** The settings that are the player's own choices, in JavaScript's style: ["mouseLookRadPerPx", "invertLookYEnabled"]. Never ones the game tunes. */
  settingNames?: string[];
  /** Answers the piece's own state to keep, plain JSON. Comes with restoreState. */
  readState?: () => unknown;
  /** Brings back what readState answered, kept in the format number given; null means back to what the piece had when made. Comes with readState. */
  restoreState?: (keptState: unknown, keptFormatVersionNumber: number) => void;
}

/**
 * Opens what a piece keeps of its own, for any save to keep. Put kept on the piece as piece.kept; call changed()
 * after the piece's own state changes. A kept setting is kept once it differs from what it was when the piece was
 * made, so a game that changes its own default later still reaches players who never changed it. Throws PieceError
 * "bad_kept" or "unknown_setting": the piece's own mistakes.
 *
 * @example
 * const { kept, changed } = openKept(statement, settings, {
 *   settingNames: ["mouseLookRadPerPx"],
 *   readState: () => ({ bindings }),
 *   restoreState: (keptState) => { bindings = keptState?.bindings ?? defaultBindings; },
 * });
 * return { settings, hooks, kept, rebind() { ...; changed(); } };
 */
export declare function openKept<Values extends Record<string, SettingValue> = Record<string, SettingValue>>(statement: PieceStatement, settings: Settings<Values>, options?: KeptOptions): { kept: Kept; changed(): void };
