// @zaisma/save: save and load. A game describes its progress once (what a new player starts with, the save's
// format number, how to bring an older save up to date) and changes it as the player plays; this piece writes it,
// with what each of the game's pieces keeps of its own (piece.kept, from @zaisma/piece), at the right moments, and
// reads it back. Where it's kept is a store: the browser (stores.js, browserStore: on Zaisma it follows a signed-in
// player to every device), the game's own game server (serverStore and server.js, the same on Zaisma and on a
// developer's own server), or any store a developer writes. The reference is index.d.ts. MIT licensed.
import statement from "./piece.json.js";
import { openPiece } from "../piece/index.js";
import { browserStore, serverStore } from "./stores.js";
import { MAXIMUM_BROWSER_SAVE_SIZE_BYTES, MAXIMUM_SERVER_SAVE_SIZE_BYTES, sizeBytesOf } from "./envelope.js";

export { browserStore, serverStore, MAXIMUM_BROWSER_SAVE_SIZE_BYTES, MAXIMUM_SERVER_SAVE_SIZE_BYTES };
export { PieceError } from "../piece/index.js";

const ARGUMENTS = ["saveFormatVersionNumber", "defaults", "upgrades", "store", "storageKey", "keptPieces", "eventTarget", "settings", "hooks"];
const STORE_CALLS = ["read", "write", "listen", "flush", "dispose"];

const isPlainObject = (given) => given !== null && typeof given === "object" && !Array.isArray(given);
const copyOf = (plainJson) => JSON.parse(JSON.stringify(plainJson));

/** The defaults with what was stored on top: a field added since the save was written starts at its default, at any depth. */
function withDefaults(defaults, stored) {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) return stored === undefined ? copyOf(defaults) : stored;
  const merged = copyOf(defaults);
  for (const [name, storedValue] of Object.entries(stored)) merged[name] = Object.hasOwn(defaults, name) ? withDefaults(defaults[name], storedValue) : storedValue;
  return merged;
}

/**
 * Opens the game's save: reads what's stored, brings it up to date, gives each kept piece its own back, and
 * answers the save to read and change. Throws PieceError for arguments that can't work.
 */
