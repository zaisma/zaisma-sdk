/** What startLocalPlay takes. Only gameFolder is required; the rest have the defaults named here. */
export interface LocalPlayOptions {
  /** The folder of your game, the one with index.html at the top. Its game server is zaisma-server/index.js or zaisma-server.js, else the relay. */
  gameFolder: string;
  /** The first of four ports: the bench, the game's site, the stand-in rooms and your game server take it and the next three. Default 4800. */
  port?: number;
  /** Listen on every address, so a phone on the same Wi-Fi can open the bench. Default false: this computer only. */
  isOnNetwork?: boolean;
  /** Your game's Zaisma slug. Default: the folder's name. */
  gameSlug?: string | null;
  /** Where the bench keeps its keys, players, saves and the game's database. Default: ~/.zaisma/play-locally/<folder's name>-<hash of the game folder's real path>, outside the game's folder, so a build that empties it leaves them be. */
  benchFolder?: string | null;
  /** An API key; with gameSlug, each start brings in the game's items from Zaisma. Default: the ZAISMA_KEY environment variable. */
  zaismaKey?: string;
  /** Zaisma's developer API, where that copy is read from. Default: https://zaisma.com/api/dev. */
  developerApiUrl?: string;
  /** Where lines of text go. Default: the terminal. */
  log?: (line: string) => void;
}

export interface LocalPlay {
  /** The test bench's address, on this computer. */
  benchUrl: string;
  gameSiteUrl: string;
  roomsUrl: string;
  /** The bench's address for a phone on the same Wi-Fi; null without isOnNetwork. */
  networkUrl: string | null;
  /** The slug the bench plays the game as: gameSlug, or the folder's name. */
  gameSlug: string;
  /** Whether gameSlug came from the folder's name, since none was given. */
  isGameSlugFromFolder: boolean;
  /** The folder holding what the bench keeps. */
  benchFolder: string;
  /** How many times the game server has been started: more than one after a change to its files. */
  readonly runnerStartCount: number;
  /** Saves every room, then stops everything. */
  close(): Promise<void>;
}

export const DEFAULT_PORT_NUMBER: number;
export const LOCAL_VERSION_ID: string;
export const LOCAL_FOLDER: string;
export const SERVED_ZAISMA_PATHS: string[];
export const ONLY_ON_ZAISMA_PATHS: string[];
export const ONLY_ON_BENCH_PATHS: string[];
export function startLocalPlay(options: LocalPlayOptions): Promise<LocalPlay>;
export function benchFolderOf(gameFolder: string): string;
export function serverEntryOf(gameFolder: string): string | null;
export function withScripts(page: string, scriptUrls: string[]): string;
export function localGameHeaders(contentType: string, benchOrigin: string, connectOrigins: string[]): Record<string, string>;
export function terminalQr(text: string): string;
