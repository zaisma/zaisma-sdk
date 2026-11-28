// The parts real-time sync is built from, as Shieldbreak's netcode proved them: steps of a fixed length on the
// room's clock, numbered inputs kept until the server has answered them, and snapshots drawn a moment behind so
// they move evenly however they arrive. Plain values, no engine: the characters kind puts them together, and a
// kind of a game's own can too.
import { refuse, refuseUnknown } from "./wire.js";

/** Fixed steps a second the rooms take at most (a game server's ticksPerSec). */
export const MAXIMUM_TICKS_PER_SEC = 60;

function checkTicksPerSec(ticksPerSec, field) {
  if (!(Number.isInteger(ticksPerSec) && ticksPerSec >= 1 && ticksPerSec <= MAXIMUM_TICKS_PER_SEC)) {
    refuse("bad_ticks_per_sec", `${field} is ${JSON.stringify(ticksPerSec)}.`, field, `Give a whole number from 1 to ${MAXIMUM_TICKS_PER_SEC}: 30 suits most action games, 60 only when the game truly needs it.`);
  }
}

/**
 * Fixed steps on a shared clock. Every player's game and the game server count the same step numbers from the
 * room's clock, so step 51,200 is the same moment for all of them.
 */
export function createTicker(given = {}) {
  refuseUnknown(given, ["ticksPerSec", "maximumCatchUpTickCount"], "createTicker");
  const { ticksPerSec = 30, maximumCatchUpTickCount = 8 } = given;
  checkTicksPerSec(ticksPerSec, "ticksPerSec");
  let tickDurationMs = 1000 / ticksPerSec;
  let lastTickIndex = null;
  const ticker = {
    ticksPerSec,
    tickDurationSec: 1 / ticksPerSec,
    /** The step a time on the room's clock falls in. */
    tickIndexAt: (timeMs) => Math.floor(timeMs / tickDurationMs),
    /** When a step starts, on the room's clock. */
    tickStartMs: (tickIndex) => tickIndex * tickDurationMs,
    /**
     * The steps to run now, oldest first, given the room's clock: none while it's still the same step, and after
     * a long pause (a hidden tab) only the newest few, never thousands at once.
     */
    advance(nowMs) {
      const currentIndex = Math.floor(nowMs / tickDurationMs);
      if (lastTickIndex === null) lastTickIndex = currentIndex - 1;
      const firstIndex = Math.max(lastTickIndex + 1, currentIndex - maximumCatchUpTickCount + 1);
      const due = [];
      for (let tickIndex = firstIndex; tickIndex <= currentIndex; tickIndex += 1) due.push(tickIndex);
      lastTickIndex = Math.max(lastTickIndex, currentIndex);
      return due;
    },
    /** Takes another rate (the game server's, when it differs): counting starts again from now. */
    setTicksPerSec(nextTicksPerSec) {
      checkTicksPerSec(nextTicksPerSec, "ticksPerSec");
      ticker.ticksPerSec = nextTicksPerSec;
      ticker.tickDurationSec = 1 / nextTicksPerSec;
      tickDurationMs = 1000 / nextTicksPerSec;
      lastTickIndex = null;
    },
  };
  return ticker;
}

/**
 * A player's inputs, numbered. The game applies each at once (prediction), sends it, and keeps it here until the
 * server says it has applied it; when the server's state arrives, the game starts from that state and applies
 * the inputs still waiting again.
 */
export function createInputQueue(given = {}) {
  refuseUnknown(given, ["maximumWaitingCount"], "createInputQueue");
  const { maximumWaitingCount = 120 } = given;
  let nextInputNumber = 1;
  let waiting = [];
  return {
    /** Adds an input: answers it with its number, to send. Past maximumWaitingCount the oldest waiting one is dropped. */
    add(input) {
      const numbered = { inputNumber: nextInputNumber, input };
      nextInputNumber += 1;
      waiting.push(numbered);
      if (waiting.length > maximumWaitingCount) waiting.shift();
      return numbered;
    },
    /** The server has applied every input up to this number: they stop waiting. */
    acknowledge(inputNumber) {
      waiting = waiting.filter((numbered) => numbered.inputNumber > inputNumber);
    },
    /** The inputs the server hasn't answered yet, oldest first. */
    get waiting() {
      return waiting.slice();
    },
    get nextInputNumber() {
      return nextInputNumber;
    },
    /** Forgets every waiting input (a new match, a teleport the server made). */
    clear() {
      waiting = [];
    },
  };
}

/**
 * When to draw what someone else sends: a moment behind their newest snapshot, as little as their snapshots allow. It
 * watches how late each snapshot arrives and how far apart they are, and holds the moment drawn just far enough back
 * that a snapshot is almost always there to blend toward. When the connection worsens it slips back, and when it
 * steadies it catches up, both by running the drawn moment a little slower or faster than the clock: what's drawn
 * never stalls, jumps or goes backwards.
 */
