/**
 * @zaisma/save: save and load. A game describes its progress once (what a new player starts with, the save's
 * format number, how to bring an older save up to date) and changes it as the player plays; this piece writes it,
 * with what each of the game's pieces keeps of its own, at the right moments, and reads it back when the game opens.
 *
 * - **What pieces keep.** A piece that keeps something of its own between plays has piece.kept (@zaisma/piece's
 *   openKept): the input piece keeps the player's controls and their own choices among its settings. Name it in
 *   keptPieces and the save keeps it beside the game's progress and gives it back, without the game handling it.
 * - **Written at the right moments:** shortly after a change (many changes are one write), and at once when the
 *   game is hidden or closed: phones close tabs without warning.
 * - **Older saves upgraded** step by step with upgrades, and a field added later starts at its default.
 * - **Never written over** when it's a save this game didn't make: one from a newer version of the game, one it
 *   can't read, or one that changed underneath it (another tab, another device, an earlier copy put back, the
 *   developer). The stored one stays, the game hears of it, and nothing is written until the game says so.
 * - **Kept where the game chooses** (stores.d.ts): in the browser (the default; on Zaisma it follows a signed-in
 *   player to every device with no more code), or on the game's own game server (serverStore and server.js), the
 *   same on Zaisma's rooms and on a developer's own server, or in any store the developer writes.
 *
 * Keep progress and settings in it, never what decides an online match (that belongs on the game server) or
 * purchases (Zaisma.items).
 *
 * @example
 * import { openSave } from "./pieces/@zaisma/save/index.js";
 * const save = await openSave({
 *   saveFormatVersionNumber: 2,
 *   defaults: { level: 1, coinCount: 0 },
 *   upgrades: { 1: (formatOne) => ({ level: formatOne.level, coinCount: formatOne.coins }) },
 *   keptPieces: [input],                                // the player's controls come back too
 *   hooks: { changedOutside: (progress) => redraw(progress) },
 * });
 * save.progress.level;                                   // read
 * save.update((progress) => { progress.coinCount += 5; }); // change: written shortly after
 * save.writeNow();                                       // at a checkpoint
 */
import type { GivenToPiece, Hooks, Kept, Settings } from "../piece/index.js";
import type { SaveStore } from "./stores.js";

export { browserStore, serverStore } from "./stores.js";
export type { BrowserStoreOptions, SaveStore, ServerStoreOptions, StoredSave, StoreListeners, StoreWriteOutcome } from "./stores.js";
export { PieceError } from "../piece/index.js";

/** The save's settings, each changeable while playing. */
export interface SaveSettingValues {
  /** How long after a change the save is written, in milliseconds (0 to 60000, default 500), so many changes close together are one write. Hidden or closed, it's written at once. */
  writeDelayMs: number;
  /** Whether changes are written (default true). Off (a replay, a tutorial that mustn't count), progress still changes and nothing is written; on again, what's waiting is written. */
  writingEnabled: boolean;
}

/** What went wrong with the stored save, or with writing or sending it. */
export interface SaveProblem {
  /**
   * save_unreadable, save_from_newer_game and upgrade_failed: the stored save couldn't be used, so it's left as it
   * is and nothing is written over it (isWritingHeld) until replaceStored. save_too_big and storage_refused: a write
   * didn't happen. save_not_sent: a server store couldn't reach the game server; it's kept in the browser and sent
   * again by itself. A server store also passes on its game server's refusals (too_many_saves, save_too_big).
   */
  code: "save_unreadable" | "save_from_newer_game" | "upgrade_failed" | "save_too_big" | "storage_refused" | "save_not_sent" | (string & {});
  message: string;
  fix: string;
}

/** Two progresses that met, as the conflict hook gets them. */
export interface SaveConflict<Progress> {
  /** The progress that wasn't kept, brought up to date like any stored save: offer it, and save.update(() => otherProgress) takes it. */
  otherProgress: Progress;
  /** Where it was played: this_device (this device's progress lost to a later one from elsewhere) or elsewhere (another device's lost to this one's). */
  otherPlace: "this_device" | "elsewhere";
}

