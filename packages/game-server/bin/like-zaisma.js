// play-locally's game server held to Zaisma's rooms: the limits a copy of the game server has there, measured here, with
// the same lines in its logs and the same ending when it goes past one, so a game server that fails on Zaisma fails on
// the developer's computer first. The Node runner on a developer's own server has none of this: it's theirs to size.
//
// - Memory: a copy has 128 MB, its data files included (read whole as it starts). Over it, the copy starts again empty.
// - CPU: 50 ms a call, a real-time room's ticks 30 to a call sharing 1.5 s, and 5 s for a start; 20 calls over theirs in
//   a minute stop the game server, and Cloudflare stops a call at about 2 s. (The top level's 1 s as the code loads isn't
//   held here: Shieldbreak's took 1.3 s on a Mac and started on Zaisma.)
// - Modules: only the game server's own files, by relative path: no Node modules and no packages left unbundled.
//
// CPU here is the time a handler runs before its first await, on this computer: close to what Cloudflare measures, not exact.
import { registerHooks, isBuiltin } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CALL_STOP_CPU_DURATION_MS, CALL_STOPPED_TEXT, FAILURE_COUNT, GAME_SERVER_LIMITS, GAME_SERVER_STOPPED_TEXT, GROUPED_TICK_COUNT, OVER_BUDGET_CALL_COUNT, OVER_BUDGET_WINDOW_MS, overBudgetText } from "../src/internal.ts";

/** The exit code with which the runner asks the bench to start it again at once: its copy went over its memory, as on Zaisma. */
export const COPY_STARTED_AGAIN_EXIT_CODE = 75;
/** Handlers whose call starts a room's game server: setup and onRestored, and a real-time room's first tick after either. */
const START_HANDLER_NAMES = new Set(["setup", "onRestored"]);
/** What runs in the call that carries a real-time room's next tick, sharing its CPU: its players' input and their views. */
const TICK_CALL_HANDLER_NAMES = new Set(["onMessage", "onBytes", "stateView"]);
/** Handlers given a room that may only read: it can't end the room. */
const READ_ONLY_HANDLER_NAMES = new Set(["canJoin", "stateView", "onChat"]);

/** This thread's CPU so far, in ms: the garbage collector's threads don't count where Node can tell them apart (24 and later). */
function threadCpuMs() {
  const used = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage();
  return (used.user + used.system) / 1000;
}
/** Who calls outside rooms (onRequest, onSchedule, onWebhook) count as: one place, as the game's own object on Zaisma. */
const OUTSIDE_ROOMS = "outside_rooms";

/**
 * The game server's modules, as Zaisma's rooms have them: zaisma-server/ (or the one zaisma-server.js) and nothing else.
 * An import of anything else from one of them fails as it does there. Called once, before the game server is imported.
 */
export function refuseOutsideModules(entryFile) {
  const realEntry = realpathSync(entryFile);
  const isFolder = realEntry.endsWith(`${sep}index.js`) && dirname(realEntry).endsWith(`${sep}zaisma-server`);
  const folderUrl = pathToFileURL(dirname(realEntry) + sep).href;
  const entryUrl = pathToFileURL(realEntry).href;
  const isGameServerModule = (url) => (isFolder ? url.startsWith(folderUrl) : url === entryUrl);
  registerHooks({
    resolve(specifier, resolveContext, nextResolve) {
      const parentUrl = resolveContext.parentURL;
      // A .wasm file's module is the runner's own stand-in (loadWasmAsModules), which reads the file with Node's.
      if (!parentUrl || !isGameServerModule(parentUrl.split("?")[0]) || new URL(parentUrl).pathname.endsWith(".wasm")) return nextResolve(specifier, resolveContext);
      const parentPath = fileURLToPath(parentUrl.split("?")[0]).slice(dirname(realEntry).length + 1);
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      if (isRelative) {
        const resolved = nextResolve(specifier, resolveContext);
        if (isGameServerModule(resolved.url.split("?")[0])) return resolved;
      }
      const why = isBuiltin(specifier)
        ? "Zaisma's rooms run your game server without Node's modules: use what every browser has (fetch, crypto, TextEncoder, setTimeout) and room.readDataFile for files"
        : isRelative
          ? `only the game server's own files load on Zaisma's rooms (${isFolder ? "zaisma-server/" : "the one zaisma-server.js"})`
          : "packages from npm aren't installed on Zaisma's rooms: bundle them into the game server (npx esbuild server.ts --format=esm --bundle --outfile=zaisma-server.js)";
      throw new Error(`No such module "${specifier}", imported from ${parentPath}: ${why}.`);
    },
  });
}

