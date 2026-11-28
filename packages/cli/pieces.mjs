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
import {
  HOOK_FIELDS, HOOK_KINDS, NEED_FIELDS, NEED_KINDS, PIECE_KINDS, PIECE_LIMITS, PIECES_FOLDER, PiecesError, RECORD_PATH, RECORD_VERSION_NUMBER, SERVER_PIECES_FOLDER, SETTING_FIELDS, SETTING_VALUE_KINDS,
  SOURCE_KINDS, STATEMENT_FIELDS, STATEMENT_MODULE_PATH, STATEMENT_PATH, STATEMENT_VERSION_NUMBER, camelName, compareVersions, newestSatisfying, parseRange, parseVersion, readStatement, satisfies,
  FETCHED_KINDS, LAYER_KINDS, NAME_PATTERN, NEWEST_COMMAND, SKILL_ENTRY_PATH, isOpenLicense, isPlainObject, isSafePath, refuse, statementModuleText,
} from "./piece-statement.mjs";
import { CONTENT_HEAD_SIZE_BYTES, contentsKindOf, fileContentsOf, isText, neededHeadSizeBytes, refusedFileOf } from "./piece-contents.mjs";

export {
  HOOK_FIELDS, HOOK_KINDS, NEED_FIELDS, NEED_KINDS, PIECE_KINDS, PIECE_LIMITS, PIECES_FOLDER, PiecesError, RECORD_PATH, RECORD_VERSION_NUMBER, SERVER_PIECES_FOLDER, SETTING_FIELDS, SETTING_VALUE_KINDS,
  SOURCE_KINDS, STATEMENT_FIELDS, STATEMENT_MODULE_PATH, STATEMENT_PATH, STATEMENT_VERSION_NUMBER, camelName, compareVersions, newestSatisfying, parseRange, parseVersion, readStatement, satisfies,
  FETCHED_KINDS, LAYER_KINDS, SKILL_ENTRY_PATH, isOpenLicense, statementModuleText,
};

const FETCH_TIMEOUT_MS = 30000;

/** Whether a piece.json.js is its piece.json as a module, whatever line endings a checkout gave it. */
const isStatementModule = (moduleBytes, statementText) => moduleBytes.toString("utf8").replace(/\r\n/g, "\n") === statementModuleText(statementText);

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

/**
 * Where a piece is looked up by its name: Zaisma's marketplace first, when the command was given a way to ask it
 * (it needs the developer's key, so a key's say over fetching holds), then npm. A library that isn't a piece is
 * npm's alone. marketplace is { versionsOf(name), archiveOf(name, ranges) }, as npmReader's, or null.
 */
function sourcesReader(marketplace = null) {
  const npm = npmReader();
  const archiveOf = async (name, ranges) => {
    const listed = marketplace ? await marketplace.archiveOf(name, ranges) : null;
    if (listed) return { ...listed, sourceKind: "marketplace" };
    const published = await npm.archiveOf(name, ranges);
    return published ? { ...published, sourceKind: "npm" } : null;
  };
  /** The versions a unit's own source has of it: { version: … }, or null when it can't be asked. */
  const versionsOf = (name, sourceKind) => (sourceKind === "npm" ? npm.versionsOf(name) : sourceKind === "marketplace" && marketplace ? marketplace.versionsOf(name) : null);
  return { npm, archiveOf, versionsOf, hasMarketplace: marketplace !== null };
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
export async function readSource(source, { baseFolder = process.cwd(), sources = sourcesReader() } = {}) {
  const path = isAbsolute(source) ? source : resolve(baseFolder, source);
  const found = await stat(path).catch(() => null);
  if (found?.isDirectory()) return readPieceFolder(path);
  if (found?.isFile()) return pieceFrom(readTarball(await readFile(path), source), "tarball", path, source);
  const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@(.+))?$/.exec(source);
  if (!match || source.startsWith(".") || source.includes("//") || source.includes("\\")) refuse("piece_not_found", { message: `There's no folder or file at ${source}, and it isn't a name on npm.`, field: "source", fix: "Give a piece's folder, its .tgz, or its name on npm, like @studio/dash-move." });
  if (match[2] !== undefined && !parseRange(match[2])) refuse("bad_piece_source", { message: `"${match[2]}" isn't a version or a range.`, field: "source", fix: "Give a name alone for the newest, or with a range, like @studio/dash-move@^1.2." });
  const archive = await sources.archiveOf(match[1], [match[2] ?? "*"]);
  if (!archive) refuse("piece_not_found", { message: `${sources.hasMarketplace ? "Neither Zaisma's marketplace nor npm has" : "npm has no"} ${match[1]}${match[2] ? ` at ${match[2]}` : ""}.`, field: "source", fix: `Check the name and the version. ${sources.hasMarketplace ? "" : "Zaisma's marketplace is asked too once ZAISMA_KEY is set. "}A piece that's on neither is added from its folder or its .tgz.` });
  return pieceFrom(archive.allFiles, archive.sourceKind, `${match[1]}@${archive.version}`, archive.whereFrom);
}

