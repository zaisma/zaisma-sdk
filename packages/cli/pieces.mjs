// Pieces: shared building blocks a game is made from (docs/PIECES.md). This is the frame every piece stands on:
// what a piece states about itself (its piece.json: its kind, the standard it's built on, what it needs and the
// versions it accepts, its settings and hooks), how it's added to a game, how its versions move, and the check a
// maker runs before publishing. Anyone publishes a piece, for any engine. Nothing here knows any piece, standard
// or publisher by name, and adding never runs a piece's code: every piece goes through exactly the same steps.
//
// The rules of adding (planAdd): a piece's needs come with it; one the game already has, at a version the new
// piece accepts, is left exactly as it is (never a second copy, never moved to another version); one at a version
// it doesn't accept stops everything, saying both versions and the ways out; and nothing is written unless the
// whole set fits. A version moves only in updatePiece, for the one piece named.
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { parse as parseJavaScript } from "acorn";
import { GAME_FILE_EXTENSIONS, extensionOf } from "./check.mjs";

/** The format of a piece.json this command reads. A statement with a higher number is from a newer command. */
export const STATEMENT_VERSION_NUMBER = 1;
/** The format of a game's pieces/pieces.json this command reads and writes. */
export const RECORD_VERSION_NUMBER = 1;
/** The kinds of piece, from the standards everything fits to the thing copied once. */
export const PIECE_KINDS = ["foundation", "extension", "game_system", "template"];
/** What a piece can need: another piece, a library from npm that isn't a piece, or an engine the game must already be on. */
export const NEED_KINDS = ["piece", "library", "engine"];
/** The kinds of value a setting holds. */
export const SETTING_VALUE_KINDS = ["number", "integer", "boolean", "choice", "text", "color"];
/** The kinds of hook: the piece tells the game something happened, or asks it before something does. */
export const HOOK_KINDS = ["event", "decision"];
/** Where a piece can come from. */
export const SOURCE_KINDS = ["folder", "tarball", "npm"];
/** A piece's statement, at the top of its folder. */
export const STATEMENT_PATH = "piece.json";
/** The statement as a module, for a piece's own code to read: always exactly what statementModuleText makes of piece.json. */
export const STATEMENT_MODULE_PATH = "piece.json.js";
/** The game's record of its pieces, in its pieces folder. */
export const RECORD_PATH = "pieces/pieces.json";
/** Where pieces go in a game, and where their game server files go: a game server on Zaisma imports only from its own folder. */
export const PIECES_FOLDER = "pieces";
export const SERVER_PIECES_FOLDER = "zaisma-server/pieces";
/** What a piece may hold and state; past these it's refused. */
export const PIECE_LIMITS = {
  maximumFileCount: 5000,
  maximumArchiveSizeBytes: 200_000_000,
  maximumUnpackedSizeBytes: 500_000_000,
  maximumStatementSizeBytes: 500_000,
  maximumNeedCount: 50,
  maximumSettingCount: 200,
  maximumHookCount: 200,
  maximumSummaryCharacterCount: 400,
  maximumChoiceCount: 50,
  maximumTextCharacterCount: 10_000,
};

/** Every field of a piece.json, of one of its needs, settings and hooks: each is there every time, and nothing else is. */
export const STATEMENT_FIELDS = ["statement_version_number", "name", "piece_version", "kind", "standard", "summary", "license", "entry_path", "server_entry_path", "file_paths", "server_file_paths", "needs", "settings", "hooks"];
export const NEED_FIELDS = ["name", "version_range", "kind"];
export const SETTING_FIELDS = ["name", "value_kind", "default_value", "minimum_number", "maximum_number", "maximum_character_count", "choices", "summary"];
export const HOOK_FIELDS = ["name", "hook_kind", "summary"];
const NAME_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const MAXIMUM_NAME_CHARACTER_COUNT = 100;
const STATED_NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MAXIMUM_STATED_NAME_CHARACTER_COUNT = 64;
const CHOICE_PATTERN = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const LICENSE_PATTERN = /^[A-Za-z0-9.+()-]+( [A-Za-z0-9.+()-]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z.-]+)?$/;
const FETCH_TIMEOUT_MS = 30000;
const NEWEST_COMMAND = "npx @zaisma/cli@latest";

/** A failure in the API's error shape (docs/NAMING.md, Errors). */
export class PiecesError extends Error {
  constructor(code, { message, field = null, fix }) {
    super(message);
    this.error = { code, message, field, fix, retry_after_sec: null };
  }
}
const refuse = (code, details) => {
  throw new PiecesError(code, details);
};

// ---- Versions and ranges (semver) ----

/** A version like "1.4.2" or "2.0.0-beta.1" in its parts, or null when it isn't one. */
export function parseVersion(text) {
  const match = VERSION_PATTERN.exec(String(text).trim());
  return match ? { majorNumber: Number(match[1]), minorNumber: Number(match[2]), patchNumber: Number(match[3]), prerelease: match[4] ? match[4].slice(1) : null } : null;
}

/** Semver's order for two pre-release tags: numbers by size, words by letters, a number before a word, the shorter first. */
function comparePrereleases(first, second) {
  const [firstParts, secondParts] = [first.split("."), second.split(".")];
  for (let i = 0; i < Math.max(firstParts.length, secondParts.length); i++) {
    if (firstParts[i] === undefined) return -1;
    if (secondParts[i] === undefined) return 1;
    const [isFirstNumber, isSecondNumber] = [/^\d+$/.test(firstParts[i]), /^\d+$/.test(secondParts[i])];
    if (isFirstNumber && isSecondNumber && Number(firstParts[i]) !== Number(secondParts[i])) return Number(firstParts[i]) - Number(secondParts[i]);
    if (isFirstNumber !== isSecondNumber) return isFirstNumber ? -1 : 1;
    if (!isFirstNumber && firstParts[i] !== secondParts[i]) return firstParts[i] < secondParts[i] ? -1 : 1;
  }
  return 0;
}

/** Negative when first is older than second, positive when newer, 0 when the same. */
export function compareVersions(first, second) {
  const [firstVersion, secondVersion] = [parseVersion(first), parseVersion(second)];
  for (const part of ["majorNumber", "minorNumber", "patchNumber"]) if (firstVersion[part] !== secondVersion[part]) return firstVersion[part] - secondVersion[part];
  if (firstVersion.prerelease === secondVersion.prerelease) return 0;
  if (firstVersion.prerelease === null) return 1;
  if (secondVersion.prerelease === null) return -1;
  return comparePrereleases(firstVersion.prerelease, secondVersion.prerelease);
}

/** One comparator like ">=1.2.0", "^1.2.0", "~1.2", "1.x" or "*" as the versions it lets through: [{ operator, version }], all of which must hold. */
function comparatorBounds(text) {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\*|x|X|\d+)(?:\.(\*|x|X|\d+))?(?:\.(\*|x|X|\d+))?(-[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) return null;
  const [, operator = "", majorText, minorText, patchText, prerelease = ""] = match;
  const isWild = (part) => part === undefined || part === "*" || part === "x" || part === "X";
  if (isWild(majorText)) return [];
  const majorNumber = Number(majorText);
  const minorNumber = isWild(minorText) ? null : Number(minorText);
  const patchNumber = isWild(patchText) ? null : Number(patchText);
  const floor = `${majorNumber}.${minorNumber ?? 0}.${patchNumber ?? 0}${prerelease}`;
  const nextMajor = `${majorNumber + 1}.0.0`;
  const nextMinor = `${majorNumber}.${(minorNumber ?? 0) + 1}.0`;
  if (operator === "^") {
    // ^ keeps the leftmost number that isn't zero.
    const ceiling = majorNumber > 0 || minorNumber === null ? nextMajor : minorNumber > 0 || patchNumber === null ? nextMinor : `${majorNumber}.${minorNumber}.${patchNumber + 1}`;
    return [{ operator: ">=", version: floor }, { operator: "<", version: ceiling }];
  }
  if (operator === "~") return [{ operator: ">=", version: floor }, { operator: "<", version: minorNumber === null ? nextMajor : nextMinor }];
  if (operator === "" || operator === "=") {
    if (minorNumber === null) return [{ operator: ">=", version: floor }, { operator: "<", version: nextMajor }];
    if (patchNumber === null) return [{ operator: ">=", version: floor }, { operator: "<", version: nextMinor }];
    return [{ operator: "=", version: floor }];
  }
  // A bare ">1" means past every 1.x, and "<=1" means up to the last 1.x.
  if (operator === ">" && patchNumber === null) return [{ operator: ">=", version: minorNumber === null ? nextMajor : nextMinor }];
  if (operator === "<=" && patchNumber === null) return [{ operator: "<", version: minorNumber === null ? nextMajor : nextMinor }];
  return [{ operator, version: floor }];
}

/** A range like "^1.0.0", ">=0.160.0 <1.0.0" or "1.x || 2.x" as its alternatives, each a list of bounds; null when it isn't a range. */
export function parseRange(rangeText) {
  if (typeof rangeText !== "string" || !rangeText.trim() || rangeText.length > 200) return null;
  const alternatives = [];
  for (const alternative of rangeText.split("||")) {
    const bounds = [];
    for (const word of alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/).filter(Boolean)) {
      const parsed = comparatorBounds(word);
      if (!parsed) return null;
      bounds.push(...parsed);
    }
    alternatives.push(bounds);
  }
  return alternatives;
}

/** Whether a version is one a range accepts. A pre-release version is accepted only by a range that names it exactly. */
export function satisfies(version, rangeText) {
  const alternatives = parseRange(rangeText);
  if (!alternatives || !parseVersion(version)) return false;
  const isPrerelease = parseVersion(version).prerelease !== null;
  return alternatives.some((bounds) => {
    if (isPrerelease && !bounds.some((bound) => bound.version === version)) return false;
    return bounds.every(({ operator, version: bound }) => {
      const isNewer = compareVersions(version, bound) > 0;
      const isSame = compareVersions(version, bound) === 0;
      return operator === ">=" ? isNewer || isSame : operator === "<=" ? !isNewer : operator === ">" ? isNewer : operator === "<" ? !isNewer && !isSame : isSame;
    });
  });
}

