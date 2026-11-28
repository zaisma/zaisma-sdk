// Where a save is kept. A store holds the save's text where the page can write it at once (so a save written as
// the page closes is never lost) and says when it changed elsewhere. browserStore keeps it in localStorage, which
// Zaisma copies to a signed-in player's account; serverStore keeps it on the game's own game server too (server.js),
// through any request function, so it works the same on Zaisma and on a developer's own server. The reference is
// stores.d.ts. MIT licensed.
import { MAXIMUM_BROWSER_SAVE_SIZE_BYTES, MAXIMUM_SERVER_SAVE_SIZE_BYTES, STORAGE_KEY_PATTERN, isSavedLater, partsOf, savedAtOf } from "./envelope.js";

class StoreError extends Error {
  constructor(code, message, field, fix) {
    super(message);
    this.name = "PieceError";
    this.pieceName = "@zaisma/save";
    this.code = code;
    this.field = field;
    this.fix = fix;
  }
}

const BROWSER_OPTIONS = ["storageKey", "storage", "eventTarget"];
const SERVER_OPTIONS = ["request", "storageKey", "storage", "eventTarget", "minimumSendIntervalSec"];
/** Zaisma.server.request's error codes that trying again never helps: the game or its game server is set up wrong. */
const FINAL_REQUEST_CODES = ["no_request_handler", "bad_server_url", "not_on_zaisma", "unknown_option", "bad_request", "too_big", "bad_player_token"];
/** How long a send that failed waits before trying again, in seconds, one after another, the last repeating. */
const RETRY_DELAYS_SEC = [5, 15, 60, 300];

function checkedOptions(given, names, call) {
  if (given === null || typeof given !== "object" || Array.isArray(given)) throw new StoreError("bad_argument", `${call} takes an object of options.`, null, `Give { ${names.join(", ")} }, each optional unless its reference says so.`);
  for (const name of Object.keys(given)) if (!names.includes(name)) throw new StoreError("unknown_argument", `${call} has no option "${name}".`, name, `Its options are: ${names.join(", ")}.`);
  const { storageKey = "save" } = given;
  if (typeof storageKey !== "string" || !STORAGE_KEY_PATTERN.test(storageKey)) throw new StoreError("bad_storage_key", "A storage key is letters, digits and . _ : -, up to 100 characters.", "storageKey", 'Give a key like "save" or "save.slot-2".');
  const storage = given.storage ?? (typeof localStorage === "object" ? localStorage : null);
  if (!storage) throw new StoreError("no_storage", "There's no localStorage here to keep the save in.", "storage", "In a browser this never happens; elsewhere give a storage with getItem, setItem and removeItem.");
  const eventTarget = given.eventTarget ?? (typeof window === "object" ? window : null);
  return { storageKey, storage, eventTarget };
}

function listenOn(target, eventName, handler, stops) {
  if (!target) return;
  target.addEventListener(eventName, handler);
  stops.push(() => target.removeEventListener(eventName, handler));
}

/** Writes text in place of what was expected there. Answers { isWritten } or, when someone else wrote, the text there now. */
function writeInPlace(storage, storageKey, saveText, expectedText) {
  const storedText = storage.getItem(storageKey);
  if (storedText !== expectedText) return { isWritten: false, storedText };
  storage.setItem(storageKey, saveText);
  return { isWritten: true, storedText: saveText };
}

/**
 * The save in the browser's localStorage, under its storage key. On Zaisma, with cloud saves on, it follows a
 * signed-in player to every device with no more code; anywhere else it stays in that browser.
 */
export function browserStore(given = {}) {
  const { storageKey, storage, eventTarget } = checkedOptions(given, BROWSER_OPTIONS, "browserStore");
  const stops = [];
  return {
    storeKind: "browser",
    storageKey,
    maximumSaveSizeBytes: MAXIMUM_BROWSER_SAVE_SIZE_BYTES,
    async read() {
      return { saveText: storage.getItem(storageKey), otherSaveText: null, otherPlace: null };
    },
    write: (saveText, expectedText) => writeInPlace(storage, storageKey, saveText, expectedText),
    listen(listeners) {
      // Another tab of the game wrote the save: the save takes it, so two tabs never undo each other.
      listenOn(eventTarget, "storage", (event) => {
        if (event.key === storageKey && (!event.storageArea || event.storageArea === storage)) listeners.changedOutside(event.newValue ?? null);
      }, stops);
      return () => {};
    },
    flush() {},
    dispose() {
      for (const stop of stops.splice(0)) stop();
    },
  };
}

/**
 * The save on the game's own game server, through request: a function that sends the save piece's requests to
 * the game server's onRequest, where server.js answers them, and answers what it answered. On Zaisma that's
 * Zaisma.server.request; on a developer's own server, the same with its serverUrl, or any fetch. A copy stays in
 * localStorage, written at once, so progress made offline or as the page closes is sent the next time.
 */
