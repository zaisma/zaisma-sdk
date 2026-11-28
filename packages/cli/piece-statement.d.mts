/** A piece's piece.json, read and checked (docs/PIECES.md, "What a piece states"). */
export interface PieceStatement {
  statement_version_number: number;
  name: string;
  piece_version: string;
  kind: "foundation" | "extension" | "game_system" | "template" | "pack" | "preset" | "skill" | "tool";
  /** The standard it's built on; null only for a pack, preset, skill or tool built on none. */
  standard: string | null;
  summary: string;
  license: string;
  entry_path: string | null;
  server_entry_path: string | null;
  file_paths: string[];
  server_file_paths: string[];
  needs: PieceNeed[];
  settings: StatedSetting[];
  hooks: StatedHook[];
}
export interface PieceNeed {
  name: string;
  version_range: string;
  kind: "piece" | "library" | "engine";
}
export interface StatedSetting {
  name: string;
  value_kind: "number" | "integer" | "boolean" | "choice" | "text" | "color";
  default_value: number | boolean | string;
  minimum_number: number | null;
  maximum_number: number | null;
  maximum_character_count: number | null;
  choices: string[] | null;
  summary: string;
}
export interface StatedHook {
  name: string;
  hook_kind: "event" | "decision";
  summary: string;
}

export declare const STATEMENT_VERSION_NUMBER: number;
export declare const RECORD_VERSION_NUMBER: number;
export declare const STATEMENT_FIELDS: string[];
export declare const NEED_FIELDS: string[];
export declare const SETTING_FIELDS: string[];
export declare const HOOK_FIELDS: string[];
export declare const PIECE_KINDS: PieceStatement["kind"][];
/** The kinds whose code a game runs: each is built on a standard. */
export declare const LAYER_KINDS: PieceStatement["kind"][];
/** The kinds a game never holds: fetched for the developer or their AI. */
export declare const FETCHED_KINDS: PieceStatement["kind"][];
export declare const SKILL_ENTRY_PATH: string;
export declare const NEED_KINDS: PieceNeed["kind"][];
export declare const SETTING_VALUE_KINDS: StatedSetting["value_kind"][];
export declare const HOOK_KINDS: StatedHook["hook_kind"][];
export declare const SOURCE_KINDS: SourceKind[];
export declare const STATEMENT_PATH: string;
export declare const STATEMENT_MODULE_PATH: string;
export declare const RECORD_PATH: string;
export declare const PIECES_FOLDER: string;
export declare const SERVER_PIECES_FOLDER: string;
export declare const PIECE_LIMITS: Record<string, number>;
export type SourceKind = "folder" | "tarball" | "npm" | "marketplace";

/** A failure in the API's error shape. */
export declare class PiecesError extends Error {
  error: { code: string; message: string; field: string | null; fix: string; retry_after_sec: null };
}

export declare function parseVersion(text: string): { majorNumber: number; minorNumber: number; patchNumber: number; prerelease: string | null } | null;
export declare function compareVersions(first: string, second: string): number;
export declare function parseRange(rangeText: string): { operator: string; version: string }[][] | null;
export declare function satisfies(version: string, rangeText: string): boolean;
export declare function newestSatisfying(versions: string[], ranges: string | string[]): string | null;
export declare function camelName(statedName: string): string;
export declare function isSafePath(path: unknown): boolean;
/** Whether a licence, as a piece states it, opens its source. */
export declare function isOpenLicense(license: unknown): boolean;
export declare function readStatement(statementText: string, whereFrom?: string): PieceStatement;
export declare function statementModuleText(statementText: string): string;
