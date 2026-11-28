import type { PieceNeed, PieceStatement, SourceKind, StatedHook, StatedSetting } from "./piece-statement.mjs";
export * from "./piece-statement.mjs";

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
  standard: string | null;
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
  kind: PieceStatement["kind"] | null;
  /** A pack's or preset's mark, from opening every file as the marketplace does; null for other kinds. */
  contents_kind: "files_only" | "contains_code" | null;
  is_ready: boolean;
  problems: PieceCheckProblem[];
}

export declare const PIECE_CHECK_CODES: Record<string, { problemKind: "refused" | "note"; meaning: string }>;

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
/**
 * Zaisma's marketplace, as a way to look a piece up by name: versionsOf answers { version: … } or null when it has no
 * such piece, archiveOf the files of the newest version every range accepts. The command makes one from the developer's key.
 */
export interface MarketplaceReader {
  versionsOf(name: string): Promise<Record<string, unknown> | null>;
  archiveOf(name: string, ranges: string[]): Promise<{ version: string; allFiles: Record<string, Uint8Array>; whereFrom: string } | null>;
}
/** What fetching a piece into a folder of its own did. */
export interface FetchedCopy {
  is_dry_run: boolean;
  name: string;
  piece_version: string;
  kind: PieceStatement["kind"];
  source_kind: SourceKind;
  folder: string;
  /** The version of the same piece that was there before; null when the folder was empty. */
  earlier_piece_version: string | null;
  added_paths: string[];
  changed_paths: string[];
  removed_paths: string[];
}
export declare function readPiece(source: string, options?: { marketplace?: MarketplaceReader | null }): Promise<Unit>;
export declare function writePieceCopy(piece: Unit, toFolder: string, options?: { isDryRun?: boolean }): Promise<FetchedCopy>;
export declare function getPiece(source: string, toFolder: string, options?: { isDryRun?: boolean; marketplace?: MarketplaceReader | null }): Promise<FetchedCopy>;
/** The folder in a piece's folder that holds its listing's own pictures: never part of the piece. */
export declare const LISTING_FOLDER: string;
/** One of a listing's pictures from its folder. */
export interface ListingPictureFile {
  /** Its path in the piece's folder: "listing/cover.png". */
  path: string;
  bytes: Uint8Array;
}
/** A piece's listing pictures as its folder keeps them; null with no listing folder. cover null: no cover file. gallery null: no listing/gallery folder. */
export declare function readListingPictures(pieceFolder: string): Promise<{ cover: ListingPictureFile | null; gallery: ListingPictureFile[] | null } | null>;
export declare function readPieceForPublishing(pieceFolder: string): Promise<{ statement: PieceStatement; files: Record<string, Uint8Array> }>;
export declare function readRecord(gameFolder: string): Promise<PiecesRecord>;
export declare function placesOf(unit: Unit): { path: string; filePath: string; hashKey: string }[];
export declare function importMapOf(record: PiecesRecord): ImportMap;
export declare function listPieces(gameFolder: string): Promise<PiecesList>;
export declare function addPiece(gameFolder: string, source: string, options?: { isDryRun?: boolean; marketplace?: MarketplaceReader | null }): Promise<Brought>;
export declare function updatePiece(gameFolder: string, name: string, options?: { versionRange?: string; source?: string | null; isDiscardingEdits?: boolean; isDryRun?: boolean; marketplace?: MarketplaceReader | null }): Promise<UpdateAnswer>;
export declare function removePiece(gameFolder: string, name: string, options?: { isDiscardingEdits?: boolean; isDryRun?: boolean }): Promise<RemoveAnswer>;
export declare function newerPieces(gameFolder: string, options?: { marketplace?: MarketplaceReader | null }): Promise<NewerAnswer>;
export declare function checkPiece(pieceFolder: string, options?: { isFixing?: boolean }): Promise<PieceCheckAnswer>;
