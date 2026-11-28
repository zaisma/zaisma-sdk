/** What a pack or preset is marked as: nothing in it can run, or something can (or the check can't rule it out). */
export type ContentsKind = "files_only" | "contains_code";
export type FileFamily = "image" | "sound" | "video" | "model" | "font" | "text" | "data" | "code" | "unknown";
/** What one file is, found by opening it. */
export interface FileContents {
  file_family: FileFamily;
  contents_kind: ContentsKind;
  /** Why it's contains_code; null when it's files_only. */
  reason: string | null;
  /** Its bytes aren't what its name says: no pack may hold it. */
  is_mislabeled: boolean;
}
export declare const CONTENTS_KINDS: ContentsKind[];
export declare const FILE_FAMILIES: FileFamily[];
export declare const CONTENT_HEAD_SIZE_BYTES: number;
export declare const MAXIMUM_SVG_SIZE_BYTES: number;
/** How many of a file's first bytes fileContentsOf needs to judge it. */
export declare function neededHeadSizeBytes(path: string): number;
/** Whether a file's first bytes are text as people write it. */
export declare function isText(headBytes: Uint8Array): boolean;
/** What Zaisma's storage takes in no piece, from a file's first bytes: what it is in words, or null. */
export declare function refusedFileOf(headBytes: Uint8Array): string | null;
/** What a file's name says it is: its family by its extension alone. */
export declare function fileFamilyOf(path: string): FileFamily;
export declare function fileContentsOf(path: string, headBytes: Uint8Array): FileContents;
export declare function contentsKindOf(fileAnswers: Pick<FileContents, "contents_kind">[]): ContentsKind;