export async function openSave(given = {}) {
  const { settings, hooks, hasHandlers, tell, refuse } = openPiece(statement, isPlainObject(given) ? { settings: given.settings, hooks: given.hooks } : given);
  for (const name of Object.keys(given)) {
    if (!ARGUMENTS.includes(name)) refuse("unknown_argument", { message: `openSave has no argument "${name}".`, field: name, fix: `Its arguments are: ${ARGUMENTS.join(", ")}.` });
  }
  const { saveFormatVersionNumber, defaults, upgrades = {}, keptPieces = [] } = given;
  if (!Number.isInteger(saveFormatVersionNumber) || saveFormatVersionNumber < 1) refuse("bad_format_version", { message: "saveFormatVersionNumber is a whole number from 1.", field: "saveFormatVersionNumber", fix: "Start at 1, and add 1 each time the shape of the progress changes, with an upgrade from the number before." });
  if (!isPlainObject(defaults)) refuse("bad_defaults", { message: "defaults is an object: what a new player starts with.", field: "defaults", fix: "Give an object, like { level: 1, coinCount: 0 }." });
  try {
    if (JSON.stringify(copyOf(defaults)) !== JSON.stringify(defaults)) throw new Error();
  } catch {
    refuse("bad_defaults", { message: "defaults holds something that isn't plain JSON.", field: "defaults", fix: "Keep to numbers, text, true and false, null, lists and objects: a save is JSON." });
  }
  if (!isPlainObject(upgrades)) refuse("upgrade_missing", { message: "upgrades is an object of functions by format number.", field: "upgrades", fix: "Give { 1: (formatOneProgress) => formatTwoProgress, … }." });
  for (let fromNumber = 1; fromNumber < saveFormatVersionNumber; fromNumber += 1) {
    if (typeof upgrades[fromNumber] !== "function") refuse("upgrade_missing", { message: `There's no upgrade from format ${fromNumber} to ${fromNumber + 1}.`, field: "upgrades", fix: `Give upgrades[${fromNumber}]: a function that takes a format ${fromNumber} save's progress and answers it in format ${fromNumber + 1}.` });
  }
  if (!Array.isArray(keptPieces)) refuse("not_keepable", { message: "keptPieces is a list of pieces.", field: "keptPieces", fix: "Give the pieces whose own things the save keeps, like [input]." });
  if (given.store !== undefined && given.storageKey !== undefined) refuse("bad_argument", { message: "storageKey is for the browser store openSave makes when no store is given.", field: "storageKey", fix: "Give the storage key to the store instead: browserStore({ storageKey }) or serverStore({ storageKey, request })." });
  let store;
  try {
    store = given.store ?? browserStore({ storageKey: given.storageKey });
  } catch (error) {
    refuse(error?.code ?? "no_storage", { message: error?.message ?? String(error), field: error?.field ?? "store", fix: error?.fix ?? "Give a store: browserStore() or serverStore({ request })." });
  }
  for (const call of STORE_CALLS) {
    if (typeof store?.[call] !== "function") refuse("bad_store", { message: `The store has no ${call}().`, field: "store", fix: `A store answers ${STORE_CALLS.join(", ")} (index.d.ts, SaveStore): use browserStore() or serverStore({ request }), or write one that does.` });
  }
  const maximumSizeBytes = Number.isFinite(store.maximumSaveSizeBytes) ? store.maximumSaveSizeBytes : MAXIMUM_BROWSER_SAVE_SIZE_BYTES;
  const eventTarget = given.eventTarget ?? (typeof window === "object" ? window : null);

  let progress = copyOf(defaults);
  /** What each piece kept, by piece name, as stored: a piece the game no longer keeps is passed through, never lost. */
  let keptRecords = {};
  /** The kept pieces, by name, and the ones whose stored record a newer version of the piece wrote. */
  const keptByName = new Map();
  const heldPieceNames = new Set();
  /** The stored text as this save last read or wrote it: anything else in the store was written by someone else. */
  let knownText = null;
  let isWritingHeld = false;
  let hasChanges = false;
  let writeTimer = null;
  let isDisposed = false;

  const tellProblem = (problem) => {
    if (hasHandlers("problem")) tell("problem", problem);
    else console.warn(`@zaisma/save: ${problem.message} ${problem.fix}`);
  };

  /** Reads a stored save into its progress and kept records, or answers the problem that keeps it from being used. */
  function parse(text) {
    let stored;
    try {
      stored = JSON.parse(text);
    } catch {
      stored = null;
    }
    const storedNumber = stored?.save_format_version_number;
    if (!isPlainObject(stored) || !Number.isInteger(storedNumber) || storedNumber < 1 || !isPlainObject(stored.progress)) {
      return { problem: { code: "save_unreadable", message: "The stored save can't be read.", fix: "It's left as it is and nothing is written over it. Call save.replaceStored() to start over from the defaults." } };
    }
    if (storedNumber > saveFormatVersionNumber) {
      return { problem: { code: "save_from_newer_game", message: `The stored save is format ${storedNumber}, newer than this game's ${saveFormatVersionNumber}.`, fix: "It's left as it is and nothing is written over it: the player has played a newer version. Call save.replaceStored() only if losing it is right." } };
    }
    let upgraded = stored.progress;
    try {
      for (let fromNumber = storedNumber; fromNumber < saveFormatVersionNumber; fromNumber += 1) upgraded = upgrades[fromNumber](upgraded);
      if (!isPlainObject(upgraded)) throw new Error("an upgrade answered something that isn't an object");
    } catch (error) {
      return { problem: { code: "upgrade_failed", message: `Bringing the stored save up to date failed: ${error?.message ?? error}.`, fix: "It's left as it is and nothing is written over it. Fix the upgrade, or call save.replaceStored() to start over." } };
    }
    return { progress: withDefaults(defaults, upgraded), keptRecords: isPlainObject(stored.kept_pieces) ? stored.kept_pieces : {} };
  }

  /** Gives a kept piece its stored record back, or what it had when made when there's none. */
  function restorePiece(name) {
    const record = Object.hasOwn(keptRecords, name) ? keptRecords[name] : null;
    const isTaken = keptByName.get(name).restore(record);
    if (isTaken) heldPieceNames.delete(name);
    else heldPieceNames.add(name); // A newer version of the piece wrote it: kept as it is.
  }

  /** Takes stored text as the save in use. Answers whether it could be used; one that can't is left untouched in the store. */
  function take(text) {
    knownText = text;
    hasChanges = false;
    if (text === null) {
      progress = copyOf(defaults);
      keptRecords = {};
      isWritingHeld = false;
    } else {
      const parsed = parse(text);
      if (parsed.problem) {
        progress = copyOf(defaults);
        keptRecords = {};
        isWritingHeld = true;
        for (const name of keptByName.keys()) restorePiece(name);
        tellProblem(parsed.problem);
        return false;
      }
      progress = parsed.progress;
      keptRecords = parsed.keptRecords;
      isWritingHeld = false;
    }
    for (const name of keptByName.keys()) restorePiece(name);
    return true;
  }

  function envelopeToWrite() {
    const keptPiecesRecords = { ...keptRecords };
    for (const [name, kept] of keptByName) if (!heldPieceNames.has(name)) keptPiecesRecords[name] = kept.read();
    return { save_format_version_number: saveFormatVersionNumber, saved_at: new Date().toISOString(), progress, kept_pieces: keptPiecesRecords };
  }

  /** Writes now, unless the stored save changed under it or is one it couldn't use. Answers whether it wrote. */
  function write() {
    if (writeTimer !== null) clearTimeout(writeTimer);
    writeTimer = null;
    if (!hasChanges || isWritingHeld || isDisposed || !settings.get("writingEnabled")) return false;
    const envelope = envelopeToWrite();
    const text = JSON.stringify(envelope);
    const sizeBytes = sizeBytesOf(text);
    if (sizeBytes > maximumSizeBytes) {
      tellProblem({ code: "save_too_big", message: `The save is ${sizeBytes} bytes, over the ${maximumSizeBytes} its store takes.`, fix: "It wasn't written. Keep progress and settings in the save, never what the game can rebuild." });
      return false;
    }
    let outcome;
    try {
      outcome = store.write(text, knownText);
    } catch (error) {
      tellProblem({ code: "storage_refused", message: `The save couldn't be written: ${error?.message ?? error}.`, fix: "It wasn't written: the browser's storage may be full or turned off. The game keeps playing with what it has, and tries again on the next change." });
      return false;
    }
    if (!outcome?.isWritten) {
      // Someone else wrote the save: another tab, an earlier copy put back, the developer.
      takeOutside(outcome?.storedText ?? null);
      return false;
    }
    knownText = text;
    keptRecords = envelope.kept_pieces;
    hasChanges = false;
    tell("written", { savedAt: envelope.saved_at });
    return true;
  }

  function scheduleWrite() {
    if (isDisposed || writeTimer !== null || !settings.get("writingEnabled")) return;
    writeTimer = setTimeout(write, settings.get("writeDelayMs"));
  }

  function changed() {
    hasChanges = true;
    scheduleWrite();
  }

  function takeOutside(text) {
    if (text === knownText) return;
    if (take(text)) tell("changedOutside", save.progress);
  }

  function tellConflict(otherText, otherPlace) {
    if (typeof otherText !== "string") return;
    const parsed = parse(otherText);
    if (!parsed.problem) tell("conflict", { otherProgress: parsed.progress, otherPlace });
  }

  function keep(piece) {
    const kept = piece?.kept;
    if (!kept || typeof kept.pieceName !== "string" || typeof kept.read !== "function" || typeof kept.restore !== "function" || typeof kept.onChange !== "function") {
      refuse("not_keepable", { message: "That piece keeps nothing of its own: it has no kept.", field: "keptPieces", fix: "Keep only pieces whose reference has kept (a piece opens one with @zaisma/piece's openKept); keep the rest in the game's own progress." });
    }
    if (keptByName.has(kept.pieceName)) refuse("already_kept", { message: `${kept.pieceName} is kept already.`, field: "keptPieces", fix: "Keep each piece once." });
    keptByName.set(kept.pieceName, kept);
    stops.push(kept.onChange(changed));
    restorePiece(kept.pieceName);
  }

  const save = {
    settings,
    hooks,
    /** The player's progress, to read. Change it through update, so the change is written. */
    get progress() {
      return progress;
    },
    /** Whether nothing is being written because the stored save couldn't be used: see the problem hook. */
    get isWritingHeld() {
      return isWritingHeld;
    },
    /** Where the save is kept: the store's kind, like "browser" or "server". */
    get storeKind() {
      return store.storeKind ?? "custom";
    },
    update(change) {
      if (typeof change !== "function") refuse("bad_argument", { message: "update takes a function.", field: "change", fix: "Give a function that changes the progress in place, or answers a new one: save.update((progress) => { progress.coinCount += 1; })." });
      const answered = change(progress);
      if (answered !== undefined) {
        if (!isPlainObject(answered)) refuse("bad_argument", { message: "update's function answered something that isn't an object.", field: "change", fix: "Change the progress in place and answer nothing, or answer the whole new progress as an object." });
        progress = answered;
      }
      changed();
    },
    writeNow() {
      hasChanges = true;
      const isWritten = write();
      store.flush(false);
      return isWritten;
    },
    async reread() {
      const stored = await store.read();
      takeOutside(stored?.saveText ?? null);
    },
    reset() {
      progress = copyOf(defaults);
      for (const name of keptByName.keys()) {
        heldPieceNames.delete(name);
        keptByName.get(name).restore(null);
      }
      keptRecords = {};
      hasChanges = true;
      write();
    },
    replaceStored() {
      progress = copyOf(defaults);
      keptRecords = {};
      isWritingHeld = false;
      for (const name of keptByName.keys()) {
        heldPieceNames.delete(name);
        keptByName.get(name).restore(null);
      }
      hasChanges = true;
      write();
    },
    keep,
    dispose() {
      if (isDisposed) return;
      write();
      store.flush(true);
      isDisposed = true;
      for (const stop of stops) stop();
      store.dispose();
    },
  };

  const stops = [];
  const stopListening = store.listen({
    changedOutside: (text) => takeOutside(text),
    problem: (problem) => tellProblem(problem),
    conflict: (otherText, otherPlace) => tellConflict(otherText, otherPlace),
    sent: (savedAt) => tell("sent", { savedAt }),
  });
  if (typeof stopListening === "function") stops.push(stopListening);
  // Turned back on, what's waiting is written; a new delay takes the next change.
  stops.push(settings.onChange(({ name, newValue }) => {
    if (name === "writingEnabled" && newValue && hasChanges) scheduleWrite();
  }));
  if (eventTarget) {
    const listen = (target, eventName, handler) => {
      target.addEventListener(eventName, handler);
      stops.push(() => target.removeEventListener(eventName, handler));
    };
    // Phones close a hidden tab without warning, so hidden counts as closing.
    const closing = () => {
      write();
      store.flush(true);
    };
    listen(eventTarget, "pagehide", closing);
    if (typeof document === "object" && document) listen(document, "visibilitychange", () => document.hidden && closing());
  }

  const stored = await store.read();
  take(stored?.saveText ?? null);
  tellConflict(stored?.otherSaveText, stored?.otherPlace);
  for (const piece of keptPieces) keep(piece);
  return save;
}
