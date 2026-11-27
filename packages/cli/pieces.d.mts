/** A piece's piece.json, read and checked (docs/PIECES.md, "What a piece states"). */
export interface PieceStatement {
  statement_version_number: number;
  name: string;
  piece_version: string;
  kind: "foundation" | "extension" | "game_system" | "template";
  standard: string;
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
/** A library a game's pieces brought, as its record keeps it. */
export interface RecordedLibrary {
  name: string;
  library_version: string;
  summary: string;
  license: string | null;
  entry_path: string;
  file_paths: string[];
  source_kind: SourceKind;
  files_sha256: string;
}
export type SourceKind = "folder" | "tarball" | "npm";
/** A game's pieces/pieces.json. */
export interface PiecesRecord {
  about: string;
  record_version_number: number;
  pieces: { statement: PieceStatement; source_kind: SourceKind; files_sha256: string | null }[];
  libraries: RecordedLibrary[];
}
/** One thing a game can hold in its pieces folder: a piece (with its statement) or a library that isn't one. */
export interface Unit {
  name: string;
  version: string;
  kind: PieceStatement["kind"] | "library";
  needs: PieceNeed[];
  statement: PieceStatement | null;
  library: Omit<RecordedLibrary, "source_kind" | "files_sha256"> | null;
  files: Record<string, Uint8Array> | null;
  sourceKind: SourceKind;
  source: string | null;
}
export interface ShownPiece {
  name: string;
  piece_version: string;
  kind: PieceStatement["kind"];
  standard: string;
  summary: string;
  license: string;
  source_kind: SourceKind;
  import_path: string | null;
  server_import_path: string | null;
  needs: PieceNeed[];
  settings: StatedSetting[];
  hooks: StatedHook[];
  is_edited: boolean;
}
export interface ShownLibrary {
  name: string;
  library_version: string;
  summary: string;
  license: string | null;
  source_kind: SourceKind;
  import_path: string;
  is_edited: boolean;
}
export interface ImportMap {
  imports: Record<string, string>;
}
export interface EngineNeed {
  name: string;
  version_range: string;
  needed_by_name: string;
}
export interface PiecesList {
  pieces: ShownPiece[];
  libraries: ShownLibrary[];
  standards: string[];
  import_map: ImportMap;
}
export interface Brought {
  is_dry_run: boolean;
  added_pieces: ShownPiece[];
  added_libraries: ShownLibrary[];
  kept_names: string[];
  engine_needs: EngineNeed[];
  standards: string[];
  new_standards: string[];
  import_map: ImportMap;
}
export interface UpdateAnswer extends Brought {
  name: string;
  updated_piece: ShownPiece | null;
  updated_library: ShownLibrary | null;
  earlier_piece_version: string | null;
  earlier_library_version: string | null;
}
export interface RemoveAnswer {
  is_dry_run: boolean;
  removed_name: string;
  removed_folders: string[];
  no_longer_needed_names: string[];
  import_map: ImportMap;
}
export interface NewerAnswer {
  newer_pieces: { name: string; piece_version: string; newest_piece_version: string; newest_accepted_piece_version: string | null; held_back_by_names: string[] }[];
  newer_libraries: { name: string; library_version: string; newest_library_version: string; newest_accepted_library_version: string | null; held_back_by_names: string[] }[];
  unchecked_names: string[];
}
export interface PieceCheckProblem {
  code: string;
  problem_kind: "refused" | "note";
  message: string;
  path: string | null;
  fix: string;
}
export interface PieceCheckAnswer {
  name: string | null;
  piece_version: string | null;
  is_ready: boolean;
  problems: PieceCheckProblem[];
}

export declare const STATEMENT_VERSION_NUMBER: number;
export declare const RECORD_VERSION_NUMBER: number;
export declare const STATEMENT_FIELDS: string[];
export declare const NEED_FIELDS: string[];
export declare const SETTING_FIELDS: string[];
export declare const HOOK_FIELDS: string[];
export declare const PIECE_KINDS: PieceStatement["kind"][];
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
export declare const PIECE_CHECK_CODES: Record<string, { problemKind: "refused" | "note"; meaning: string }>;

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
export declare function readStatement(statementText: string, whereFrom?: string): PieceStatement;
export declare function statementModuleText(statementText: string): string;
export declare function planAdd(plan: {
  piece: Unit;
  had?: Record<string, Unit>;
  gameLibraries?: Record<string, string>;
  find: (name: string, needKind: "piece" | "library", ranges: string[]) => Promise<Unit | null> | Unit | null;
}): Promise<{ added: Unit[]; keptNames: string[]; engineNeeds: EngineNeed[] }>;
export declare function needersOf(name: string, had: Record<string, Unit>): { holder: Unit; need: PieceNeed }[];
export declare function checkUpdateFits(update: { name: string; nextVersion: string; had: Record<string, Unit> }): void;
export declare function filesHash(files: Record<string, Uint8Array>): string;
export declare function readTar(bytes: Uint8Array): Record<string, Buffer>;
export declare function readSource(source: string, where?: { baseFolder?: string }): Promise<Unit>;
export declare function readRecord(gameFolder: string): Promise<PiecesRecord>;
export declare function placesOf(unit: Unit): { path: string; filePath: string; hashKey: string }[];
export declare function importMapOf(record: PiecesRecord): ImportMap;
export declare function listPieces(gameFolder: string): Promise<PiecesList>;
export declare function addPiece(gameFolder: string, source: string, options?: { isDryRun?: boolean }): Promise<Brought>;
export declare function updatePiece(gameFolder: string, name: string, options?: { versionRange?: string; source?: string | null; isDiscardingEdits?: boolean; isDryRun?: boolean }): Promise<UpdateAnswer>;
export declare function removePiece(gameFolder: string, name: string, options?: { isDiscardingEdits?: boolean; isDryRun?: boolean }): Promise<RemoveAnswer>;
export declare function newerPieces(gameFolder: string): Promise<NewerAnswer>;
export declare function checkPiece(pieceFolder: string, options?: { isFixing?: boolean }): Promise<PieceCheckAnswer>;