/** The newest of some versions that every one of the ranges accepts, or null. */
export function newestSatisfying(versions, ranges) {
  const everyRange = Array.isArray(ranges) ? ranges : [ranges];
  return versions.filter((version) => everyRange.every((rangeText) => satisfies(version, rangeText))).sort(compareVersions).pop() ?? null;
}

// ---- A piece's statement (piece.json) ----

/**
 * A path inside a piece: forward slashes, no "..", never absolute. No part is hidden (".git", ".github") or
 * node_modules either: a template's files land in the game's own folder, where those run without being asked.
 */
function isSafePath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 200 && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.includes("\\") && !/[\0-\x1f]/.test(path) && !path.split("/").some((part) => part === "" || part.startsWith(".") || part === "node_modules");
}

/** A stated name in a JavaScript piece's own style: jump_height_m is jumpHeightM. */
export function camelName(statedName) {
  return statedName.replace(/_([a-z0-9])/g, (whole, letter) => letter.toUpperCase());
}

const isPlainObject = (given) => given !== null && typeof given === "object" && !Array.isArray(given);

/**
 * A piece.json, checked: every field there and of its shape, nothing unknown (docs/PIECES.md, "What a piece
 * states"). Throws bad_piece_statement naming the field at fault, or piece_statement_newer for a statement
 * written for a newer command than this one.
 */
export function readStatement(statementText, whereFrom = STATEMENT_PATH) {
  const bad = (field, message, fix) => refuse("bad_piece_statement", { message: `${whereFrom}: ${message}`, field, fix });
  let statement;
  try {
    statement = JSON.parse(statementText);
  } catch {
    statement = null;
  }
  if (!isPlainObject(statement)) bad(null, "it isn't a JSON object.", `A piece.json is an object with ${STATEMENT_FIELDS.join(", ")} (docs/PIECES.md).`);
  const formatNumber = statement.statement_version_number;
  if (!Number.isInteger(formatNumber) || formatNumber < 1) bad("statement_version_number", "its statement_version_number isn't a whole number from 1.", `Give ${STATEMENT_VERSION_NUMBER}: the format this piece.json is written in.`);
  if (formatNumber > STATEMENT_VERSION_NUMBER) {
    refuse("piece_statement_newer", { message: `${whereFrom} is written in format ${formatNumber}, and this command reads up to ${STATEMENT_VERSION_NUMBER}.`, field: "statement_version_number", fix: `Run the newest command: ${NEWEST_COMMAND} pieces.` });
  }
  for (const field of Object.keys(statement)) if (!STATEMENT_FIELDS.includes(field)) bad(field, `it has an unknown field "${field}".`, `A piece.json holds only: ${STATEMENT_FIELDS.join(", ")}.`);
  for (const field of STATEMENT_FIELDS) if (!(field in statement)) bad(field, `it has no ${field}.`, `Give every field: ${STATEMENT_FIELDS.join(", ")}.`);
  const isName = (name) => typeof name === "string" && NAME_PATTERN.test(name) && name.length <= MAXIMUM_NAME_CHARACTER_COUNT;
  if (!isName(statement.name)) bad("name", `its name "${statement.name}" isn't a piece's name.`, 'Give a name as npm takes them, like "@studio/dash-move".');
  if (!parseVersion(statement.piece_version)) bad("piece_version", `its piece_version "${statement.piece_version}" isn't a version.`, 'Give three numbers, like "1.0.0".');
  if (!PIECE_KINDS.includes(statement.kind)) bad("kind", `its kind "${statement.kind}" isn't a kind of piece.`, `Use one of: ${PIECE_KINDS.join(", ")}.`);
  if (!isName(statement.standard)) bad("standard", `its standard "${statement.standard}" isn't a standard's name.`, 'Name the standard the piece is built on, as its keeper holds it on npm, like "@studio/standard".');
  const isSummary = (summary) => typeof summary === "string" && summary.trim().length > 0 && summary.length <= PIECE_LIMITS.maximumSummaryCharacterCount;
  if (!isSummary(statement.summary)) bad("summary", `its summary is missing or over ${PIECE_LIMITS.maximumSummaryCharacterCount} characters.`, "Say in a sentence or two what the piece gives a game.");
  if (typeof statement.license !== "string" || !LICENSE_PATTERN.test(statement.license) || statement.license.length > 100) bad("license", `its license "${statement.license}" isn't a licence's name.`, 'Name the licence the piece is under, as SPDX does, like "MIT" or "Apache-2.0".');
  for (const field of ["file_paths", "server_file_paths"]) {
    const paths = statement[field];
    if (!Array.isArray(paths) || !paths.every(isSafePath) || new Set(paths).size !== paths.length) bad(field, `its ${field} isn't a list of the piece's own files.`, 'List each file once by its path inside the piece, like "index.js" or "sounds/step.ogg".');
    if (paths.includes(STATEMENT_PATH)) bad(field, `its ${field} lists ${STATEMENT_PATH}.`, `Take it out: a piece's ${STATEMENT_PATH} always comes with it.`);
  }
  if (statement.file_paths.length + statement.server_file_paths.length > PIECE_LIMITS.maximumFileCount) bad("file_paths", `it lists more than ${PIECE_LIMITS.maximumFileCount} files.`, "Split the piece, or pack small files together.");
  if (!statement.file_paths.length && !statement.server_file_paths.length) bad("file_paths", "it lists no files.", "List the piece's files in file_paths, and its game server files in server_file_paths.");
  for (const [entryField, pathsField] of [["entry_path", "file_paths"], ["server_entry_path", "server_file_paths"]]) {
    const [entryPath, paths] = [statement[entryField], statement[pathsField]];
    if (!paths.length && entryPath !== null) bad(entryField, `its ${entryField} names a file, and its ${pathsField} is empty.`, `Give null, or list the file in ${pathsField}.`);
    if (paths.length && !paths.includes(entryPath)) bad(entryField, `its ${entryField} isn't one of its ${pathsField}.`, `Name the file ${entryField === "entry_path" ? "a game" : "a game server"} starts from, one of ${pathsField}.`);
  }
  if (statement.kind === "template") {
    // A template's files become the game's own, its game server's among them, so there's nothing to open or keep apart.
    if (statement.server_file_paths.length) bad("server_file_paths", "it's a template with server_file_paths.", "A template's files are copied into the game's own folder: list them all in file_paths, its game server's under zaisma-server/.");
    if (statement.file_paths.some((path) => path === RECORD_PATH || path.startsWith(`${PIECES_FOLDER}/`) || path.startsWith(`${SERVER_PIECES_FOLDER}/`))) bad("file_paths", `it's a template that writes into ${PIECES_FOLDER}/.`, `Pieces a template uses go in its needs; ${PIECES_FOLDER}/ and ${SERVER_PIECES_FOLDER}/ hold only what the command adds.`);
    if (!Array.isArray(statement.settings) || !Array.isArray(statement.hooks) || statement.settings.length || statement.hooks.length) bad("settings", "it's a template with settings or hooks.", "Give empty lists: a template is copied once and is then the game's own to change.");
  }
  if (!Array.isArray(statement.needs) || statement.needs.length > PIECE_LIMITS.maximumNeedCount) bad("needs", `its needs isn't a list of at most ${PIECE_LIMITS.maximumNeedCount}.`, "Give a list, empty when the piece needs nothing.");
  for (const need of statement.needs) {
    if (!isPlainObject(need)) bad("needs", "one of its needs isn't an object.", `Each need is { ${NEED_FIELDS.join(", ")} }.`);
    for (const field of Object.keys(need)) if (!NEED_FIELDS.includes(field)) bad("needs", `a need has an unknown field "${field}".`, `A need holds only: ${NEED_FIELDS.join(", ")}.`);
    if (!isName(need.name)) bad("needs", `a need's name "${need.name}" isn't a name.`, "Name the piece or library needed as npm names it, or the engine in lowercase.");
    if (!parseRange(need.version_range)) bad("needs", `the need for ${need.name} has a version_range "${need.version_range}" that isn't a range.`, 'Give the versions accepted, like "^1.0.0" or ">=0.160.0 <1.0.0".');
    if (!NEED_KINDS.includes(need.kind)) bad("needs", `the need for ${need.name} has kind "${need.kind}".`, `Use one of: ${NEED_KINDS.join(", ")}.`);
  }
  if (new Set(statement.needs.map((need) => need.name)).size !== statement.needs.length) bad("needs", "it needs the same thing twice.", "List each need once.");
  if (statement.needs.some((need) => need.name === statement.name)) bad("needs", "it needs itself.", "Take the piece's own name out of its needs.");
  if (!Array.isArray(statement.settings) || statement.settings.length > PIECE_LIMITS.maximumSettingCount) bad("settings", `its settings isn't a list of at most ${PIECE_LIMITS.maximumSettingCount}.`, "Give a list, empty when the piece has no settings.");
  const isStatedName = (name) => typeof name === "string" && STATED_NAME_PATTERN.test(name) && name.length <= MAXIMUM_STATED_NAME_CHARACTER_COUNT;
  for (const setting of statement.settings) {
    if (!isPlainObject(setting)) bad("settings", "one of its settings isn't an object.", `Each setting is { ${SETTING_FIELDS.join(", ")} }.`);
    const badSetting = (message, fix) => bad("settings", `the setting ${setting.name}: ${message}`, fix);
    for (const field of Object.keys(setting)) if (!SETTING_FIELDS.includes(field)) bad("settings", `a setting has an unknown field "${field}".`, `A setting holds only: ${SETTING_FIELDS.join(", ")}.`);
    for (const field of SETTING_FIELDS) if (!(field in setting)) bad("settings", `a setting has no ${field}.`, `Give every field, null where it doesn't apply: ${SETTING_FIELDS.join(", ")}.`);
    if (!isStatedName(setting.name)) bad("settings", `a setting's name "${setting.name}" isn't a name.`, 'Name it in lowercase with underscores, saying what it holds and its unit, like "jump_height_m" (docs/NAMING.md).');
    if (!SETTING_VALUE_KINDS.includes(setting.value_kind)) badSetting(`its value_kind "${setting.value_kind}" isn't a kind of value.`, `Use one of: ${SETTING_VALUE_KINDS.join(", ")}.`);
    if (!isSummary(setting.summary)) badSetting(`its summary is missing or over ${PIECE_LIMITS.maximumSummaryCharacterCount} characters.`, "Say in a sentence what the setting changes.");
    const isNumeric = setting.value_kind === "number" || setting.value_kind === "integer";
    const isNumber = (given) => typeof given === "number" && Number.isFinite(given) && (setting.value_kind !== "integer" || Number.isInteger(given));
    if (isNumeric) {
      if (![setting.default_value, setting.minimum_number, setting.maximum_number].every(isNumber)) badSetting(`its default_value, minimum_number and maximum_number aren't all ${setting.value_kind === "integer" ? "whole numbers" : "numbers"}.`, "Give all three: every number has a range.");
      if (setting.minimum_number > setting.default_value || setting.default_value > setting.maximum_number) badSetting("its default_value isn't between its minimum_number and maximum_number.", "Give a default within the range.");
    } else if (setting.minimum_number !== null || setting.maximum_number !== null) badSetting(`it's a ${setting.value_kind} with a minimum_number or maximum_number.`, "Give null for both: only a number or an integer has a range.");
    if (setting.value_kind === "boolean" && typeof setting.default_value !== "boolean") badSetting("its default_value isn't true or false.", "Give true or false.");
    if (setting.value_kind === "color" && (typeof setting.default_value !== "string" || !COLOR_PATTERN.test(setting.default_value))) badSetting("its default_value isn't a colour.", 'Give six hex digits in lowercase, like "#3fa9f5".');
    if (setting.value_kind === "choice") {
      const choices = setting.choices;
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > PIECE_LIMITS.maximumChoiceCount || !choices.every((choice) => typeof choice === "string" && CHOICE_PATTERN.test(choice) && choice.length <= MAXIMUM_STATED_NAME_CHARACTER_COUNT) || new Set(choices).size !== choices.length) badSetting(`its choices isn't a list of 2 to ${PIECE_LIMITS.maximumChoiceCount} different lowercase words.`, 'List each choice once, like ["low", "medium", "high"].');
      if (!choices.includes(setting.default_value)) badSetting("its default_value isn't one of its choices.", "Give one of the choices.");
    } else if (setting.choices !== null) badSetting(`it's a ${setting.value_kind} with choices.`, "Give null: only a choice has choices.");
    if (setting.value_kind === "text") {
      if (!Number.isInteger(setting.maximum_character_count) || setting.maximum_character_count < 1 || setting.maximum_character_count > PIECE_LIMITS.maximumTextCharacterCount) badSetting(`its maximum_character_count isn't a whole number from 1 to ${PIECE_LIMITS.maximumTextCharacterCount}.`, "Say how long the text may be.");
      if (typeof setting.default_value !== "string" || setting.default_value.length > setting.maximum_character_count) badSetting("its default_value isn't text within its maximum_character_count.", "Give text that fits.");
    } else if (setting.maximum_character_count !== null) badSetting(`it's a ${setting.value_kind} with a maximum_character_count.`, "Give null: only text has a length.");
  }
  for (const [field, entries] of [["settings", statement.settings], ["hooks", statement.hooks]]) {
    if (!Array.isArray(entries)) continue;
    // Two names that read the same in a JavaScript piece (jump_2x and jump2x) would be one there.
    const names = entries.map((entry) => (isPlainObject(entry) && typeof entry.name === "string" ? camelName(entry.name) : entry));
    if (new Set(names).size !== names.length) bad(field, `it has two ${field} of the same name.`, `Name each of its ${field} once.`);
  }
  if (!Array.isArray(statement.hooks) || statement.hooks.length > PIECE_LIMITS.maximumHookCount) bad("hooks", `its hooks isn't a list of at most ${PIECE_LIMITS.maximumHookCount}.`, "Give a list, empty when the piece has no hooks.");
  for (const hook of statement.hooks) {
    if (!isPlainObject(hook)) bad("hooks", "one of its hooks isn't an object.", `Each hook is { ${HOOK_FIELDS.join(", ")} }.`);
    for (const field of Object.keys(hook)) if (!HOOK_FIELDS.includes(field)) bad("hooks", `a hook has an unknown field "${field}".`, `A hook holds only: ${HOOK_FIELDS.join(", ")}.`);
    if (!isStatedName(hook.name)) bad("hooks", `a hook's name "${hook.name}" isn't a name.`, 'Name it in lowercase with underscores, like "before_jump" or "landed".');
    if (!HOOK_KINDS.includes(hook.hook_kind)) bad("hooks", `the hook ${hook.name} has hook_kind "${hook.hook_kind}".`, `Use one of: ${HOOK_KINDS.join(", ")}.`);
    if (!isSummary(hook.summary)) bad("hooks", `the hook ${hook.name} has a summary that's missing or over ${PIECE_LIMITS.maximumSummaryCharacterCount} characters.`, "Say in a sentence when it's called and what the game can do there.");
  }
  return statement;
}