/** The save's hooks, all events. */
export interface SaveHookHandlers<Progress> {
  /** The stored save couldn't be used, or a write or send failed. Without a handler, it's printed as a warning. */
  problem: (problem: SaveProblem) => void;
  /** The stored save was changed elsewhere and is now the one in use (kept pieces have theirs back already): redraw from progress. */
  changedOutside: (progress: Progress) => void;
  /** Two progresses met (this device played offline while another played on): the one saved last is in use; this gets the other. */
  conflict: (conflict: SaveConflict<Progress>) => void;
  /** A write happened: show a saved mark. savedAt is an ISO time. */
  written: (written: { savedAt: string }) => void;
  /** A store that keeps the save on a server has it there now. */
  sent: (sent: { savedAt: string | null }) => void;
}

/** What openSave takes. */
export interface SaveArguments<Progress extends object> extends GivenToPiece<SaveSettingValues, SaveHookHandlers<Progress>> {
  /** The save's format: a whole number from 1. Add 1 each time the shape of progress changes, with an upgrade from the number before. */
  saveFormatVersionNumber: number;
  /** What a new player starts with, plain JSON. A field added later starts at its value here in older saves, at any depth. */
  defaults: Progress;
  /** upgrades[n] takes a format n save's progress and answers it in format n + 1. One is needed for every number below saveFormatVersionNumber. */
  upgrades?: Record<number, (olderProgress: any) => any>;
  /** The pieces whose own things the save keeps beside the progress: each one's kept (@zaisma/piece's Kept). More with save.keep. */
  keptPieces?: { kept: Kept }[];
  /** Where the save is kept: browserStore() by default, serverStore({ request }) for the game server, or a store of your own. */
  store?: SaveStore;
  /** The default store's localStorage key, "save" unless given. Only without store: give a store its own key. */
  storageKey?: string;
  /** Where the page's hidden and closing events are heard: the window, by default. For tests and other runtimes. */
  eventTarget?: EventTarget;
}

export interface Save<Progress extends object> {
  settings: Settings<SaveSettingValues>;
  hooks: Hooks<SaveHookHandlers<Progress>>;
  /** The player's progress, to read. Change it through update, so the change is written. */
  readonly progress: Progress;
  /** Whether nothing is being written because the stored save couldn't be used: see the problem hook, and replaceStored. */
  readonly isWritingHeld: boolean;
  /** Where the save is kept: the store's kind, "browser", "server" or a store's own. */
  readonly storeKind: string;
  /** Changes the progress: change alters it in place, or answers a whole new one. Call it as often as you like. Throws PieceError "bad_argument". */
  update(change: (progress: Progress) => Progress | void): void;
  /** Writes now, kept pieces included: at a checkpoint, or before sending the player somewhere else. A server store sends it at once too. Answers whether it wrote. */
  writeNow(): boolean;
  /** Reads the store again and takes what's there as changed outside: for Zaisma.saves.on("developerChange", () => save.reread()). */
  reread(): Promise<void>;
  /** Back to what a new player starts with, kept pieces included, written at once. */
  reset(): void;
  /** Starts over from the defaults, writing over a stored save this game couldn't use (isWritingHeld). The player's stored progress is lost: ask them first. */
  replaceStored(): void;
  /** Keeps one more piece's own things, giving it what's stored for it now. Throws PieceError "not_keepable" or "already_kept". */
  keep(piece: { kept: Kept }): void;
  /** Writes what's waiting and stops listening. */
  dispose(): void;
}

/**
 * Opens the game's save: reads what's stored, brings it up to date, gives each kept piece its own back, and answers
 * the save. With a server store it waits for the game server, or for it to be out of reach: then the copy in this
 * browser is used and sent later. Throws PieceError "unknown_argument", "bad_argument", "bad_format_version",
 * "bad_defaults", "upgrade_missing", "not_keepable", "already_kept", "bad_store" or "no_storage", and
 * "unknown_setting", "bad_setting", "unknown_hook" or "bad_hook" for its settings and hooks.
 */
export declare function openSave<Progress extends object>(saveArguments: SaveArguments<Progress>): Promise<Save<Progress>>;

/** The most a save kept in the browser may take, in bytes (5 MB): Zaisma's cloud saves take no more. */
export declare const MAXIMUM_BROWSER_SAVE_SIZE_BYTES: number;
/** The most a save kept on a game server may take, in bytes (256 KB). */
export declare const MAXIMUM_SERVER_SAVE_SIZE_BYTES: number;
