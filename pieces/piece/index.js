// @zaisma/piece: how a JavaScript piece opens its settings and hooks, the same way in every piece
// (docs/PIECES.md, "Settings and hooks"). A piece states its settings and hooks once, in its piece.json; this
// reads that statement and gives the game what it changes a piece through: settings that are checked and can be
// turned up while playing, and hooks the piece calls. Plain JavaScript with no dependencies, the same in a
// browser and on a game server.

/** An error of a piece: code is stable, field names the setting, hook or argument at fault (or is null), fix says what to do. */
export class PieceError extends Error {
  constructor(pieceName, code, { message, field = null, fix }) {
    super(message);
    this.name = "PieceError";
    this.pieceName = pieceName;
    this.code = code;
    this.field = field;
    this.fix = fix;
  }
}

/** A stated name in JavaScript's style: jump_height_m is jumpHeightM. */
export function camelName(statedName) {
  return statedName.replace(/_([a-z0-9])/g, (whole, letter) => letter.toUpperCase());
}

function checkedStatement(statement) {
  if (statement === null || typeof statement !== "object" || typeof statement.name !== "string" || !Array.isArray(statement.settings) || !Array.isArray(statement.hooks)) {
    throw new TypeError("This takes the piece's own statement: what its piece.json.js gives as its default.");
  }
  return statement;
}

const isPlainObject = (given) => given !== null && typeof given === "object" && !Array.isArray(given);
const quoted = (names) => names.map((name) => `"${name}"`).join(", ");

/** What a setting takes, in words, for an error's message. */
function takes(stated) {
  if (stated.value_kind === "number") return `a number from ${stated.minimum_number} to ${stated.maximum_number}`;
  if (stated.value_kind === "integer") return `a whole number from ${stated.minimum_number} to ${stated.maximum_number}`;
  if (stated.value_kind === "boolean") return "true or false";
  if (stated.value_kind === "choice") return `one of ${quoted(stated.choices)}`;
  if (stated.value_kind === "text") return `text of up to ${stated.maximum_character_count} characters`;
  return 'a colour as six hex digits, like "#3fa9f5"';
}

/** Whether a setting takes what was given. */
function isTaken(stated, given) {
  if (stated.value_kind === "number" || stated.value_kind === "integer") {
    return typeof given === "number" && Number.isFinite(given) && given >= stated.minimum_number && given <= stated.maximum_number && (stated.value_kind === "number" || Number.isInteger(given));
  }
  if (stated.value_kind === "boolean") return typeof given === "boolean";
  if (stated.value_kind === "choice") return stated.choices.includes(given);
  if (stated.value_kind === "text") return typeof given === "string" && given.length <= stated.maximum_character_count;
  return typeof given === "string" && /^#[0-9a-fA-F]{6}$/.test(given);
}

/** One handler's throw never stops a piece or the handlers after it: it's logged, and the piece carries on. */
function callSafely(pieceName, what, handler, given) {
  try {
    return handler(...given);
  } catch (error) {
    console.error(`${pieceName}: ${what} threw, so it was skipped.`, error);
    return undefined;
  }
}

/**
 * Opens a piece's settings from its statement, starting from their defaults with the game's own on top.
 * Throws PieceError "unknown_setting" or "bad_setting" for what the game gave.
 */