/** The WebAssembly memories the game server made or got from its modules, which Node counts in no figure of its own. */
const webAssemblyMemories = new Set();

/**
 * Notes every WebAssembly memory the game server makes, its modules' exported ones included, so memorySizeBytes counts
 * them as Cloudflare counts a copy's. Called once, before the game server is imported.
 */
export function countWebAssemblyMemories() {
  const keep = (memory) => webAssemblyMemories.add(new WeakRef(memory));
  const keepExported = (instance) => {
    for (const exported of Object.values(instance?.exports ?? {})) if (exported instanceof WebAssembly.Memory) keep(exported);
    return instance;
  };
  const NodeMemory = WebAssembly.Memory;
  WebAssembly.Memory = class extends NodeMemory {
    constructor(...memoryArguments) {
      super(...memoryArguments);
      keep(this);
    }
  };
  const NodeInstance = WebAssembly.Instance;
  WebAssembly.Instance = class extends NodeInstance {
    constructor(...instanceArguments) {
      super(...instanceArguments);
      keepExported(this);
    }
  };
  for (const name of ["instantiate", "instantiateStreaming"]) {
    const nodeInstantiate = WebAssembly[name];
    if (typeof nodeInstantiate !== "function") continue;
    WebAssembly[name] = (...instantiateArguments) => nodeInstantiate(...instantiateArguments).then((made) => (keepExported(made instanceof NodeInstance ? made : made.instance), made));
  }
}

function webAssemblyMemorySizeBytes() {
  let sizeBytes = 0;
  for (const reference of webAssemblyMemories) {
    const memory = reference.deref();
    if (memory) sizeBytes += memory.buffer.byteLength;
    else webAssemblyMemories.delete(reference);
  }
  return sizeBytes;
}

/**
 * The game server's memory now, without what the runner itself held before loading it (baselineBytes): the JavaScript
 * heap, every ArrayBuffer and its WebAssembly memories, as Cloudflare counts a copy's. Garbage is collected first only when it looks over, so a
 * game under its memory never pauses for it.
 */
export function memorySizeBytes(baselineBytes) {
  const measure = () => {
    const usage = process.memoryUsage();
    return Math.max(0, usage.heapUsed + usage.arrayBuffers + webAssemblyMemorySizeBytes() - baselineBytes);
  };
  const sizeBytes = measure();
  if (sizeBytes <= GAME_SERVER_LIMITS.maximumMemorySizeBytes || typeof globalThis.gc !== "function") return sizeBytes;
  globalThis.gc();
  return measure();
}