/** Whether a piece.json.js is its piece.json as a module, whatever line endings a checkout gave it. */
const isStatementModule = (moduleBytes, statementText) => moduleBytes.toString("utf8").replace(/\r\n/g, "\n") === statementModuleText(statementText);

/** piece.json as a module (piece.json.js), so a piece's own code reads the one statement and never a second copy of it. */
export function statementModuleText(statementText) {
  return `// This piece's statement, piece.json, as a module for its own code to read. "zaisma pieces check --fix" writes it: never edit it.\nexport default ${JSON.stringify(JSON.parse(statementText), null, 2)};\n`;
}

// ---- What adding a piece brings ----

/**
 * One thing a game can hold in its pieces folder, as the rest of this file passes it round: a piece (with its
 * statement) or a library that isn't a piece (kind "library", no statement). files is { path: bytes } when its
 * files were read, and its game server's files are among them under the same paths.
 */
function unitOf({ statement = null, library = null, files = null, sourceKind, source = null }) {
  if (statement) return { name: statement.name, version: statement.piece_version, kind: statement.kind, needs: statement.needs, statement, library: null, files, sourceKind, source };
  return { name: library.name, version: library.library_version, kind: "library", needs: [], statement: null, library, files, sourceKind, source };
}

const isNeedBrought = (need) => need.kind !== "engine";
const named = (unit) => `${unit.name} ${unit.version}`;

/**
 * Works out what adding a piece does to a game, and writes nothing.
 *
 * piece is the unit being added. had is what the game has, by name ({ name: unit }). gameLibraries is what the
 * game's own package.json brings ({ three: "0.170.0" }). find(name, needKind, ranges) looks a need up at its
 * source and answers the newest unit every range accepts, or null.
 *
 * Answers { added: [units, each after what it needs, the piece itself last], keptNames: [names left as they
 * are], engineNeeds: [{ name, version_range, needed_by_name }] }. Throws piece_already_added,
 * piece_version_clash or piece_need_unmet.
 */
export async function planAdd({ piece, had = {}, gameLibraries = {}, find }) {
  if (had[piece.name]) {
    if (had[piece.name].version === piece.version) return { added: [], keptNames: [piece.name], engineNeeds: [] };
    refuse("piece_already_added", { message: `The game already has ${named(had[piece.name])}, and this is ${piece.version}.`, field: "source", fix: `A piece moves to another version only on your word: zaisma pieces update ${piece.name}.` });
  }
  const clash = (need, neededBy, holderLine, waysOut) => refuse("piece_version_clash", { message: `${named(neededBy)} needs ${need.name} ${need.version_range}, and ${holderLine}.`, field: need.name, fix: `Nothing was changed. ${waysOut}` });
  // Every range met for a name, over every pass: a pass that finds a version one of them refuses starts again with all of them known.
  const knownRanges = new Map();
  const found = new Map();
  for (;;) {
    const added = new Map();
    const order = [];
    const keptNames = new Set();
    const engineNeeds = [];
    let isStartingAgain = false;
    const visit = async (unit) => {
      for (const need of unit.needs) {
        if (isStartingAgain) return;
        if (!isNeedBrought(need)) {
          engineNeeds.push({ name: need.name, version_range: need.version_range, needed_by_name: unit.name });
          continue;
        }
        const ranges = knownRanges.get(need.name) ?? knownRanges.set(need.name, []).get(need.name);
        const isRangeNew = !ranges.some((known) => known.need.version_range === need.version_range);
        if (isRangeNew) ranges.push({ need, neededBy: unit });
        if (need.name === piece.name) {
          if (!satisfies(piece.version, need.version_range)) clash(need, unit, `this is ${named(piece)}`, `Add a version of ${piece.name} that ${unit.name} accepts, or a version of ${unit.name} that accepts ${named(piece)}.`);
          continue;
        }
        const existing = had[need.name];
        if (existing) {
          const isLibraryNeed = need.kind === "library";
          if ((existing.kind === "library") !== isLibraryNeed) refuse("piece_need_unmet", { message: `${named(unit)} needs ${need.name} as a ${need.kind}, and the game has ${named(existing)} as a ${existing.kind === "library" ? "library" : "piece"}.`, field: need.name, fix: `Nothing was changed. Tell ${unit.name}'s maker: a need's kind says whether it's a piece or a library.` });
          if (!satisfies(existing.version, need.version_range)) clash(need, unit, `the game has ${named(existing)}`, `Two ways out: move the game's ${need.name} to a version both accept (zaisma pieces update ${need.name} --version "${need.version_range}"), or use a version of ${unit.name} that accepts ${named(existing)}.`);
          keptNames.add(need.name);
          continue;
        }
        if (need.kind === "library" && gameLibraries[need.name] !== undefined) {
          // The game brings this library itself (its package.json): it's used as it is, or it's a clash.
          if (!satisfies(gameLibraries[need.name], need.version_range)) clash(need, unit, `the game's own package.json has ${need.name} ${gameLibraries[need.name]}`, `Two ways out: move ${need.name} in the game's package.json to a version within ${need.version_range}, or use a version of ${unit.name} that accepts ${need.name} ${gameLibraries[need.name]}.`);
          keptNames.add(need.name);
          continue;
        }
        const coming = added.get(need.name);
        if (coming) {
          if (satisfies(coming.version, need.version_range)) continue;
          // Chosen before this range was known: start again, choosing with it.
          isStartingAgain = true;
          return;
        }
        const everyRange = ranges.map((known) => known.need.version_range);
        const findKey = `${need.name}\n${everyRange.join("\n")}`;
        if (!found.has(findKey)) found.set(findKey, await find(need.name, need.kind, everyRange));
        const chosen = found.get(findKey);
        if (!chosen) {
          const other = ranges.find((known) => known.need.version_range !== need.version_range);
          if (other) clash(need, unit, `${named(other.neededBy)} needs ${need.name} ${other.need.version_range}: no version of ${need.name} fits both`, `Use a version of ${unit.name} or of ${other.neededBy.name} whose needs overlap, or tell their makers.`);
          refuse("piece_need_unmet", { message: `${named(unit)} needs ${need.name} ${need.version_range}, and none was found.`, field: need.name, fix: `Nothing was changed. Add ${need.name} first from where it's published (zaisma pieces add <its folder or .tgz>), then run this again.` });
        }
        if (chosen.kind === "template") refuse("piece_need_unmet", { message: `${named(unit)} needs ${need.name}, which is a template.`, field: need.name, fix: `Nothing was changed. A template is copied into a game once and is never needed by a piece: tell ${unit.name}'s maker.` });
        if ((chosen.kind === "library") !== (need.kind === "library")) refuse("piece_need_unmet", { message: `${named(unit)} needs ${need.name} as a ${need.kind}, and what was found is a ${chosen.kind === "library" ? "library" : "piece"}.`, field: need.name, fix: `Nothing was changed. Tell ${unit.name}'s maker: a need's kind says whether it's a piece or a library.` });
        added.set(need.name, chosen);
        await visit(chosen);
        if (isStartingAgain) return;
        order.push(chosen);
      }
    };
    await visit(piece);
    if (!isStartingAgain) return { added: [...order, piece], keptNames: [...keptNames], engineNeeds };
  }
}