/** Looks a piece's needs up where the piece itself came from: beside its folder, else on Zaisma's marketplace and npm. */
function needFinder(piece, sources) {
  const { npm } = sources;
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
    const archive = await sources.archiveOf(name, ranges);
    return archive ? pieceFrom(archive.allFiles, archive.sourceKind, `${name}@${archive.version}`, archive.whereFrom) : null;
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
const standardsOf = (record) => [...new Set(record.pieces.map((entry) => entry.statement.standard).filter((standard) => standard !== null))].sort();

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
export async function addPiece(gameFolder, source, { isDryRun = false, marketplace = null } = {}) {
  const sources = sourcesReader(marketplace);
  const piece = await readSource(source, { sources });
  if (FETCHED_KINDS.includes(piece.kind)) refuse("piece_not_addable", { message: `${piece.name} is a ${piece.kind}: it's for you or your AI, and a game never holds one.`, field: "source", fix: `Fetch it instead: zaisma pieces get ${piece.name}.` });
  const record = await readRecord(gameFolder);
  const find = needFinder(piece, sources);
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

/**
 * zaisma pieces get: a piece's files, written to a folder of their own: how a skill reaches the developer's AI and a
 * tool the developer's computer, since a game holds neither. A copy of the same piece already there is replaced,
 * and the answer says what changed since it; any other folder with files in it is left alone. Nothing is run.
 */
export async function getPiece(source, toFolder, { isDryRun = false, marketplace = null } = {}) {
  return writePieceCopy(await readPiece(source, { marketplace }), toFolder, { isDryRun });
}

/** A piece read from its source, a folder, a .tgz or a name, with its files: what writePieceCopy writes. */
export const readPiece = (source, { marketplace = null } = {}) => readSource(source, { sources: sourcesReader(marketplace) });

/** Writes a read piece's files into a folder of their own, as getPiece says. */
export async function writePieceCopy(piece, toFolder, { isDryRun = false } = {}) {
  const earlierText = await readFile(join(toFolder, STATEMENT_PATH), "utf8").catch(() => null);
  let earlier = null;
  try {
    earlier = earlierText === null ? null : JSON.parse(earlierText);
  } catch {
    earlier = null;
  }
  const existing = await readdir(toFolder).catch(() => []);
  if (existing.length && earlier?.name !== piece.name) refuse("piece_folder_not_empty", { message: `${toFolder} already holds files that aren't a copy of ${piece.name}.`, field: "to", fix: "Give an empty folder with --to, or move those files away first." });
  const paths = [STATEMENT_PATH, ...piece.statement.file_paths];
  const earlierPaths = earlier && Array.isArray(earlier.file_paths) ? [STATEMENT_PATH, ...earlier.file_paths.filter(isSafePath)] : [];
  const changes = { added_paths: [], changed_paths: [], removed_paths: earlierPaths.filter((path) => !paths.includes(path)) };
  for (const path of paths) {
    const had = earlierPaths.includes(path) ? await readFile(join(toFolder, ...path.split("/"))).catch(() => null) : null;
    if (had === null) changes.added_paths.push(path);
    else if (!had.equals(Buffer.from(piece.files[path]))) changes.changed_paths.push(path);
  }
  if (!isDryRun) {
    for (const path of changes.removed_paths) await rm(join(toFolder, ...path.split("/")), { force: true });
    for (const path of paths) {
      const target = join(toFolder, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, piece.files[path]);
    }
  }
  return { is_dry_run: isDryRun, name: piece.name, piece_version: piece.version, kind: piece.kind, source_kind: piece.sourceKind, folder: toFolder, earlier_piece_version: typeof earlier?.piece_version === "string" ? earlier.piece_version : null, ...(earlier ? changes : { added_paths: paths, changed_paths: [], removed_paths: [] }) };
}

const noSuchPiece = (name) => refuse("piece_not_added", { message: `The game has no piece or library ${name} in its ${PIECES_FOLDER} folder.`, field: "name", fix: `zaisma pieces lists what it has; zaisma pieces add ${name} adds it. A library in the game's own package.json is the game's to move.` });
const refuseEdited = (name, command) => refuse("piece_edited", { message: `${name}'s files in the game aren't the ones that were added: someone changed them.`, field: "name", fix: `Nothing was changed. A piece is changed through its settings and hooks, never its files; if a change is missing, tell its maker. To lose the edits anyway: zaisma pieces ${command} ${name} --discard-edits.` });

/**
 * zaisma pieces update: moves one piece (or one library brought for pieces) to another version, on the
 * developer's word, when everything else in the game accepts it. Nothing else moves; what the new version needs
 * and the game lacks is brought.
 */
export async function updatePiece(gameFolder, name, { versionRange = "*", source = null, isDiscardingEdits = false, isDryRun = false, marketplace = null } = {}) {
  const record = await readRecord(gameFolder);
  const had = hadOf(record);
  const current = had[name];
  if (!current) noSuchPiece(name);
  if (current.kind === "template") refuse("piece_not_updatable", { message: `${name} is a template: it was copied once and is the game's own now.`, field: "name", fix: "Nothing to update. Take what you want from a newer template by hand." });
  if (!parseRange(versionRange)) refuse("bad_piece_source", { message: `"${versionRange}" isn't a version or a range.`, field: "version", fix: 'Give a version or a range, like "^1.2" or "1.4.0".' });
  const sources = sourcesReader(marketplace);
  const { npm } = sources;
  let next;
  if (source !== null && current.kind === "library") refuse("bad_piece_source", { message: `${name} is a library, which comes from npm.`, field: "from", fix: "Leave --from out, and give --version for the version you want." });
  if (source !== null) next = await readSource(source, { sources });
  else if (current.kind === "library") {
    const archive = await npm.archiveOf(name, [versionRange]);
    next = archive ? await libraryFrom(async (path) => archive.allFiles[path] ?? null, name, "npm") : null;
  } else if (current.sourceKind === "npm" || current.sourceKind === "marketplace") next = await readSource(`${name}@${versionRange}`, { sources });
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
  const find = needFinder(next, sources);
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
export async function newerPieces(gameFolder, { marketplace = null } = {}) {
  const record = await readRecord(gameFolder);
  const had = hadOf(record);
  const sources = sourcesReader(marketplace);
  const newer = { newer_pieces: [], newer_libraries: [], unchecked_names: [] };
  for (const unit of Object.values(had)) {
    if (unit.kind === "template") continue;
    const versions = await sources.versionsOf(unit.name, unit.sourceKind);
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

/** Every file under a folder, by its path from it, sorted: nothing hidden, nothing in node_modules, no links. */
async function folderFilePaths(folder, inside = "") {
  const paths = [];
  for (const entry of await readdir(join(folder, ...inside.split("/").filter(Boolean)), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = inside ? `${inside}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...(await folderFilePaths(folder, path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

/**
 * The folder in a piece's folder that holds its listing's own pictures (docs/PIECES.md, "A listing's pictures"): its
 * cover and its gallery on the marketplace. They're the listing's, never the piece's: no statement lists them, and
 * nothing that adds the piece gets them.
 */
export const LISTING_FOLDER = "listing";
const LISTING_PICTURE_PATTERN = /\.(png|jpe?g|webp)$/i;

/**
 * A piece's listing pictures as its folder keeps them: its cover (listing/cover.png, .jpg, .jpeg or .webp) and its
 * gallery (every picture in listing/gallery/, in name order), each with its bytes. cover is null when there's no cover
 * file, gallery is null when there's no gallery folder: what the folder doesn't say is left as the listing has it.
 * Null when the piece has no listing folder at all.
 */
export async function readListingPictures(pieceFolder) {
  const paths = (await folderFilePaths(pieceFolder).catch(() => [])).filter((path) => path.startsWith(`${LISTING_FOLDER}/`) && LISTING_PICTURE_PATTERN.test(path));
  const hasGalleryFolder = await readdir(join(pieceFolder, LISTING_FOLDER, "gallery")).then(() => true, () => false);
  const hasListingFolder = await readdir(join(pieceFolder, LISTING_FOLDER)).then(() => true, () => false);
  if (!hasListingFolder) return null;
  const read = async (path) => ({ path, bytes: new Uint8Array(await readFile(join(pieceFolder, ...path.split("/")))) });
  const coverPath = paths.find((path) => /^listing\/cover\.[a-z]+$/i.test(path));
  return { cover: coverPath ? await read(coverPath) : null, gallery: hasGalleryFolder ? await Promise.all(paths.filter((path) => path.startsWith(`${LISTING_FOLDER}/gallery/`)).map(read)) : null };
}

/** A piece's folder as the marketplace takes it: its statement, and every file it lists with its bytes. For zaisma pieces publish. */
export async function readPieceForPublishing(pieceFolder) {
  const piece = await readPieceFolder(pieceFolder);
  return { statement: piece.statement, files: piece.files };
}

/** Every problem the check finds. refused: adding the piece would fail or break it in a game. note: worth fixing, and it still adds. */
export const PIECE_CHECK_CODES = {
  bad_piece_statement: { problemKind: "refused", meaning: "The piece.json isn't one: the message names the field." },
  piece_statement_newer: { problemKind: "refused", meaning: "The piece.json is written for a newer command than this one." },
  missing_file: { problemKind: "refused", meaning: "The piece.json lists a file that isn't there, or the file is a link." },
  stale_statement_module: { problemKind: "refused", meaning: "piece.json.js isn't piece.json as a module any more; --fix writes it again." },
  package_disagrees: { problemKind: "refused", meaning: "The package.json beside it has another name or version, or leaves a listed file out of what npm packs." },
  unlisted_import: { problemKind: "refused", meaning: "A file imports a file of the piece's own that the piece.json doesn't list, so a game wouldn't get it." },
  undeclared_need: { problemKind: "refused", meaning: "A file imports another piece or a library that isn't in needs." },
  forbidden_file: { problemKind: "refused", meaning: "A file is a program for Windows, macOS or Linux, a shell script, an archive or a PDF, which Zaisma's marketplace takes in no piece, as in no game." },
  file_mislabeled: { problemKind: "refused", meaning: "A pack's or preset's file isn't what its name says: its bytes are another kind of file. Zaisma's marketplace refuses it." },
  skill_file_not_text: { problemKind: "refused", meaning: "A skill's file isn't text: a skill is read in full before anyone gets it." },
  contains_code: { problemKind: "note", meaning: "A pack or preset holds a file that can run, can point at a script, or can't be seen through, so the marketplace marks it Contains code, never No code." },
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
  let contentsKind = null;
  const add = (code, message, path, fix) => problems.push({ code, problem_kind: PIECE_CHECK_CODES[code].problemKind, message, path, fix });
  const done = (statement) => ({ name: statement?.name ?? null, piece_version: statement?.piece_version ?? null, kind: statement?.kind ?? null, contents_kind: contentsKind, is_ready: !problems.some((problem) => problem.problem_kind === "refused"), problems });
  const statementBytes = await readFile(join(pieceFolder, STATEMENT_PATH)).catch(() => null);
  if (!statementBytes) refuse("bad_piece_source", { message: `${pieceFolder} has no ${STATEMENT_PATH}, so it isn't a piece.`, field: "folder", fix: `Give a piece's folder: one with a ${STATEMENT_PATH} at its top (docs/PIECES.md).` });
  let statementText = statementBytes.toString("utf8");
  // A pack is a folder in its maker's own structure: --fix lists its files, so nobody types hundreds of paths.
  if (isFixing) {
    let given = null;
    try {
      given = JSON.parse(statementText);
    } catch {
      given = null;
    }
    if (given?.kind === "pack") {
      // The listing's own pictures (listing/) are never part of the piece.
      const filePaths = (await folderFilePaths(pieceFolder)).filter((path) => path !== STATEMENT_PATH && path !== "package.json" && !path.startsWith(`${LISTING_FOLDER}/`));
      if (JSON.stringify(given.file_paths) !== JSON.stringify(filePaths)) {
        statementText = JSON.stringify({ ...given, file_paths: filePaths }, null, 2) + "\n";
        await writeFile(join(pieceFolder, STATEMENT_PATH), statementText);
      }
    }
  }
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
  // No piece holds a program, a shell script or an archive, whatever it's called: Zaisma's storage refuses them, as in a game.
  for (const [path, bytes] of Object.entries(files)) {
    const refused = refusedFileOf(bytes.subarray(0, 16));
    if (refused) add("forbidden_file", `${path} is ${refused}, which Zaisma takes in no piece, whatever it's called.`, path, refused === "a shell script" ? "Take its first line (#!…) out and say in the README how to run it, or leave the file out." : "Leave it out: publish the files themselves, never an archive or a built program.");
  }
  // What its kind adds. A pack or a preset: every file opened, as the marketplace opens it. A skill: text all through.
  if (statement.kind === "pack" || statement.kind === "preset") {
    const opened = Object.entries(files).map(([path, bytes]) => ({ path, ...fileContentsOf(path, bytes.subarray(0, neededHeadSizeBytes(path))) }));
    for (const file of opened.filter((each) => each.is_mislabeled)) add("file_mislabeled", `${file.path}: ${file.reason}`, file.path, "Give the file the extension of what it is, or leave it out.");
    contentsKind = contentsKindOf(opened);
    const runnable = opened.filter((each) => each.contents_kind === "contains_code" && !each.is_mislabeled);
    if (runnable.length) add("contains_code", `${runnable.length === 1 ? "One file makes" : `${runnable.length} files make`} this ${statement.kind} Contains code, so it can't be marked No code: ${runnable.slice(0, 5).map((each) => each.path).join(", ")}${runnable.length > 5 ? "…" : ""}. ${runnable[0].reason}`, runnable[0].path, "Fine if it's meant: the marketplace says so on its listing. For No code, leave those files out or publish them as another piece.");
  }
  if (statement.kind === "skill") {
    for (const [path, bytes] of Object.entries(files)) if (bytes.length && !isText(bytes.subarray(0, CONTENT_HEAD_SIZE_BYTES))) add("skill_file_not_text", `${path} isn't text.`, path, "Keep a skill to text files, and publish anything else as a pack or a tool the skill names.");
  }
  // What each file imports: its own files must be listed, and anything outside the piece must be one of its needs.
  const needKinds = Object.fromEntries(statement.needs.map((need) => [need.name, need.kind]));
  const isTemplate = statement.kind === "template";
  const isLayer = LAYER_KINDS.includes(statement.kind);
  for (const [path, bytes] of Object.entries(files)) {
    // Only what a game runs is held to its needs: a tool's or a skill's scripts import what they like.
    if (!isLayer || !/\.m?js$/.test(path)) continue;
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
    // A skill and a tool never go into a game's folder, so what a game's upload takes doesn't hold them.
    if (FETCHED_KINDS.includes(statement.kind) || path.endsWith(".d.ts") || GAME_FILE_EXTENSIONS.includes(extensionOf(path))) continue;
    add("file_not_uploadable", `${path} is of a type Zaisma's upload doesn't take.`, path, "A game whose folder is uploaded as it is can't hold this file. Rename it (a licence travels as LICENSE.txt), or leave it out if the game never reads it.");
  }
  const entryPath = statement.entry_path;
  if (isLayer && !isTemplate && entryPath && /\.m?js$/.test(entryPath) && !statement.file_paths.includes(entryPath.replace(/\.m?js$/, ".d.ts"))) add("no_reference", `${entryPath} has no ${entryPath.replace(/\.m?js$/, ".d.ts")} among the piece's files.`, entryPath, "Write one with every call, setting, hook and error explained and an example: it's what an AI reads instead of the code.");
  if (!statement.file_paths.includes("README.md")) add("no_readme", "There's no README.md in file_paths.", null, "Add one that shows the piece in use.");
  return done(statement);
}