export function openSettings(statement, givenSettings = {}) {
  const pieceName = checkedStatement(statement).name;
  const statedByName = new Map(statement.settings.map((stated) => [camelName(stated.name), stated]));
  const current = new Map([...statedByName].map(([name, stated]) => [name, stated.default_value]));
  const listeners = new Set();
  const statedOf = (name) => {
    const stated = statedByName.get(name);
    if (!stated) {
      throw new PieceError(pieceName, "unknown_setting", {
        message: `${pieceName} has no setting "${name}".`,
        field: String(name),
        fix: statedByName.size ? `Its settings are: ${quoted([...statedByName.keys()])}. If the one you want is missing, tell the piece's maker: a piece is changed through its settings and hooks, never its files.` : "It has no settings.",
      });
    }
    return stated;
  };
  /** Checks every change before any applies, so a set that's refused changes nothing. */
  const checked = (changes) => {
    if (!isPlainObject(changes)) throw new PieceError(pieceName, "bad_setting", { message: `${pieceName}'s settings are given as an object of names and what to set them to.`, field: null, fix: 'Give an object, like { jumpHeightM: 3 }.' });
    const entries = [];
    for (const [name, given] of Object.entries(changes)) {
      const stated = statedOf(name);
      if (!isTaken(stated, given)) throw new PieceError(pieceName, "bad_setting", { message: `${pieceName}'s ${name} takes ${takes(stated)}, and got ${JSON.stringify(given) ?? String(given)}.`, field: name, fix: `Give ${takes(stated)}.` });
      entries.push([name, stated.value_kind === "color" ? given.toLowerCase() : given]);
    }
    return entries;
  };
  const apply = (entries) => {
    const changes = [];
    for (const [name, newValue] of entries) {
      const earlierValue = current.get(name);
      if (earlierValue === newValue) continue;
      current.set(name, newValue);
      changes.push({ name, newValue, earlierValue });
    }
    for (const change of changes) for (const listener of [...listeners]) callSafely(pieceName, `a listener of the setting ${change.name}`, listener, [change]);
  };
  apply(checked(givenSettings));
  return {
    get(name) {
      statedOf(name);
      return current.get(name);
    },
    set(changes) {
      apply(checked(changes));
    },
    reset(names = [...statedByName.keys()]) {
      apply(names.map((name) => [name, statedOf(name).default_value]));
    },
    get values() {
      return Object.fromEntries(current);
    },
    list() {
      return [...statedByName].map(([name, stated]) => ({
        name,
        statedName: stated.name,
        valueKind: stated.value_kind,
        currentValue: current.get(name),
        defaultValue: stated.default_value,
        minimumNumber: stated.minimum_number,
        maximumNumber: stated.maximum_number,
        maximumCharacterCount: stated.maximum_character_count,
        choices: stated.choices ? [...stated.choices] : null,
        summary: stated.summary,
      }));
    },
    onChange(listener) {
      if (typeof listener !== "function") throw new PieceError(pieceName, "bad_setting", { message: "onChange takes a function.", field: null, fix: "Give a function: it's called with { name, newValue, earlierValue } after each change." });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Opens a piece's hooks from its statement, with the handlers the game gave when it made the piece. Answers
 * { hooks, tell, ask }: hooks is the game's side (on, off, list); tell and ask are the piece's own, for calling
 * them. Throws PieceError "unknown_hook" or "bad_hook" for what the game gave.
 */
export function openHooks(statement, givenHooks = {}) {
  const pieceName = checkedStatement(statement).name;
  const statedByName = new Map(statement.hooks.map((stated) => [camelName(stated.name), stated]));
  const handlersByName = new Map([...statedByName.keys()].map((name) => [name, []]));
  const statedOf = (name) => {
    const stated = statedByName.get(name);
    if (!stated) {
      throw new PieceError(pieceName, "unknown_hook", {
        message: `${pieceName} has no hook "${name}".`,
        field: String(name),
        fix: statedByName.size ? `Its hooks are: ${quoted([...statedByName.keys()])}. If the one you want is missing, tell the piece's maker: a piece is changed through its settings and hooks, never its files.` : "It has no hooks.",
      });
    }
    return stated;
  };
  const hooks = {
    on(name, handler) {
      statedOf(name);
      if (typeof handler !== "function") throw new PieceError(pieceName, "bad_hook", { message: `${pieceName}'s hook ${name} takes a function.`, field: name, fix: "Give a function: the piece's reference says what it's called with." });
      handlersByName.get(name).push(handler);
      return () => hooks.off(name, handler);
    },
    off(name, handler) {
      statedOf(name);
      const handlers = handlersByName.get(name);
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    },
    list() {
      return [...statedByName].map(([name, stated]) => ({ name, statedName: stated.name, hookKind: stated.hook_kind, summary: stated.summary }));
    },
  };
  if (!isPlainObject(givenHooks)) throw new PieceError(pieceName, "bad_hook", { message: `${pieceName}'s hooks are given as an object of names and functions.`, field: null, fix: "Give an object, like { landed: (landing) => playSound() }." });
  for (const [name, handler] of Object.entries(givenHooks)) hooks.on(name, handler);
  const ownHook = (name, hookKind, call) => {
    const stated = statedByName.get(name);
    if (stated?.hook_kind === hookKind) return [...handlersByName.get(name)];
    // The piece's own mistake, not the game's: its code and its statement disagree.
    throw new PieceError(pieceName, "wrong_hook_kind", { message: `${pieceName} called ${call}("${name}"), and its statement has ${stated ? `"${name}" as ${stated.hook_kind === "event" ? "an event" : "a decision"}` : `no hook "${name}"`}.`, field: name, fix: `Tell the piece's maker: tell is for a hook stated as an event, ask for one stated as a decision.` });
  };
  return {
    hooks,
    tell(name, ...details) {
      for (const handler of ownHook(name, "event", "tell")) callSafely(pieceName, `a handler of the hook ${name}`, handler, details);
    },
    ask(name, proposal, ...details) {
      let answer = proposal;
      for (const handler of ownHook(name, "decision", "ask")) {
        const given = callSafely(pieceName, `a handler of the hook ${name}`, handler, [answer, ...details]);
        if (given !== undefined) answer = given;
      }
      return answer;
    },
  };
}

/**
 * Opens both at once, from what the game gave the piece's create call: { settings, hooks } beside the piece's
 * own arguments. Answers { settings, hooks, tell, ask, refuse }; refuse(code, { message, field, fix }) throws the
 * piece's own PieceError.
 */
export function openPiece(statement, given = {}) {
  const pieceName = checkedStatement(statement).name;
  if (!isPlainObject(given)) throw new PieceError(pieceName, "bad_setting", { message: `${pieceName} is made with an object.`, field: null, fix: "Give an object, like { settings: { … }, hooks: { … } }." });
  const settings = openSettings(statement, given.settings ?? {});
  const { hooks, tell, ask } = openHooks(statement, given.hooks ?? {});
  return {
    settings,
    hooks,
    tell,
    ask,
    refuse(code, { message, field = null, fix }) {
      throw new PieceError(pieceName, code, { message, field, fix });
    },
  };
}
