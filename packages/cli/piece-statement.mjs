// A piece's statement (docs/PIECES.md): what a piece.json holds and the check that reads one, with the versions and
// ranges it speaks in. Nothing here touches a disk or a network, so the command (pieces.mjs) and Zaisma's site read a
// statement with exactly the same code: there is one statement, read one way.

/** The format of a piece.json this command reads. A statement with a higher number is from a newer command. */
export const STATEMENT_VERSION_NUMBER = 1;
/** The format of a game's pieces/pieces.json this command reads and writes. */
export const RECORD_VERSION_NUMBER = 1;
/**
 * The kinds of piece. A kind is how a piece arrives and what it may hold, never only a label: the four layers a game
 * is built from (the standards everything fits, what plugs into one, a genre's parts, and the thing copied once), a
 * pack of images, models and sounds, a preset of values for another piece or tool, and the two a game never holds:
 * a skill for the developer's AI and a tool for the developer's computer.
 */
export const PIECE_KINDS = ["foundation", "extension", "game_system", "template", "pack", "preset", "skill", "tool"];
/** The kinds whose code a game runs: each is built on a standard, and all but a template open settings and hooks. */
export const LAYER_KINDS = ["foundation", "extension", "game_system", "template"];
/** The kinds a game never holds: fetched for the developer or their AI (zaisma pieces get), never added to a game. */
export const FETCHED_KINDS = ["skill", "tool"];
/** The file an AI reads first in a skill. */
export const SKILL_ENTRY_PATH = "SKILL.md";
/** Whether a licence, as a piece states it, opens its source: UNLICENSED, LicenseRef-<name> (terms of the maker's own) and "SEE LICENSE IN <file>" keep it closed. */
export const isOpenLicense = (license) => typeof license === "string" && license !== "UNLICENSED" && !license.startsWith("LicenseRef-") && !license.startsWith("SEE LICENSE");
/** What a piece can need: another piece, a library from npm that isn't a piece, or an engine the game must already be on. */
export const NEED_KINDS = ["piece", "library", "engine"];
/** The kinds of value a setting holds. */
export const SETTING_VALUE_KINDS = ["number", "integer", "boolean", "choice", "text", "color"];
/** The kinds of hook: the piece tells the game something happened, or asks it before something does. */
export const HOOK_KINDS = ["event", "decision"];
/** Where a piece can come from: its folder, the .tgz npm pack makes of it, npm, or Zaisma's marketplace. */
export const SOURCE_KINDS = ["folder", "tarball", "npm", "marketplace"];
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
export const NAME_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const MAXIMUM_NAME_CHARACTER_COUNT = 100;
const STATED_NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MAXIMUM_STATED_NAME_CHARACTER_COUNT = 64;
const CHOICE_PATTERN = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const LICENSE_PATTERN = /^[A-Za-z0-9.+()-]+( [A-Za-z0-9.+()-]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z.-]+)?$/;
export const NEWEST_COMMAND = "npx @zaisma/cli@latest";

/** A failure in the API's error shape (docs/NAMING.md, Errors). */
export class PiecesError extends Error {
  constructor(code, { message, field = null, fix }) {
    super(message);
    this.error = { code, message, field, fix, retry_after_sec: null };
  }
}
export const refuse = (code, details) => {
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
export function isSafePath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 200 && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.includes("\\") && !/[\0-\x1f]/.test(path) && !path.split("/").some((part) => part === "" || part.startsWith(".") || part === "node_modules");
}

/** A stated name in a JavaScript piece's own style: jump_height_m is jumpHeightM. */
export function camelName(statedName) {
  return statedName.replace(/_([a-z0-9])/g, (whole, letter) => letter.toUpperCase());
}

export const isPlainObject = (given) => given !== null && typeof given === "object" && !Array.isArray(given);

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
  const isLayer = LAYER_KINDS.includes(statement.kind);
  if (isLayer ? !isName(statement.standard) : statement.standard !== null && !isName(statement.standard)) {
    bad("standard", `its standard "${statement.standard}" isn't a standard's name.`, `Name the standard the piece is built on, as its keeper holds it on npm, like "@studio/standard"${isLayer ? "" : `, or give null: a ${statement.kind} needn't be built on one`}.`);
  }
  const isSummary = (summary) => typeof summary === "string" && summary.trim().length > 0 && summary.length <= PIECE_LIMITS.maximumSummaryCharacterCount;
  if (!isSummary(statement.summary)) bad("summary", `its summary is missing or over ${PIECE_LIMITS.maximumSummaryCharacterCount} characters.`, "Say in a sentence or two what the piece gives a game.");
  if (typeof statement.license !== "string" || !LICENSE_PATTERN.test(statement.license) || statement.license.length > 100) bad("license", `its license "${statement.license}" isn't a licence's name.`, 'Name the licence the piece is under, as SPDX does, like "MIT" or "Apache-2.0"; a piece whose source is closed gives "UNLICENSED".');
  if (statement.kind === "skill" && !isOpenLicense(statement.license)) bad("license", `it's a skill under "${statement.license}".`, 'A skill is always open: name an open licence, like "MIT".');
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
    // A preset or a tool may have no one file to start from; a layer's code always does.
    if (paths.length && entryPath === null && !isLayer && statement.kind !== "skill") continue;
    if (paths.length && !paths.includes(entryPath)) bad(entryField, `its ${entryField} isn't one of its ${pathsField}.`, `Name the file ${entryField === "entry_path" ? "a game" : "a game server"} starts from, one of ${pathsField}.`);
  }
  if (!isLayer) {
    // Only a layer's code opens settings and hooks or runs on a game server: the rest are files a game, a developer or an AI reads.
    if (statement.server_file_paths.length) bad("server_file_paths", `it's a ${statement.kind} with server_file_paths.`, "Give an empty list, and list every file in file_paths.");
    if (!Array.isArray(statement.settings) || !Array.isArray(statement.hooks) || statement.settings.length || statement.hooks.length) bad("settings", `it's a ${statement.kind} with settings or hooks.`, "Give empty lists: only a foundation, an extension or a game system opens settings and hooks.");
    if (statement.kind === "pack" && statement.entry_path !== null) bad("entry_path", "it's a pack with an entry_path.", "Give null: a pack is files in its maker's own structure, with no one file to start from.");
    if (statement.kind === "skill" && statement.entry_path !== SKILL_ENTRY_PATH) bad("entry_path", `it's a skill whose entry_path isn't ${SKILL_ENTRY_PATH}.`, `Give "${SKILL_ENTRY_PATH}", the file an AI reads first, and list it in file_paths.`);
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

/** piece.json as a module (piece.json.js), so a piece's own code reads the one statement and never a second copy of it. */
export function statementModuleText(statementText) {
  return `// This piece's statement, piece.json, as a module for its own code to read. "zaisma pieces check --fix" writes it: never edit it.\nexport default ${JSON.stringify(JSON.parse(statementText), null, 2)};\n`;
}