/** The pieces in a game that need one of its names, each with the range it accepts. A template is the game's own code once copied, so it holds nothing. */
export function needersOf(name, had) {
  const needers = [];
  for (const holder of Object.values(had)) {
    if (holder.kind === "template" || holder.name === name) continue;
    const need = holder.needs.find((entry) => entry.name === name && isNeedBrought(entry));
    if (need) needers.push({ holder, need });
  }
  return needers;
}

/** Whether the pieces a game has would accept another version of one of them: throws piece_version_clash naming the first that wouldn't. */
export function checkUpdateFits({ name, nextVersion, had }) {
  for (const { holder, need } of needersOf(name, had)) {
    if (satisfies(nextVersion, need.version_range)) continue;
    refuse("piece_version_clash", {
      message: `${named(holder)} needs ${name} ${need.version_range}, and this would move ${name} to ${nextVersion}.`,
      field: name,
      fix: `Nothing was changed. Two ways out: update ${holder.name} first to a version that accepts ${name} ${nextVersion}, or pick a version of ${name} within ${need.version_range} (--version "${need.version_range}").`,
    });
  }
}

// ---- Reading a piece from where it is ----

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A text file's bytes with every line ending as "\n", so a checkout that turns them into "\r\n" (Git on Windows) isn't an edit. A file with a zero byte isn't text. */
const withPlainLineEndings = (bytes) => (bytes.includes(0) || !bytes.includes(13) ? bytes : Buffer.from(Buffer.from(bytes).toString("latin1").replace(/\r\n/g, "\n"), "latin1"));

/** One hash for a set of files: any file changed, added or removed changes it. files is { path: bytes }. */
export function filesHash(files) {
  const lines = Object.keys(files).sort().map((path) => `${path}\0${sha256Hex(withPlainLineEndings(files[path]))}`);
  return sha256Hex(lines.join("\n"));
}

/** The files of a .tar's bytes, by path. Only plain files (a link is left out); a path that would leave the folder is refused. */
export function readTar(bytes) {
  const files = {};
  const untrusted = (message) => refuse("bad_piece_source", { message, field: "source", fix: "Don't use this archive. A piece's files all sit inside its own folder." });
  let headerStartBytes = 0;
  let longName = null;
  let fileCount = 0;
  while (headerStartBytes + 512 <= bytes.length) {
    const header = bytes.subarray(headerStartBytes, headerStartBytes + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, fieldSizeBytes) => {
      const end = header.indexOf(0, start);
      return Buffer.from(header.subarray(start, end === -1 || end > start + fieldSizeBytes ? start + fieldSizeBytes : end)).toString("utf8");
    };
    const sizeBytes = parseInt(text(124, 12).trim() || "0", 8);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0 || headerStartBytes + 512 + sizeBytes > bytes.length) untrusted("The archive is cut short or damaged.");
    const entryKind = String.fromCharCode(header[156] || 48);
    const prefix = text(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    const body = bytes.subarray(headerStartBytes + 512, headerStartBytes + 512 + sizeBytes);
    longName = null;
    if (entryKind === "L") longName = Buffer.from(body).toString("utf8").replace(/\0+$/, "");
    else if (entryKind === "x") {
      // A pax header: lines of "<length> key=value\n"; path names the next entry when its name is too long for the header.
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(Buffer.from(body).toString("utf8"));
      if (path) longName = path[1];
    } else if (entryKind === "0" || entryKind === "\0") {
      // Only a path that would leave the archive's folder is refused here; a hidden file is npm's own business until a piece lists it.
      if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\\") || name.split("/").includes("..")) untrusted(`The archive holds a file outside itself: "${name}".`);
      if (++fileCount > PIECE_LIMITS.maximumFileCount * 2) untrusted(`The archive holds more than ${PIECE_LIMITS.maximumFileCount * 2} files.`);
      files[name] = Buffer.from(body);
    }
    headerStartBytes += 512 + Math.ceil(sizeBytes / 512) * 512;
  }
  return files;
}

/** A read piece as a unit: its statement and the files it lists. allFiles is everything found beside its piece.json, by path. */
function pieceFrom(allFiles, sourceKind, source, whereFrom) {
  const statementBytes = allFiles[STATEMENT_PATH];
  if (!statementBytes) refuse("bad_piece_source", { message: `${whereFrom} has no ${STATEMENT_PATH}, so it isn't a piece.`, field: "source", fix: `Give a piece's folder, its .tgz, or its name on npm. A piece has a ${STATEMENT_PATH} at its top (docs/PIECES.md).` });
  if (statementBytes.length > PIECE_LIMITS.maximumStatementSizeBytes) refuse("bad_piece_statement", { message: `${whereFrom}'s ${STATEMENT_PATH} is over ${PIECE_LIMITS.maximumStatementSizeBytes} bytes.`, field: null, fix: "A statement says what a piece is and needs; anything longer belongs in its README." });
  const statementText = statementBytes.toString("utf8");
  const statement = readStatement(statementText, `${whereFrom}'s ${STATEMENT_PATH}`);
  const bad = (field, message, fix) => refuse("bad_piece_statement", { message: `${whereFrom}: ${message}`, field, fix });
  const files = { [STATEMENT_PATH]: statementBytes };
  for (const path of new Set([...statement.file_paths, ...statement.server_file_paths])) {
    if (!allFiles[path]) bad(statement.file_paths.includes(path) ? "file_paths" : "server_file_paths", `its ${STATEMENT_PATH} lists ${path}, which isn't there.`, "List only files the piece holds.");
    files[path] = allFiles[path];
  }
  if (files[STATEMENT_MODULE_PATH] && !isStatementModule(files[STATEMENT_MODULE_PATH], statementText)) bad(null, `its ${STATEMENT_MODULE_PATH} isn't its ${STATEMENT_PATH}, so its code would read another statement than the one it gives.`, `Its maker runs: zaisma pieces check <the piece's folder> --fix.`);
  // A piece published on npm is found there by its package's name and version, so the two can't differ.
  if (allFiles["package.json"]) {
    let packageJson = null;
    try {
      packageJson = JSON.parse(allFiles["package.json"].toString("utf8"));
    } catch {
      // Falls through to the refusal.
    }
    if (packageJson?.name !== statement.name) bad("name", `its ${STATEMENT_PATH} says ${statement.name}, and its package.json says ${packageJson?.name}.`, "Give both the same name.");
    if (packageJson?.version !== statement.piece_version) bad("piece_version", `its ${STATEMENT_PATH} says ${statement.piece_version}, and its package.json says ${packageJson?.version}.`, "Give both the same version.");
  }
  return unitOf({ statement, files, sourceKind, source });
}

/** The files asked for in a folder, by path; a missing one is left out, and a link is refused. */
async function readListedFiles(folder, paths) {
  const files = {};
  for (const path of paths) {
    const full = join(folder, ...path.split("/"));
    const found = await lstat(full).catch(() => null);
    if (found?.isSymbolicLink()) refuse("bad_piece_source", { message: `${full} is a link to another file.`, field: "source", fix: "Put the file itself in the piece: a link could point anywhere on this computer." });
    if (found?.isFile()) files[path] = await readFile(full);
  }
  return files;
}

async function readPieceFolder(folder) {
  const statementBytes = (await readListedFiles(folder, [STATEMENT_PATH]))[STATEMENT_PATH];
  if (!statementBytes) refuse("bad_piece_source", { message: `${folder} has no ${STATEMENT_PATH}, so it isn't a piece.`, field: "source", fix: `Give a piece's folder, its .tgz, or its name on npm. A piece has a ${STATEMENT_PATH} at its top (docs/PIECES.md).` });
  const statement = readStatement(statementBytes.toString("utf8"), `${folder}'s ${STATEMENT_PATH}`);
  const files = await readListedFiles(folder, [STATEMENT_PATH, "package.json", ...statement.file_paths, ...statement.server_file_paths]);
  return pieceFrom(files, "folder", resolve(folder), folder);
}

