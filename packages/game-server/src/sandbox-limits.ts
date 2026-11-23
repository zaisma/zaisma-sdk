import { GAME_SERVER_LIMITS } from "./room.ts";

/**
 * How Zaisma's rooms hold a game server to its limits, and what its logs say when it goes past one. Zaisma's rooms
 * (apps/rooms) and play-locally's runner (bin/like-zaisma.js) share these, so a game server that fails on Zaisma fails
 * the same way on the developer's computer first, with the same line in its logs.
 */

/** A real-time room's ticks go to the game server this many to a call, sharing its CPU (30 x 50 ms). */
export const GROUPED_TICK_COUNT = 30;
/**
 * Calls past their CPU within OVER_BUDGET_WINDOW_MS that stop the game server and end the match, like one that keeps
 * failing (Julius, Nov 13, 2026: the 50 ms a tick has is a budget the room keeps, with Cloudflare's own stop at about
 * 2 s as the backstop).
 */
export const OVER_BUDGET_CALL_COUNT = 20;
export const OVER_BUDGET_WINDOW_MS = 60_000;
/** Where Cloudflare itself stops a call, whatever CPU it was given. */
export const CALL_STOP_CPU_DURATION_MS = 2000;
/** How often a real-time room copies its state (never while a copy is under way): a fresh copy of the game server carries on from the last one. */
export const STATE_COPY_INTERVAL_MS = 5000;
/** Stops in a row (a call stopped, the sandbox failing) after which the room gives up on the game server. */
export const FAILURE_COUNT = 2;


/** A call stopped for running too long. */
export const CALL_STOPPED_TEXT = "Ran on too long and was stopped, like a loop that never ends";

/** What the room tells players when it gives up on the game server. */
export const GAME_SERVER_STOPPED_TEXT = "This game's server stopped working.";

/** Too many calls past their CPU in a minute: the game server stops and the match ends. */
export function overBudgetText(overBudgetCallCount: number): string {
  return `Zaisma: ${overBudgetCallCount} calls in the last minute took more than their CPU (${GAME_SERVER_LIMITS.maximumCallCpuDurationMs} ms a tick, shared by the up to ${GROUPED_TICK_COUNT} ticks a call carries), so the game server stopped and the match ended. Keep each tick under ${GAME_SERVER_LIMITS.maximumCallCpuDurationMs} ms: spread big work over several ticks.`;
}

/**
 * The copy of the game server running the room started again, empty: what it kept in its own variables is gone, and the
 * room carries on from its state. memorySizeBytes is what the copy held when it's known to have gone over its memory,
 * 0 when it went over by an amount nobody measured, and null when the cause isn't known.
 */
export function copyStartedAgainText(memorySizeBytes: number | null): string {
  const carriedOn = `what it kept in its own variables, outside the room's state, is gone. The room carried on from its last state (a real-time room's as of its last copy, taken every ${STATE_COPY_INTERVAL_MS / 1000} seconds), with no onRestored.`;
  if (memorySizeBytes === null) return `Zaisma: this copy of the game server started again, so ${carriedOn} A copy starts again when it goes over its ${GAME_SERVER_LIMITS.maximumMemorySizeBytes / 1024 / 1024} MB of memory, after a while unused, and for Zaisma's own updates.`;
  const held = memorySizeBytes > 0 ? ` (it held ${Math.round(memorySizeBytes / 1024 / 1024)} MB)` : "";
  return `Zaisma: the game server went over its ${GAME_SERVER_LIMITS.maximumMemorySizeBytes / 1024 / 1024} MB of memory${held}, data files included, so its copy started again and ${carriedOn} Keep less in memory: load only what a match uses, and drop a room's entry when its match ends.`;
}