export function createTimeline(given = {}) {
  refuseUnknown(given, ["minimumDelayMs", "windowDurationMs"], "createTimeline");
  const { windowDurationMs = 2000 } = given;
  let arrivals = [];
  let delayMs = null;
  let lastNowMs = null;
  const timeline = {
    /** The least it draws behind: a game may lower it for fights that need the freshest view, or raise it to smooth more. */
    minimumDelayMs: given.minimumDelayMs ?? 50,
    /** A snapshot taken at snapshotTimeMs on the room's clock arrived at arrivedAtMs. */
    noteArrival(snapshotTimeMs, arrivedAtMs) {
      arrivals.push({ snapshotTimeMs, latenessMs: arrivedAtMs - snapshotTimeMs, arrivedAtMs });
      while (arrivals.length > 2 && arrivals[0].arrivedAtMs < arrivedAtMs - windowDurationMs) arrivals.shift();
    },
    /** How far behind it should draw now: the latest a snapshot arrived lately, plus the widest gap between them. */
    targetDelayMs() {
      if (!arrivals.length) return timeline.minimumDelayMs;
      let latestMs = -Infinity;
      let widestGapMs = 0;
      arrivals.forEach((arrival, index) => {
        latestMs = Math.max(latestMs, arrival.latenessMs);
        if (index > 0) widestGapMs = Math.max(widestGapMs, arrival.snapshotTimeMs - arrivals[index - 1].snapshotTimeMs);
      });
      return Math.max(timeline.minimumDelayMs, latestMs + Math.min(widestGapMs, 250) + 5);
    },
    /** The moment on the room's clock to draw now. Call it with the room's clock each frame. */
    drawnAtMs(nowMs) {
      const targetMs = timeline.targetDelayMs();
      if (delayMs === null || lastNowMs === null) delayMs = targetMs;
      else {
        const elapsedMs = Math.max(nowMs - lastNowMs, 0);
        // Slipping back runs the drawn moment at three quarters speed; catching up at a tenth faster.
        delayMs = targetMs > delayMs ? Math.min(targetMs, delayMs + elapsedMs * 0.25) : Math.max(targetMs, delayMs - elapsedMs * 0.1);
      }
      lastNowMs = Math.max(nowMs, lastNowMs ?? nowMs);
      return nowMs - delayMs;
    },
    /** How far behind it draws now. */
    get delayMs() {
      return delayMs ?? timeline.targetDelayMs();
    },
    clear() {
      arrivals = [];
      delayMs = null;
      lastNowMs = null;
    },
  };
  return timeline;
}

/**
 * Snapshots of something that moves, blended between the two around the moment drawn (a timeline says which), so it
 * moves evenly however they arrive. mix(earlier, later, fractionNumber) blends two of them: fractionNumber 0 is earlier, 1 later, and
 * above 1 a short guess past later while the next snapshot is late.
 */
export function createSnapshotBuffer(given) {
  refuseUnknown(given, ["mix", "maximumExtrapolationMs", "keptDurationMs"], "createSnapshotBuffer");
  const { mix, keptDurationMs = 1000 } = given ?? {};
  if (typeof mix !== "function") refuse("mix_missing", "createSnapshotBuffer needs mix: how to blend two snapshots.", "mix", "Give mix(earlier, later, fractionNumber), answering the snapshot fractionNumber of the way from earlier to later.");
  let snapshots = [];
  const buffer = {
    /** How far past the newest snapshot it guesses while the next is late; 0 holds at the newest. Change it any time. */
    maximumExtrapolationMs: given.maximumExtrapolationMs ?? 0,
    /** Adds a snapshot taken at a time on the room's clock, in its place among the others; one at a time already held replaces it. */
    add(timeMs, snapshot) {
      const index = snapshots.findIndex((held) => held.timeMs >= timeMs);
      if (index === -1) snapshots.push({ timeMs, snapshot });
      else if (snapshots[index].timeMs === timeMs) snapshots[index] = { timeMs, snapshot };
      else snapshots.splice(index, 0, { timeMs, snapshot });
      const newestMs = snapshots[snapshots.length - 1].timeMs;
      while (snapshots.length > 2 && snapshots[1].timeMs < newestMs - keptDurationMs) snapshots.shift();
    },
    /** The snapshot to draw for a moment on the room's clock (a timeline's drawnAtMs): null before the first. */
    snapshotAt(drawnAtMs) {
      if (!snapshots.length) return null;
      if (drawnAtMs <= snapshots[0].timeMs) return snapshots[0].snapshot;
      const laterIndex = snapshots.findIndex((held) => held.timeMs >= drawnAtMs);
      if (laterIndex === -1) {
        // Past the newest: a short guess along the last two, then it holds.
        const later = snapshots[snapshots.length - 1];
        const earlier = snapshots[snapshots.length - 2];
        const pastMs = Math.min(drawnAtMs - later.timeMs, buffer.maximumExtrapolationMs);
        if (!earlier || pastMs <= 0) return later.snapshot;
        return mix(earlier.snapshot, later.snapshot, 1 + pastMs / (later.timeMs - earlier.timeMs));
      }
      const earlier = snapshots[laterIndex - 1];
      const later = snapshots[laterIndex];
      return mix(earlier.snapshot, later.snapshot, (drawnAtMs - earlier.timeMs) / (later.timeMs - earlier.timeMs));
    },
    /** The newest snapshot held, or null. */
    newest: () => (snapshots.length ? snapshots[snapshots.length - 1].snapshot : null),
    get snapshotCount() {
      return snapshots.length;
    },
    clear() {
      snapshots = [];
    },
  };
  return buffer;
}