/** Every file in a .tgz, by path. npm packs a package's files under "package/". */
function readTarball(tarballBytes, whereFrom) {
  if (tarballBytes.length > PIECE_LIMITS.maximumArchiveSizeBytes) refuse("bad_piece_source", { message: `${whereFrom} is over ${PIECE_LIMITS.maximumArchiveSizeBytes / 1_000_000} MB.`, field: "source", fix: "A piece that big isn't one this command adds." });
  let tar;
  try {
    tar = gunzipSync(tarballBytes, { maxOutputLength: PIECE_LIMITS.maximumUnpackedSizeBytes });
  } catch {
    refuse("bad_piece_source", { message: `${whereFrom} isn't a .tgz archive, or unpacks to over ${PIECE_LIMITS.maximumUnpackedSizeBytes / 1_000_000} MB.`, field: "source", fix: "Give a piece's folder, the .tgz that npm pack makes of it, or its name on npm." });
  }
  const packed = readTar(tar);
  const top = Object.keys(packed).every((path) => path.startsWith("package/")) ? "package/" : "";
  return Object.fromEntries(Object.entries(packed).map(([path, bytes]) => [path.slice(top.length), bytes]));
}

async function fetchBytes(url, accept) {
  let response;
  try {
    response = await fetch(url, { headers: accept ? { accept } : {}, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    response = null;
  }
  if (response?.status === 404) return null;
  if (!response?.ok) refuse("piece_source_unreachable", { message: `${url} couldn't be reached.`, field: "source", fix: "Check the connection and run it again; nothing was changed." });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * npm, as one command run reads it: each name's versions are asked for once. versionsOf(name) answers
 * { version: { tarballUrl, integrity } }, or null when npm has no such name; archiveOf(name, ranges) the files of
 * the newest version every range accepts, or null.
 */
function npmReader() {
  // The developer's own registry when npm is set to one, as the command's check for a newer version of itself reads it.
  const registryUrl = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");
  const asked = new Map();
  const versionsOf = (name) => {
    if (!asked.has(name)) {
      asked.set(
        name,
        fetchBytes(`${registryUrl}/${name.replace("/", "%2F")}`, "application/vnd.npm.install-v1+json").then((bytes) => {
          if (!bytes) return null;
          const packument = JSON.parse(bytes.toString("utf8"));
          return Object.fromEntries(Object.entries(packument.versions ?? {}).map(([version, entry]) => [version, { tarballUrl: entry.dist.tarball, integrity: entry.dist.integrity ?? null }]));
        }),
      );
    }
    return asked.get(name);
  };
  const archiveOf = async (name, ranges) => {
    const versions = await versionsOf(name);
    const version = versions && newestSatisfying(Object.keys(versions).filter(parseVersion), ranges);
    if (!version) return null;
    const tarballBytes = await fetchBytes(versions[version].tarballUrl);
    if (!tarballBytes) return null;
    const integrity = versions[version].integrity;
    // npm's own hash of the archive: what was published is what's unpacked.
    if (integrity?.startsWith("sha512-") && createHash("sha512").update(tarballBytes).digest("base64") !== integrity.slice(7)) {
      refuse("bad_piece_source", { message: `${name} ${version}'s archive isn't the one npm lists: its hash differs.`, field: "source", fix: "Nothing was changed. Run it again; if it keeps happening, don't use this version." });
    }
    return { version, allFiles: readTarball(tarballBytes, `${name} ${version} on npm`), whereFrom: `${name} ${version} on npm` };
  };
  return { versionsOf, archiveOf };
}

/** The file of a package that a browser imports, by its package.json. */
function browserEntryOf(packageJson) {
  const dotExport = packageJson.exports?.["."] ?? packageJson.exports;
  const entry = [typeof dotExport === "string" ? dotExport : (dotExport?.import?.default ?? dotExport?.import ?? dotExport?.default), packageJson.module, packageJson.main].find((path) => typeof path === "string");
  return entry?.replace(/^\.\//, "") ?? null;
}

/** The files a module reaches by relative imports, from readFileAt(path) → bytes or null. Answers { path: bytes }. */
async function reachedFiles(entryPath, readFileAt) {
  const files = {};
  const waiting = [entryPath];
  while (waiting.length) {
    const path = waiting.pop();
    if (files[path] || !isSafePath(path)) continue;
    const bytes = await readFileAt(path);
    if (!bytes) continue;
    files[path] = bytes;
    if (!/\.m?js$/.test(path)) continue;
    for (const match of bytes.toString("utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const parts = [];
      for (const part of [...path.split("/").slice(0, -1), ...match[1].split("/")]) part === ".." ? parts.pop() : part !== "." && parts.push(part);
      waiting.push(parts.join("/"));
    }
  }
  return files;
}

/**
 * A library that isn't a piece (three.js), from its package's files: the file a browser imports and the files
 * that one reaches, with its licence file. Answers a unit of kind "library".
 */
async function libraryFrom(readFileAt, name, sourceKind) {
  const packageJson = await Promise.resolve(readFileAt("package.json")).then((bytes) => JSON.parse(bytes.toString("utf8"))).catch(() => ({}));
  const entryPath = parseVersion(packageJson.version) ? browserEntryOf(packageJson) : null;
  const files = entryPath ? await reachedFiles(entryPath, readFileAt) : {};
  if (!entryPath || !files[entryPath]) refuse("piece_need_unmet", { message: `${name} ${packageJson.version} has no file a browser can import.`, field: name, fix: `Add ${name} to the game yourself, with a bundler or an import map, then run this again.` });
  // A game holds no file without an extension, so a licence travels as LICENSE.txt.
  for (const path of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "license", "license.md", "license.txt"]) {
    const bytes = await readFileAt(path);
    if (bytes) files[path.includes(".") ? path : `${path}.txt`] = bytes;
  }
  const license = typeof packageJson.license === "string" && packageJson.license.length <= 100 ? packageJson.license : null;
  const library = { name, library_version: packageJson.version, summary: String(packageJson.description ?? "").slice(0, PIECE_LIMITS.maximumSummaryCharacterCount), license, entry_path: entryPath, file_paths: Object.keys(files).sort() };
  return unitOf({ library, files, sourceKind, source: `${name}@${packageJson.version}` });
}

/** A library already installed beside a piece's folder (a node_modules above it), when every range accepts its version. */
async function readInstalledLibrary(name, ranges, fromFolder) {
  for (let folder = fromFolder; ; folder = dirname(folder)) {
    const libraryFolder = join(folder, "node_modules", ...name.split("/"));
    const packageJson = await readFile(join(libraryFolder, "package.json"), "utf8").then(JSON.parse).catch(() => null);
    if (packageJson && ranges.every((rangeText) => satisfies(packageJson.version, rangeText))) return libraryFrom((path) => readFile(join(libraryFolder, ...path.split("/"))).catch(() => null), name, "folder");
    if (dirname(folder) === folder) return null;
  }
}

/** What a source names: a folder, a .tgz file, or a name on npm with an optional range ("@studio/dash-move@^1.2"). Answers the piece as a unit. */
export async function readSource(source, { baseFolder = process.cwd(), npm = npmReader() } = {}) {
  const path = isAbsolute(source) ? source : resolve(baseFolder, source);
  const found = await stat(path).catch(() => null);
  if (found?.isDirectory()) return readPieceFolder(path);
  if (found?.isFile()) return pieceFrom(readTarball(await readFile(path), source), "tarball", path, source);
  const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@(.+))?$/.exec(source);
  if (!match || source.startsWith(".") || source.includes("//") || source.includes("\\")) refuse("piece_not_found", { message: `There's no folder or file at ${source}, and it isn't a name on npm.`, field: "source", fix: "Give a piece's folder, its .tgz, or its name on npm, like @studio/dash-move." });
  if (match[2] !== undefined && !parseRange(match[2])) refuse("bad_piece_source", { message: `"${match[2]}" isn't a version or a range.`, field: "source", fix: "Give a name alone for the newest, or with a range, like @studio/dash-move@^1.2." });
  const archive = await npm.archiveOf(match[1], [match[2] ?? "*"]);
  if (!archive) refuse("piece_not_found", { message: `npm has no ${match[1]}${match[2] ? ` at ${match[2]}` : ""}.`, field: "source", fix: "Check the name and the version. A piece that isn't on npm is added from its folder or its .tgz." });
  return pieceFrom(archive.allFiles, "npm", `${match[1]}@${archive.version}`, archive.whereFrom);
}

/** Looks a piece's needs up where the piece itself came from: beside its folder, else on npm. */
function needFinder(piece, npm) {
  return async (name, needKind, ranges) => {
    const isFolder = piece.sourceKind === "folder";
    if (needKind === "library") {
      const installed = isFolder ? await readInstalledLibrary(name, ranges, dirname(piece.source)) : null;
      if (installed) return installed;
      const archive = await npm.archiveOf(name, ranges);
      return archive ? libraryFrom(async (path) => archive.allFiles[path] ?? null, name, "npm") : null;
    }
    if (isFolder) {
      // A piece's neighbours: its own folder's siblings, and theirs when it sits in a scope's folder.
      for (const parent of new Set([dirname(piece.source), dirname(dirname(piece.source))])) {
        for (const entry of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
          if (!entry.isDirectory() || entry.name === "node_modules") continue;
          for (const folder of entry.name.startsWith("@") ? (await readdir(join(parent, entry.name), { withFileTypes: true }).catch(() => [])).filter((inner) => inner.isDirectory()).map((inner) => join(parent, entry.name, inner.name)) : [join(parent, entry.name)]) {
            const beside = await readFile(join(folder, STATEMENT_PATH), "utf8").then(JSON.parse).catch(() => null);
            if (beside?.name === name && ranges.every((rangeText) => satisfies(beside.piece_version, rangeText))) return readPieceFolder(folder);
          }
        }
      }
    }
    const archive = await npm.archiveOf(name, ranges);
    return archive ? pieceFrom(archive.allFiles, "npm", `${name}@${archive.version}`, archive.whereFrom) : null;
  };
}

// ---- A game's pieces ----

const emptyRecord = () => ({ about: "This game's pieces, kept by `zaisma pieces`: don't edit it by hand. docs/PIECES.md says what a piece is.", record_version_number: RECORD_VERSION_NUMBER, pieces: [], libraries: [] });
const LIBRARY_FIELDS = ["name", "library_version", "summary", "license", "entry_path", "file_paths", "source_kind", "files_sha256"];

/**
 * The game's record of its pieces; an empty one when it has none yet. Throws bad_pieces_record when it can't be
 * read, and pieces_record_newer when a newer command wrote it.
 */
export async function readRecord(gameFolder) {
  const text = await readFile(join(gameFolder, ...RECORD_PATH.split("/")), "utf8").catch(() => null);
  if (text === null) return emptyRecord();
  const bad = () => refuse("bad_pieces_record", { message: `${RECORD_PATH} can't be read.`, field: null, fix: `Bring ${RECORD_PATH} back from your version control: it's the game's record of its pieces, and only the command changes it.` });
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    bad();
  }
  if (!isPlainObject(record) || !Number.isInteger(record.record_version_number)) bad();
  if (record.record_version_number > RECORD_VERSION_NUMBER) refuse("pieces_record_newer", { message: `${RECORD_PATH} is written in format ${record.record_version_number}, and this command reads up to ${RECORD_VERSION_NUMBER}.`, field: null, fix: `Run the newest command: ${NEWEST_COMMAND} pieces.` });
  if (!Array.isArray(record.pieces) || !Array.isArray(record.libraries)) bad();
  for (const entry of record.pieces) {
    const isHashRight = isPlainObject(entry) && (entry.files_sha256 === null ? entry.statement?.kind === "template" : /^[0-9a-f]{64}$/.test(entry.files_sha256));
    if (!isHashRight || !SOURCE_KINDS.includes(entry.source_kind)) bad();
    try {
      readStatement(JSON.stringify(entry.statement), RECORD_PATH);
    } catch (error) {
      if (error instanceof PiecesError && error.error.code === "piece_statement_newer") throw error;
      bad();
    }
  }
  for (const entry of record.libraries) {
    const isRight = isPlainObject(entry) && LIBRARY_FIELDS.every((field) => field in entry) && typeof entry.name === "string" && NAME_PATTERN.test(entry.name) && parseVersion(entry.library_version) && isSafePath(entry.entry_path) && Array.isArray(entry.file_paths) && entry.file_paths.every(isSafePath) && SOURCE_KINDS.includes(entry.source_kind) && /^[0-9a-f]{64}$/.test(entry.files_sha256);
    if (!isRight) bad();
  }
  const names = [...record.pieces.map((entry) => entry.statement.name), ...record.libraries.map((entry) => entry.name)];
  if (new Set(names).size !== names.length) bad();
  return record;
}

/** What a game has, by name, as units without their files; each unit's recorded is its entry in the record. */
function hadOf(record) {
  const had = {};
  for (const entry of record.pieces) had[entry.statement.name] = { ...unitOf({ statement: entry.statement, sourceKind: entry.source_kind }), recorded: entry };
  for (const entry of record.libraries) had[entry.name] = { ...unitOf({ library: entry, sourceKind: entry.source_kind }), recorded: entry };
  return had;
}

/**
 * Where a unit's files sit in a game: [{ path (in the game's folder), filePath (in the piece), hashKey }]. A
 * template's go in the game's own folder; anything else's in pieces/<name>/, its game server's in zaisma-server/pieces/<name>/.
 */
export function placesOf(unit) {
  if (unit.kind === "library") return unit.library.file_paths.map((filePath) => ({ path: `${PIECES_FOLDER}/${unit.name}/${filePath}`, filePath, hashKey: filePath }));
  if (unit.kind === "template") return unit.statement.file_paths.map((filePath) => ({ path: filePath, filePath, hashKey: filePath }));
  return [
    { path: `${PIECES_FOLDER}/${unit.name}/${STATEMENT_PATH}`, filePath: STATEMENT_PATH, hashKey: STATEMENT_PATH },
    ...unit.statement.file_paths.map((filePath) => ({ path: `${PIECES_FOLDER}/${unit.name}/${filePath}`, filePath, hashKey: filePath })),
    ...unit.statement.server_file_paths.map((filePath) => ({ path: `${SERVER_PIECES_FOLDER}/${unit.name}/${filePath}`, filePath, hashKey: `server:${filePath}` })),
  ];
}

/** The folders that hold only one unit's files in a game: replaced whole when it moves to another version, removed with it. */
const foldersOf = (unit) => (unit.kind === "template" ? [] : [`${PIECES_FOLDER}/${unit.name}`, ...(unit.kind !== "library" && unit.statement.server_file_paths.length ? [`${SERVER_PIECES_FOLDER}/${unit.name}`] : [])]);

/** The hash of a unit's files as it was read from its source. */
const sourceHash = (unit) => filesHash(Object.fromEntries(placesOf(unit).map((place) => [place.hashKey, unit.files[place.filePath]])));

/** Whether a unit's files in the game are still the ones that were added. A template's are the game's own, so never. */
async function isEdited(gameFolder, unit) {
  if (unit.recorded.files_sha256 === null) return false;
  const files = {};
  for (const place of placesOf(unit)) {
    const bytes = await readFile(join(gameFolder, ...place.path.split("/"))).catch(() => null);
    if (bytes) files[place.hashKey] = bytes;
  }
  return filesHash(files) !== unit.recorded.files_sha256;
}

async function writeUnit(gameFolder, unit) {
  for (const folder of [`${PIECES_FOLDER}/${unit.name}`, `${SERVER_PIECES_FOLDER}/${unit.name}`]) if (unit.kind !== "template") await rm(join(gameFolder, ...folder.split("/")), { recursive: true, force: true });
  for (const place of placesOf(unit)) {
    const target = join(gameFolder, ...place.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, unit.files[place.filePath]);
  }
}

/** A unit read from its source, as the record keeps it. */
function recordedOf(unit) {
  // A template is copied once and then the game's own: its files are never checked again.
  if (unit.kind !== "library") return { statement: unit.statement, source_kind: unit.sourceKind, files_sha256: unit.kind === "template" ? null : sourceHash(unit) };
  return { ...unit.library, source_kind: unit.sourceKind, files_sha256: sourceHash(unit) };
}

function putInRecord(record, unit) {
  const list = unit.kind === "library" ? record.libraries : record.pieces;
  const nameOf = (entry) => (unit.kind === "library" ? entry.name : entry.statement.name);
  const kept = list.filter((entry) => nameOf(entry) !== unit.name);
  list.splice(0, list.length, ...[...kept, recordedOf(unit)].sort((first, second) => (nameOf(first) < nameOf(second) ? -1 : 1)));
}

function takeFromRecord(record, name) {
  record.pieces = record.pieces.filter((entry) => entry.statement.name !== name);
  record.libraries = record.libraries.filter((entry) => entry.name !== name);
}

async function writeRecord(gameFolder, record) {
  const target = join(gameFolder, ...RECORD_PATH.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(record, null, 2) + "\n");
}

/** The libraries a game brings itself: what's installed in its node_modules, else the lowest version its package.json asks for. */
async function gameLibrariesOf(gameFolder, names) {
  const libraries = {};
  const packageJson = await readFile(join(gameFolder, "package.json"), "utf8").then(JSON.parse).catch(() => null);
  if (!packageJson) return libraries;
  for (const name of names) {
    const asked = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
    if (asked === undefined) continue;
    const installed = await readFile(join(gameFolder, "node_modules", ...name.split("/"), "package.json"), "utf8").then(JSON.parse).catch(() => null);
    const lowest = /\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/.exec(String(asked))?.[0];
    if (installed?.version ?? lowest) libraries[name] = installed?.version ?? lowest;
  }
  return libraries;
}

/** A game's own libraries, looked up as needs for them come up. */
function gameLibrariesReader(gameFolder) {
  const gameLibraries = {};
  const lookedUp = new Set();
  const note = async (unit) => {
    const names = unit.needs.filter((need) => need.kind === "library" && !lookedUp.has(need.name)).map((need) => need.name);
    names.forEach((name) => lookedUp.add(name));
    Object.assign(gameLibraries, await gameLibrariesOf(gameFolder, names));
  };
  return { gameLibraries, note };
}

/** What a game's page needs to import its pieces without a bundler: the import map entries for libraries brought into pieces/. */
export function importMapOf(record) {
  return { imports: Object.fromEntries(record.libraries.map((entry) => [entry.name, `./${PIECES_FOLDER}/${entry.name}/${entry.entry_path}`])) };
}

/** The standards a game's pieces are built on. */
const standardsOf = (record) => [...new Set(record.pieces.map((entry) => entry.statement.standard))].sort();

/** One piece as the command answers it: its statement, and where a game imports it from. */
function shownPiece(entry, isPieceEdited) {
  const { statement } = entry;
  const isTemplate = statement.kind === "template";
  return {
    name: statement.name,
    piece_version: statement.piece_version,
    kind: statement.kind,
    standard: statement.standard,
    summary: statement.summary,
    license: statement.license,
    source_kind: entry.source_kind,
    import_path: isTemplate || statement.entry_path === null ? null : `./${PIECES_FOLDER}/${statement.name}/${statement.entry_path}`,
    server_import_path: isTemplate || statement.server_entry_path === null ? null : `./${PIECES_FOLDER}/${statement.name}/${statement.server_entry_path}`,
    needs: statement.needs,
    settings: statement.settings,
    hooks: statement.hooks,
    is_edited: isPieceEdited,
  };
}

/** One library as the command answers it. */
function shownLibrary(entry, isLibraryEdited) {
  return { name: entry.name, library_version: entry.library_version, summary: entry.summary, license: entry.license, source_kind: entry.source_kind, import_path: `./${PIECES_FOLDER}/${entry.name}/${entry.entry_path}`, is_edited: isLibraryEdited };
}

const shownUnits = (units) => ({
  pieces: units.filter((unit) => unit.kind !== "library").map((unit) => shownPiece(recordedOf(unit), false)),
  libraries: units.filter((unit) => unit.kind === "library").map((unit) => shownLibrary(recordedOf(unit), false)),
});

/** zaisma pieces: what the game has. */
export async function listPieces(gameFolder) {
  const record = await readRecord(gameFolder);
  const had = hadOf(record);
  const pieces = [];
  for (const entry of record.pieces) pieces.push(shownPiece(entry, await isEdited(gameFolder, had[entry.statement.name])));
  const libraries = [];
  for (const entry of record.libraries) libraries.push(shownLibrary(entry, await isEdited(gameFolder, had[entry.name])));
  return { pieces, libraries, standards: standardsOf(record), import_map: importMapOf(record) };
}

/** Writes a plan's units into the game and its record, after checking a template writes over nothing. */
async function carryOut(gameFolder, record, added, isDryRun) {
  for (const unit of added.filter((entry) => entry.kind === "template")) {
    for (const place of placesOf(unit)) {
      if (await lstat(join(gameFolder, ...place.path.split("/"))).catch(() => null)) refuse("template_file_exists", { message: `${unit.name} would write ${place.path}, which the game already has.`, field: place.path, fix: "Nothing was changed. A template starts a game: add it to an empty folder, or move that file away first." });
    }
  }
  const standardsBefore = standardsOf(record);
  for (const unit of added) {
    if (!isDryRun) await writeUnit(gameFolder, unit);
    putInRecord(record, unit);
  }
  if (!isDryRun && added.length) await writeRecord(gameFolder, record);
  return standardsOf(record).filter((standard) => !standardsBefore.includes(standard));
}

/**
 * zaisma pieces add: adds a piece and what it needs, or changes nothing. With isDryRun it answers what adding
 * would do and writes nothing.
 */
export async function addPiece(gameFolder, source, { isDryRun = false } = {}) {
  const npm = npmReader();
  const piece = await readSource(source, { npm });
  const record = await readRecord(gameFolder);
  const find = needFinder(piece, npm);
  const libraries = gameLibrariesReader(gameFolder);
  await libraries.note(piece);
  const plan = await planAdd({
    piece,
    had: hadOf(record),
    gameLibraries: libraries.gameLibraries,
    find: async (name, needKind, ranges) => {
      const found = await find(name, needKind, ranges);
      if (found) await libraries.note(found);
      return found;
    },
  });
  const newStandards = await carryOut(gameFolder, record, plan.added, isDryRun);
  const shown = shownUnits(plan.added);
  return { is_dry_run: isDryRun, added_pieces: shown.pieces, added_libraries: shown.libraries, kept_names: plan.keptNames, engine_needs: plan.engineNeeds, standards: standardsOf(record), new_standards: newStandards, import_map: importMapOf(record) };
}

const noSuchPiece = (name) => refuse("piece_not_added", { message: `The game has no piece or library ${name} in its ${PIECES_FOLDER} folder.`, field: "name", fix: `zaisma pieces lists what it has; zaisma pieces add ${name} adds it. A library in the game's own package.json is the game's to move.` });
const refuseEdited = (name, command) => refuse("piece_edited", { message: `${name}'s files in the game aren't the ones that were added: someone changed them.`, field: "name", fix: `Nothing was changed. A piece is changed through its settings and hooks, never its files; if a change is missing, tell its maker. To lose the edits anyway: zaisma pieces ${command} ${name} --discard-edits.` });

/**
 * zaisma pieces update: moves one piece (or one library brought for pieces) to another version, on the
 * developer's word, when everything else in the game accepts it. Nothing else moves; what the new version needs
 * and the game lacks is brought.
 */
export async function updatePiece(gameFolder, name, { versionRange = "*", source = null, isDiscardingEdits = false, isDryRun = false } = {}) {
  const record = await readRecord(gameFolder);
  const had = hadOf(record);
  const current = had[name];
  if (!current) noSuchPiece(name);
  if (current.kind === "template") refuse("piece_not_updatable", { message: `${name} is a template: it was copied once and is the game's own now.`, field: "name", fix: "Nothing to update. Take what you want from a newer template by hand." });
  if (!parseRange(versionRange)) refuse("bad_piece_source", { message: `"${versionRange}" isn't a version or a range.`, field: "version", fix: 'Give a version or a range, like "^1.2" or "1.4.0".' });
  const npm = npmReader();
  let next;
  if (source !== null && current.kind === "library") refuse("bad_piece_source", { message: `${name} is a library, which comes from npm.`, field: "from", fix: "Leave --from out, and give --version for the version you want." });
  if (source !== null) next = await readSource(source, { npm });
  else if (current.kind === "library") {
    const archive = await npm.archiveOf(name, [versionRange]);
    next = archive ? await libraryFrom(async (path) => archive.allFiles[path] ?? null, name, "npm") : null;
  } else if (current.sourceKind === "npm") next = await readSource(`${name}@${versionRange}`, { npm });
  else refuse("piece_source_needed", { message: `${name} was added from a ${current.sourceKind}, so there's nowhere to look for another version.`, field: "from", fix: `Say where the new version is: zaisma pieces update ${name} --from <folder or .tgz>.` });
  if (!next) refuse("piece_not_found", { message: `npm has no ${name} at ${versionRange}.`, field: "version", fix: "Check the version." });
  if (next.name !== name) refuse("bad_piece_source", { message: `That's ${next.name}, not ${name}.`, field: "from", fix: `Give a source of ${name}.` });
  if (!satisfies(next.version, versionRange)) refuse("piece_not_found", { message: `That source holds ${named(next)}, outside ${versionRange}.`, field: "version", fix: "Give a source of the version you want, or leave --version out." });
  const answer = (updated, added, plan, newStandards) => {
    const shown = shownUnits(added);
    const isLibrary = current.kind === "library";
    return {
      is_dry_run: isDryRun,
      name,
      updated_piece: updated && !isLibrary ? shownPiece(recordedOf(updated), false) : null,
      updated_library: updated && isLibrary ? shownLibrary(recordedOf(updated), false) : null,
      earlier_piece_version: isLibrary ? null : current.version,
      earlier_library_version: isLibrary ? current.version : null,
      added_pieces: shown.pieces,
      added_libraries: shown.libraries,
      kept_names: plan?.keptNames ?? [],
      engine_needs: plan?.engineNeeds ?? [],
      standards: standardsOf(record),
      new_standards: newStandards,
      import_map: importMapOf(record),
    };
  };
  if (next.version === current.version) return answer(null, [], null, []);
  if ((await isEdited(gameFolder, current)) && !isDiscardingEdits) refuseEdited(name, "update");
  checkUpdateFits({ name, nextVersion: next.version, had });
  // The new version's own needs are met the same way adding meets them.
  const others = Object.fromEntries(Object.entries(had).filter(([hadName]) => hadName !== name));
  const libraries = gameLibrariesReader(gameFolder);
  await libraries.note(next);
  const find = needFinder(next, npm);
  const plan = await planAdd({
    piece: next,
    had: others,
    gameLibraries: libraries.gameLibraries,
    find: async (needName, needKind, ranges) => {
      const found = await find(needName, needKind, ranges);
      if (found) await libraries.note(found);
      return found;
    },
  });
  const newStandards = await carryOut(gameFolder, record, plan.added, isDryRun);
  return answer(next, plan.added.filter((unit) => unit.name !== name), plan, newStandards);
}

/**
 * zaisma pieces remove: takes one piece (or library) out of the game, unless another of its pieces needs it.
 * Nothing else is removed; what it needed and nothing needs now is named, for the developer to decide.
 */
export async function removePiece(gameFolder, name, { isDiscardingEdits = false, isDryRun = false } = {}) {
  const record = await readRecord(gameFolder);
  const had = hadOf(record);
  const current = had[name];
  if (!current) noSuchPiece(name);
  if (current.kind === "template") refuse("piece_not_removable", { message: `${name} is a template: its files are the game's own now.`, field: "name", fix: "Delete the files you don't want yourself; the pieces it brought are removed one by one." });
  const needers = needersOf(name, had);
  if (needers.length) refuse("piece_still_needed", { message: `${needers.map(({ holder, need }) => `${named(holder)} needs ${name} ${need.version_range}`).join(", and ")}.`, field: "name", fix: `Nothing was changed. Remove ${needers.map(({ holder }) => holder.name).join(" and ")} first, or keep ${name}.` });
  if ((await isEdited(gameFolder, current)) && !isDiscardingEdits) refuseEdited(name, "remove");
  const others = Object.fromEntries(Object.entries(had).filter(([hadName]) => hadName !== name));
  const noLongerNeededNames = current.needs.filter((need) => isNeedBrought(need) && others[need.name] && !needersOf(need.name, others).length).map((need) => need.name);
  takeFromRecord(record, name);
  if (!isDryRun) {
    for (const folder of foldersOf(current)) await rm(join(gameFolder, ...folder.split("/")), { recursive: true, force: true });
    // A scope's folder that held only this piece goes with it.
    if (name.startsWith("@")) for (const base of [PIECES_FOLDER, SERVER_PIECES_FOLDER]) {
      const scopeFolder = join(gameFolder, ...base.split("/"), name.split("/")[0]);
      const left = await readdir(scopeFolder).catch(() => null);
      if (left && !left.length) await rm(scopeFolder, { recursive: true, force: true });
    }
    await writeRecord(gameFolder, record);
  }
  return { is_dry_run: isDryRun, removed_name: name, removed_folders: foldersOf(current), no_longer_needed_names: noLongerNeededNames, import_map: importMapOf(record) };
}

/**
 * zaisma pieces newer: which of a game's pieces have a newer version on npm, and the newest the rest of the
 * game accepts. It changes nothing: a version moves only with pieces update.
 */
export async function newerPieces(gameFolder) {
  const record = await readRecord(gameFolder);
  const had = hadOf(record);
  const npm = npmReader();
  const newer = { newer_pieces: [], newer_libraries: [], unchecked_names: [] };
  for (const unit of Object.values(had)) {
    if (unit.kind === "template") continue;
    const versions = unit.sourceKind === "npm" ? await npm.versionsOf(unit.name) : null;
    if (!versions) {
      newer.unchecked_names.push(unit.name);
      continue;
    }
    const isNewer = (version) => parseVersion(version) && compareVersions(version, unit.version) > 0;
    const newest = newestSatisfying(Object.keys(versions).filter(isNewer), "*");
    if (!newest) continue;
    const needers = needersOf(unit.name, had);
    const newestAccepted = newestSatisfying(Object.keys(versions).filter(isNewer), ["*", ...needers.map(({ need }) => need.version_range)]);
    const heldBackByNames = needers.filter(({ need }) => !satisfies(newest, need.version_range)).map(({ holder }) => holder.name);
    if (unit.kind === "library") newer.newer_libraries.push({ name: unit.name, library_version: unit.version, newest_library_version: newest, newest_accepted_library_version: newestAccepted, held_back_by_names: heldBackByNames });
    else newer.newer_pieces.push({ name: unit.name, piece_version: unit.version, newest_piece_version: newest, newest_accepted_piece_version: newestAccepted, held_back_by_names: heldBackByNames });
  }
  return newer;
}

// ---- A maker's check of a piece, before publishing it ----

/** Every problem the check finds. refused: adding the piece would fail or break it in a game. note: worth fixing, and it still adds. */
export const PIECE_CHECK_CODES = {
  bad_piece_statement: { problemKind: "refused", meaning: "The piece.json isn't one: the message names the field." },
  piece_statement_newer: { problemKind: "refused", meaning: "The piece.json is written for a newer command than this one." },
  missing_file: { problemKind: "refused", meaning: "The piece.json lists a file that isn't there, or the file is a link." },
  stale_statement_module: { problemKind: "refused", meaning: "piece.json.js isn't piece.json as a module any more; --fix writes it again." },
  package_disagrees: { problemKind: "refused", meaning: "The package.json beside it has another name or version, or leaves a listed file out of what npm packs." },
  unlisted_import: { problemKind: "refused", meaning: "A file imports a file of the piece's own that the piece.json doesn't list, so a game wouldn't get it." },
  undeclared_need: { problemKind: "refused", meaning: "A file imports another piece or a library that isn't in needs." },
  file_not_uploadable: { problemKind: "note", meaning: "A file is of a type Zaisma's upload doesn't take, so a game whose folder is uploaded as it is can't hold the piece." },
  no_reference: { problemKind: "note", meaning: "The file a game imports has no .d.ts beside it: it's what an AI reads to use the piece without opening its code." },
  no_readme: { problemKind: "note", meaning: "There's no README.md among the piece's files." },
};

/** The modules a JavaScript file imports, by what's between the quotes; null when it can't be parsed. */
function importedModules(text) {
  let tree;
  try {
    tree = parseJavaScript(text, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return null;
  }
  const modules = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) modules.push(node.source.value);
    if (node.type === "ImportExpression" && node.source.type === "Literal" && typeof node.source.value === "string") modules.push(node.source.value);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(tree);
  return modules;
}

/**
 * zaisma pieces check: what a maker runs on a piece's folder before publishing it. Answers { name,
 * piece_version, is_ready, problems }, each problem { code, problem_kind, message, path, fix }; is_ready is
 * false with any "refused" problem. With isFixing it first writes piece.json.js again from piece.json, when the
 * piece has one.
 */
export async function checkPiece(pieceFolder, { isFixing = false } = {}) {
  const problems = [];
  const add = (code, message, path, fix) => problems.push({ code, problem_kind: PIECE_CHECK_CODES[code].problemKind, message, path, fix });
  const done = (statement) => ({ name: statement?.name ?? null, piece_version: statement?.piece_version ?? null, is_ready: !problems.some((problem) => problem.problem_kind === "refused"), problems });
  const statementBytes = await readFile(join(pieceFolder, STATEMENT_PATH)).catch(() => null);
  if (!statementBytes) refuse("bad_piece_source", { message: `${pieceFolder} has no ${STATEMENT_PATH}, so it isn't a piece.`, field: "folder", fix: `Give a piece's folder: one with a ${STATEMENT_PATH} at its top (docs/PIECES.md).` });
  const statementText = statementBytes.toString("utf8");
  let statement;
  try {
    statement = readStatement(statementText);
  } catch (error) {
    if (!(error instanceof PiecesError)) throw error;
    add(error.error.code, error.error.message, STATEMENT_PATH, error.error.fix);
    return done(null);
  }
  const listedPaths = [...new Set([...statement.file_paths, ...statement.server_file_paths])];
  const isModuleListed = listedPaths.includes(STATEMENT_MODULE_PATH);
  if (isFixing && isModuleListed) await writeFile(join(pieceFolder, STATEMENT_MODULE_PATH), statementModuleText(statementText));
  const files = {};
  for (const path of listedPaths) {
    const found = await lstat(join(pieceFolder, ...path.split("/"))).catch(() => null);
    if (!found?.isFile()) add("missing_file", `${STATEMENT_PATH} lists ${path}, which ${found?.isSymbolicLink() ? "is a link to another file" : "isn't there"}.`, path, found?.isSymbolicLink() ? "Put the file itself in the piece." : "Add the file, or take it out of the list.");
    else files[path] = await readFile(join(pieceFolder, ...path.split("/")));
  }
  if (files[STATEMENT_MODULE_PATH] && !isStatementModule(files[STATEMENT_MODULE_PATH], statementText)) add("stale_statement_module", `${STATEMENT_MODULE_PATH} isn't ${STATEMENT_PATH} as a module any more, so the piece's code would read another statement than the one it gives.`, STATEMENT_MODULE_PATH, "Run this check again with --fix: it writes the file from piece.json.");
  const packageJson = await readFile(join(pieceFolder, "package.json"), "utf8").then(JSON.parse).catch(() => null);
  if (packageJson) {
    if (packageJson.name !== statement.name || packageJson.version !== statement.piece_version) add("package_disagrees", `${STATEMENT_PATH} says ${statement.name} ${statement.piece_version}, and package.json says ${packageJson.name} ${packageJson.version}.`, "package.json", "Give both the same name and version: a piece is found on npm by its package's.");
    if (Array.isArray(packageJson.files)) {
      // Plain names only: a pattern in "files" is npm's to read.
      const isPacked = (path) => packageJson.files.some((packed) => /[*?!{[]/.test(packed) || path === packed.replace(/^\.\//, "").replace(/\/$/, "") || path.startsWith(`${packed.replace(/^\.\//, "").replace(/\/$/, "")}/`));
      for (const path of [STATEMENT_PATH, ...listedPaths]) if (!isPacked(path)) add("package_disagrees", `package.json's files leaves out ${path}, so npm wouldn't publish it.`, "package.json", `Add "${path}" to package.json's files.`);
    }
  }
  // What each file imports: its own files must be listed, and anything outside the piece must be one of its needs.
  const needKinds = Object.fromEntries(statement.needs.map((need) => [need.name, need.kind]));
  const isTemplate = statement.kind === "template";
  for (const [path, bytes] of Object.entries(files)) {
    if (!/\.m?js$/.test(path)) continue;
    const modules = importedModules(bytes.toString("utf8"));
    for (const module of modules ?? []) {
      const sides = [statement.file_paths.includes(path) ? statement.file_paths : null, statement.server_file_paths.includes(path) ? statement.server_file_paths : null].filter(Boolean);
      if (module.startsWith(".")) {
        // As the file sits in a game: pieces/<name>/<path> with its neighbours beside it, or the game's own folder for a template.
        const parts = isTemplate ? [] : [PIECES_FOLDER, ...statement.name.split("/")];
        for (const part of [...path.split("/").slice(0, -1), ...module.split("/")]) part === ".." ? parts.pop() : part !== "." && parts.push(part);
        const target = parts.join("/");
        const ownFolder = `${PIECES_FOLDER}/${statement.name}/`;
        if (!isTemplate && target.startsWith(ownFolder)) {
          const inside = target.slice(ownFolder.length);
          if (inside !== STATEMENT_PATH) for (const side of sides) if (!side.includes(inside)) add("unlisted_import", `${path} imports ${module}, and ${inside} isn't in ${side === statement.file_paths ? "file_paths" : "server_file_paths"}.`, path, `List ${inside} there, so a game gets it.`);
        } else if (target.startsWith(`${PIECES_FOLDER}/`)) {
          const neighbour = /^((?:@[^/]+\/)?[^/]+)\//.exec(target.slice(PIECES_FOLDER.length + 1))?.[1];
          if (!neighbour || needKinds[neighbour] !== "piece") add("undeclared_need", `${path} imports ${module}, and ${neighbour ?? "that"} isn't a piece in its needs.`, path, `Add { "name": "${neighbour ?? "<its name>"}", "version_range": "…", "kind": "piece" } to needs: what a piece needs is always stated.`);
        } else if (isTemplate) {
          if (!statement.file_paths.includes(target)) add("unlisted_import", `${path} imports ${module}, and ${target} isn't in file_paths.`, path, `List ${target} there, so a game gets it.`);
        } else add("undeclared_need", `${path} imports ${module}, which leaves the ${PIECES_FOLDER} folder.`, path, `Import only the piece's own files and its needs, each from where a game has it: ${PIECES_FOLDER}/<name>/.`);
      } else if (!module.startsWith("node:") && !/^[a-z]+:/.test(module)) {
        const library = /^((?:@[^/]+\/)?[^/]+)/.exec(module)?.[1];
        if (needKinds[library] !== "library") add("undeclared_need", `${path} imports ${module}, and ${library} isn't a library in its needs.`, path, `Add { "name": "${library}", "version_range": "…", "kind": "library" } to needs: what a piece needs is always stated.`);
      }
    }
  }
  for (const path of listedPaths) {
    if (path.endsWith(".d.ts") || GAME_FILE_EXTENSIONS.includes(extensionOf(path))) continue;
    add("file_not_uploadable", `${path} is of a type Zaisma's upload doesn't take.`, path, "A game whose folder is uploaded as it is can't hold this file. Rename it (a licence travels as LICENSE.txt), or leave it out if the game never reads it.");
  }
  const entryPath = statement.entry_path;
  if (!isTemplate && entryPath && /\.m?js$/.test(entryPath) && !statement.file_paths.includes(entryPath.replace(/\.m?js$/, ".d.ts"))) add("no_reference", `${entryPath} has no ${entryPath.replace(/\.m?js$/, ".d.ts")} among the piece's files.`, entryPath, "Write one with every call, setting, hook and error explained and an example: it's what an AI reads instead of the code.");
  if (!statement.file_paths.includes("README.md")) add("no_readme", "There's no README.md in file_paths.", null, "Add one that shows the piece in use.");
  return done(statement);
}