export function serverStore(given = {}) {
  const { storageKey, storage, eventTarget } = checkedOptions(given, SERVER_OPTIONS, "serverStore");
  const { request, minimumSendIntervalSec = 10 } = given;
  if (typeof request !== "function") throw new StoreError("bad_argument", "serverStore needs request: how it reaches the game server.", "request", "Give request: (body) => Zaisma.server.request(body), with { serverUrl } for your own server, or your own fetch to it.");
  if (typeof minimumSendIntervalSec !== "number" || !(minimumSendIntervalSec >= 1 && minimumSendIntervalSec <= 600)) throw new StoreError("bad_argument", "minimumSendIntervalSec is a number of seconds from 1 to 600.", "minimumSendIntervalSec", "Give how long at least between sends to the game server: 10 by default.");
  const syncKey = `${storageKey}:server`;
  const stops = [];
  let listeners = null;
  /** "server" once the game server keeps this player's save; "local" for a guest it doesn't; "unreached" until it answers. */
  let reach = "unreached";
  let playerId = null;
  /** The game server's revision the copy here was last in step with, null for none. */
  let basedOnRevisionNumber = null;
  let sendTimer = null;
  let isSending = false;
  let isSendWanted = false;
  let lastSentAtMs = -Infinity;
  let lastPartCount = 1;
  let failureCount = 0;
  let isDisposed = false;

  const readSync = () => {
    try {
      const sync = JSON.parse(storage.getItem(syncKey) ?? "null");
      return sync !== null && typeof sync === "object" ? sync : null;
    } catch {
      return null;
    }
  };
  const writeSync = (isSent) => storage.setItem(syncKey, JSON.stringify({ player_id: playerId, based_on_revision_number: basedOnRevisionNumber, is_sent: isSent }));
  const takeServerText = (saveText) => {
    if (saveText === null) storage.removeItem(storageKey);
    else storage.setItem(storageKey, saveText);
    writeSync(true);
  };
  /** What the game server answered, or throws: an error answer is a StoreError of its code. */
  async function ask(body) {
    const answer = await request({ ...body, storage_key: storageKey });
    if (answer && typeof answer === "object" && answer.error && typeof answer.error === "object") {
      throw new StoreError(String(answer.error.code ?? "save_request_refused"), String(answer.error.message ?? "The game server refused the save's request."), answer.error.field ?? null, String(answer.error.fix ?? "See the game server's errors."));
    }
    if (!answer || typeof answer !== "object") throw new StoreError("save_request_refused", "The game server answered the save's request with something that isn't the save piece's answer.", null, "Answer the save's requests with answerSaveRequest from the save piece's server.js, in the game server's onRequest.");
    return answer;
  }
  /** A refusal that trying again never helps: the game server's own, or the request's for a game set up wrong. One never answered might. */
  const isAnsweredRefusal = (error) => error instanceof StoreError || FINAL_REQUEST_CODES.includes(error?.code);
  const isAccountNeeded = (error) => error?.code === "account_needed";

  function scheduleSend(delayMs = null) {
    if (isDisposed || reach === "local") return;
    isSendWanted = true;
    if (isSending || sendTimer !== null) return;
    const spacingMs = Math.max(minimumSendIntervalSec, lastPartCount) * 1000;
    const waitMs = delayMs ?? Math.max(0, lastSentAtMs + spacingMs - Date.now());
    sendTimer = setTimeout(() => {
      sendTimer = null;
      send();
    }, waitMs);
  }

  function failed(error) {
    if (isAccountNeeded(error)) {
      reach = "local"; // A guest: the save stays in this browser.
      return;
    }
    if (isAnsweredRefusal(error)) {
      // The game server refused it (too big, too many saves): trying again changes nothing until the save does.
      // Refused before it was ever reached, the game is set up wrong: the save stays in this browser.
      isSendWanted = false;
      if (reach === "unreached") reach = "local";
      listeners?.problem({ code: error.code, message: error.message, fix: error.fix ?? "Answer the save's requests with answerSaveRequest from the save piece's server.js, in the game server's onRequest." });
      return;
    }
    failureCount += 1;
    if (failureCount === 1) listeners?.problem({ code: "save_not_sent", message: `The save couldn't reach the game server: ${error?.message ?? error}.`, fix: "It's kept in this browser and sent again by itself; nothing is lost." });
    scheduleSend(RETRY_DELAYS_SEC[Math.min(failureCount, RETRY_DELAYS_SEC.length) - 1] * 1000);
  }

  /** Reaches the game server for the first time: answers the stored save to use, after settling it with the copy here. */
  async function reachServer() {
    const localText = storage.getItem(storageKey);
    const sync = readSync();
    const answer = await ask({ type: "zaisma_save_read" });
    if (answer.is_kept_on_server !== true) {
      reach = "local";
      return { saveText: localText, otherSaveText: null, otherPlace: null };
    }
    reach = "server";
    playerId = typeof answer.player_id === "string" ? answer.player_id : null;
    const serverText = typeof answer.save_text === "string" ? answer.save_text : null;
    const serverRevisionNumber = Number.isInteger(answer.revision_number) ? answer.revision_number : null;
    // The copy here is this player's when it was made by them, or before the game server knew them (offline, as a guest).
    const isOwnCopy = localText !== null && (sync === null || sync.player_id === null || sync.player_id === playerId);
    const isUnsent = isOwnCopy && sync?.is_sent !== true;
    basedOnRevisionNumber = serverRevisionNumber;
    if (isUnsent && serverText !== localText) {
      const isInStep = (sync?.based_on_revision_number ?? null) === serverRevisionNumber || serverText === null;
      if (isInStep || isSavedLater(localText, serverText)) {
        // Progress made here since: it goes to the game server. When the game server moved on too, the later one wins.
        writeSync(false);
        scheduleSend(0);
        return { saveText: localText, otherSaveText: isInStep ? null : serverText, otherPlace: isInStep ? null : "elsewhere" };
      }
      takeServerText(serverText);
      return { saveText: serverText, otherSaveText: localText, otherPlace: "this_device" };
    }
    takeServerText(serverText);
    return { saveText: serverText, otherSaveText: null, otherPlace: null };
  }

  async function send() {
    if (isDisposed || isSending) return;
    if (reach === "unreached") {
      try {
        const settled = await reachServer();
        failureCount = 0;
        // Reached at last: what the game server had may be the one in use now (the save ignores what it has already).
        listeners?.changedOutside(settled.saveText);
        if (settled.otherSaveText !== null) listeners?.conflict(settled.otherSaveText, settled.otherPlace);
      } catch (error) {
        failed(error);
      }
      return;
    }
    if (reach !== "server" || !isSendWanted) return;
    const saveText = storage.getItem(storageKey);
    if (saveText === null) return;
    isSending = true;
    isSendWanted = false;
    try {
      const parts = partsOf(saveText);
      lastPartCount = parts.length;
      const uploadId = `upload_${Math.random().toString(36).slice(2, 12)}`;
      for (let partIndex = 0; partIndex < parts.length - 1; partIndex += 1) {
        await ask({ type: "zaisma_save_part", upload_id: uploadId, part_index: partIndex, part_text: parts[partIndex] });
      }
      const answer = await ask({ type: "zaisma_save_write", upload_id: uploadId, part_count: parts.length, part_text: parts[parts.length - 1], expected_revision_number: basedOnRevisionNumber });
      lastSentAtMs = Date.now();
      failureCount = 0;
      basedOnRevisionNumber = Number.isInteger(answer.revision_number) ? answer.revision_number : null;
      if (answer.is_written === true) {
        const isStillSame = storage.getItem(storageKey) === saveText;
        writeSync(isStillSame);
        if (!isStillSame) isSendWanted = true;
        listeners?.sent(savedAtOf(saveText));
      } else {
        // Another device wrote since: the one saved later wins, here and there.
        const theirText = typeof answer.save_text === "string" ? answer.save_text : null;
        if (isSavedLater(saveText, theirText)) {
          isSendWanted = true;
          listeners?.conflict(theirText, "elsewhere");
        } else {
          takeServerText(theirText);
          listeners?.changedOutside(theirText);
          listeners?.conflict(saveText, "this_device");
        }
      }
    } catch (error) {
      isSendWanted = true;
      failed(error);
    } finally {
      isSending = false;
    }
    if (isSendWanted) scheduleSend();
  }

  return {
    storeKind: "server",
    storageKey,
    maximumSaveSizeBytes: MAXIMUM_SERVER_SAVE_SIZE_BYTES,
    async read() {
      try {
        const settled = await reachServer();
        failureCount = 0;
        return settled;
      } catch (error) {
        // Unreached (offline, or the game server is down): the copy here is used, and tried again later.
        failed(error);
        return { saveText: storage.getItem(storageKey), otherSaveText: null, otherPlace: null };
      }
    },
    write(saveText, expectedText) {
      const outcome = writeInPlace(storage, storageKey, saveText, expectedText);
      if (outcome.isWritten) {
        const sync = readSync();
        if (reach === "unreached" && sync) {
          playerId = sync.player_id ?? null;
          basedOnRevisionNumber ??= sync.based_on_revision_number ?? null;
        }
        writeSync(false);
        scheduleSend();
      }
      return outcome;
    },
    listen(given) {
      listeners = given;
      listenOn(eventTarget, "online", () => {
        if (isSendWanted || reach === "unreached") {
          if (sendTimer !== null) clearTimeout(sendTimer);
          sendTimer = null;
          send();
        }
      }, stops);
      listenOn(eventTarget, "storage", (event) => {
        if (event.key === storageKey && (!event.storageArea || event.storageArea === storage)) listeners?.changedOutside(event.newValue ?? null);
      }, stops);
      return () => {
        listeners = null;
      };
    },
    /** Sends what's waiting now, without waiting for the interval: at a checkpoint, or as the page closes. */
    flush() {
      if (!isSendWanted || isSending || reach !== "server") return;
      if (sendTimer !== null) clearTimeout(sendTimer);
      sendTimer = null;
      send();
    },
    dispose() {
      isDisposed = true;
      if (sendTimer !== null) clearTimeout(sendTimer);
      sendTimer = null;
      for (const stop of stops.splice(0)) stop();
    },
  };
}

