/**
 * Where a save is kept. A store holds the save's text where the page can write it at once, so a save written as the
 * page closes is never lost, and says when it changed elsewhere. Give one to openSave's store; browserStore() is the
 * default. A developer can write their own (their own backend, IndexedDB): anything with these calls.
 *
 * @example
 * import { openSave, serverStore } from "./pieces/@zaisma/save/index.js";
 * const save = await openSave({
 *   saveFormatVersionNumber: 1,
 *   defaults: { level: 1 },
 *   store: serverStore({ request: (body) => Zaisma.server.request(body) }),            // on Zaisma
 *   // store: serverStore({ request: (body) => Zaisma.server.request(body, { serverUrl: "https://play.example.com" }) }), // your own server
 * });
 */

/** What a store holds when it's read. */
export interface StoredSave {
  /** The save's text, or null for a player with none. */
  saveText: string | null;
  /** When reading settled two saves that met (a server store: progress made offline here, while another device played on), the one that lost; else null. */
  otherSaveText: string | null;
  /** Where the one that lost was played: this_device or elsewhere; null with no otherSaveText. */
  otherPlace: "this_device" | "elsewhere" | null;
}

/** What a write answers: written, or not because someone else wrote since, with what's there now. */
export interface StoreWriteOutcome {
  isWritten: boolean;
  storedText: string | null;
}

/** What a store tells the save it serves. */
export interface StoreListeners {
  /** The stored text changed elsewhere (another tab, another device): the save takes it, unless it's what it has. */
  changedOutside(saveText: string | null): void;
  problem(problem: { code: string; message: string; fix: string }): void;
  /** Two saves met and the later one won; this is the other, to offer the player. */
  conflict(otherSaveText: string, otherPlace: "this_device" | "elsewhere"): void;
  /** A store that keeps the save on a server has it there, saved at that ISO time. */
  sent(savedAt: string | null): void;
}

/** A place to keep a save. */
export interface SaveStore {
  /** What kind of store it is: "browser", "server", or a store's own word. */
  readonly storeKind: string;
  /** The most a save may take here, in bytes. */
  readonly maximumSaveSizeBytes?: number;
  /** Reads what's stored, when the save opens or rereads. */
  read(): Promise<StoredSave>;
  /** Writes saveText in place of expectedText, at once (never waiting: it runs as the page closes), unless what's there isn't expectedText. */
  write(saveText: string, expectedText: string | null): StoreWriteOutcome;
  /** Starts telling the save what happens. Answers a function that stops it. */
  listen(listeners: StoreListeners): () => void;
  /** Sends what's waiting now, for a store that sends it somewhere; isClosing when the page is going. */
  flush(isClosing: boolean): void;
  /** Stops everything it started. */
  dispose(): void;
}

/** What browserStore takes. */
export interface BrowserStoreOptions {
  /** The localStorage key the save is kept under: letters, digits and . _ : -, up to 100 characters. Default "save". */
  storageKey?: string;
  /** Where the save is kept, for tests and other runtimes. Default localStorage. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Where another tab's writes are heard: the window, by default. */
  eventTarget?: EventTarget;
}

/**
 * The save in the browser's localStorage. On Zaisma, with cloud saves on, it follows a signed-in player to every
 * device with no more code; anywhere else it stays in that browser. Up to MAXIMUM_BROWSER_SAVE_SIZE_BYTES (5 MB).
 * Throws PieceError "unknown_argument", "bad_argument", "bad_storage_key" or "no_storage".
 */
export declare function browserStore(options?: BrowserStoreOptions): SaveStore;

/** What serverStore takes. */
export interface ServerStoreOptions extends BrowserStoreOptions {
  /**
   * Sends one of the save piece's requests to the game's game server and answers what its onRequest answered, or
   * throws when it couldn't (with error.code, as Zaisma.server.request throws). On the game server, server.js's
   * answerSaveRequest answers them. On Zaisma: (body) => Zaisma.server.request(body); on your own server, the same
   * with { serverUrl }, or your own fetch.
   */
  request: (body: object) => Promise<unknown>;
  /** The least time between two sends to the game server, in seconds (1 to 600, default 10), so a game that saves often costs few requests. A bigger save waits a second for each part it's sent in. */
  minimumSendIntervalSec?: number;
}

/**
 * The save on the game's own game server, kept for each signed-in player in the game's database, so it follows
 * them to every device, on Zaisma and off it alike. A copy stays in localStorage, written at once: progress made
 * offline, as a guest (whose save the game server doesn't keep) or as the page closes is sent the next time it can
 * be, and two devices that both played on are settled the way Zaisma settles them: the one saved last wins, and
 * the conflict hook gets the other. Up to MAXIMUM_SERVER_SAVE_SIZE_BYTES (256 KB). Throws PieceError
 * "unknown_argument", "bad_argument", "bad_storage_key" or "no_storage".
 */
export declare function serverStore(options: ServerStoreOptions): SaveStore;
