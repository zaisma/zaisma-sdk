// Types for fixed-checks.mjs, so the site and the tests import the fixed checks type-checked.

export type FixedCheckSeverity = "reject" | "hold" | "info";

export interface FixedCheckFile {
  path: string;
  text: string;
}

export interface FixedCheck {
  code: string;
  severity: FixedCheckSeverity;
  message: string;
  only?: RegExp;
  /** Where in the file the check found what it looks for, or null. */
  find(file: FixedCheckFile): number | null;
}

export interface FixedCheckFinding {
  stage: "static";
  severity: FixedCheckSeverity;
  code: string;
  message: string;
  path?: string;
  quote?: string;
}

export const MINER_PATTERN: RegExp;
export const IGNORED_HOSTS: Set<string>;
export const MINER_SEARCH_PIECE_SIZE_BYTES: number;
export const MINER_SEARCH_OVERLAP_SIZE_BYTES: number;
export const FIXED_CHECKS: FixedCheck[];
export const REFUSING_CHECK_CODES: string[];
export function isMinerPiece(bytes: Uint8Array): boolean;
export function isMinerModule(bytes: Uint8Array): boolean;
export function isWasmModule(bytes: Uint8Array): boolean;
export function embeddedWasmModules(text: string): { index: number; isMinerLike: boolean }[];
export function runFixedChecks(files: FixedCheckFile[], ownServerHosts?: readonly string[]): { findings: FixedCheckFinding[]; outsideHosts: string[] };
export function wasmFileFindings(path: string, bytes: Uint8Array): FixedCheckFinding[];