/** What the runner holds before the game server loads, for memorySizeBytes. */
export function memoryBaselineBytes() {
  if (typeof globalThis.gc === "function") globalThis.gc();
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

/**
 * The game server with each handler timed against Zaisma's CPU, per room: print gets each line its logs would have
 * (level and text), and onStart is told after each start, when its memory is worth a look. A room whose game server
 * goes past its limits ends as on Zaisma, with what its players are told there.
 */
export function heldToZaismaLimits(gameServer, { print, onStart = () => {}, nowMs = () => Date.now(), elapsedMs = () => performance.now(), cpuMs = threadCpuMs }) {
  const isRealTime = gameServer.ticksPerSec !== undefined;
  /** How long a call's worth of ticks lasts: a group also closes by time, for a real-time room with no onTick. */
  const tickGroupDurationMs = isRealTime ? (GROUPED_TICK_COUNT * 1000) / gameServer.ticksPerSec : 0;
  /** By room code (or OUTSIDE_ROOMS): its tick group, its calls over budget, its stops, and whether it ended. */
  const places = new Map();
  /** States whose next tick is a start's (setup or onRestored gave or had them). */
  const startingStates = new WeakSet();
  const placeOf = (key) => {
    if (!places.has(key)) places.set(key, { tickCount: 0, tickDurationMs: 0, tickGroupStartedAtMs: nowMs(), overBudgetAtMs: [], failureCount: 0, hasEnded: false, room: null });
    return places.get(key);
  };
  const roomOf = (handlerArguments) => handlerArguments.find((given) => given !== null && typeof given === "object" && typeof given.roomCode === "string" && typeof given.end === "function") ?? null;
  // A read-only handler's room (canJoin, stateView, onChat) can't end: the room ends through the one its other handlers had.
  const end = (place, room) => {
    place.hasEnded = true;
    try {
      (place.room ?? room)?.end(GAME_SERVER_STOPPED_TEXT);
    } catch {
      // Already ending.
    }
  };
  const overBudget = (place, room) => {
    const atMs = nowMs();
    place.overBudgetAtMs = place.overBudgetAtMs.filter((earlierAtMs) => atMs - earlierAtMs < OVER_BUDGET_WINDOW_MS);
    place.overBudgetAtMs.push(atMs);
    if (place.overBudgetAtMs.length < OVER_BUDGET_CALL_COUNT || !room || place.hasEnded) return;
    print("error", overBudgetText(place.overBudgetAtMs.length));
    place.overBudgetAtMs = [];
    end(place, room);
  };
  const stopped = (place, room) => {
    print("error", `Zaisma: ${CALL_STOPPED_TEXT}`);
    if (++place.failureCount >= FAILURE_COUNT && room && !place.hasEnded) end(place, room);
  };
  /** One call's CPU against what Zaisma gives it. */
  const measured = (handlerName, handlerArguments, isStartCall, durationMs) => {
    const room = roomOf(handlerArguments);
    const place = placeOf(room ? room.roomCode : OUTSIDE_ROOMS);
    if (room && !READ_ONLY_HANDLER_NAMES.has(handlerName)) place.room = room;
    if (place.hasEnded) return;
    if (isStartCall) {
      if (durationMs > GAME_SERVER_LIMITS.maximumStartCpuDurationMs) stopped(place, room);
      return;
    }
    if (handlerName === "onTick" || (isRealTime && TICK_CALL_HANDLER_NAMES.has(handlerName))) {
      // A call's worth of ticks gone by (a room with no onTick counts none): the next group starts from nothing, as live.
      if (place.tickCount === 0 && place.tickDurationMs > 0 && nowMs() - place.tickGroupStartedAtMs >= tickGroupDurationMs) {
        const isOver = place.tickDurationMs > GROUPED_TICK_COUNT * GAME_SERVER_LIMITS.maximumCallCpuDurationMs;
        place.tickDurationMs = 0;
        if (isOver) overBudget(place, room);
        if (place.hasEnded) return;
      }
      if (place.tickCount === 0 && place.tickDurationMs === 0) place.tickGroupStartedAtMs = nowMs();
      place.tickDurationMs += durationMs;
      if (handlerName === "onTick") place.tickCount++;
      if (place.tickDurationMs > CALL_STOP_CPU_DURATION_MS) {
        place.tickCount = 0;
        place.tickDurationMs = 0;
        return stopped(place, room);
      }
      if (place.tickCount < GROUPED_TICK_COUNT) return;
      const isOver = place.tickDurationMs > GROUPED_TICK_COUNT * GAME_SERVER_LIMITS.maximumCallCpuDurationMs;
      place.tickCount = 0;
      place.tickDurationMs = 0;
      if (isOver) overBudget(place, room);
      return;
    }
    if (durationMs > CALL_STOP_CPU_DURATION_MS) stopped(place, room);
    else if (durationMs > GAME_SERVER_LIMITS.maximumCallCpuDurationMs) overBudget(place, room);
  };
  const held = {};
  for (const name of Object.keys(gameServer)) {
    const given = gameServer[name];
    if (typeof given !== "function") {
      held[name] = given;
      continue;
    }
    held[name] = function (...handlerArguments) {
      const state = handlerArguments[0];
      const isStartTick = name === "onTick" && state !== null && typeof state === "object" && startingStates.has(state);
      if (isStartTick) startingStates.delete(state);
      const isStart = START_HANDLER_NAMES.has(name);
      const startedAtMs = elapsedMs();
      const cpuStartedAtMs = cpuMs();
      let answer;
      try {
        answer = given.apply(gameServer, handlerArguments);
      } catch (error) {
        measured(name, handlerArguments, isStart || isStartTick, elapsedMs() - startedAtMs);
        throw error;
      }
      // A start often awaits its data files before it builds from them: its CPU counts until it settles (other rooms' calls
      // meanwhile count too, which only errs high on a budget of seconds). Any other call counts until its first await.
      if ((isStart || isStartTick) && answer && typeof answer.then === "function") answer.then(() => measured(name, handlerArguments, true, cpuMs() - cpuStartedAtMs), () => {});
      else measured(name, handlerArguments, isStart || isStartTick, elapsedMs() - startedAtMs);
      if (isStart) {
        const noteStarting = (state) => {
          if (state !== null && typeof state === "object") startingStates.add(state);
        };
        if (name === "onRestored") noteStarting(handlerArguments[0]);
        if (name === "setup") {
          if (answer && typeof answer.then === "function") answer = answer.then((state) => (noteStarting(state), state));
          else noteStarting(answer);
        }
      }
      if (isStart || isStartTick) {
        if (answer && typeof answer.then === "function") answer.then(onStart, () => {});
        else onStart();
      }
      return answer;
    };
  }
  return held;
}
