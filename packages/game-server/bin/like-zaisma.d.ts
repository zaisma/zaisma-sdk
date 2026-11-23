/** The exit code with which the runner asks the bench to start it again at once: its copy went over its memory, as on Zaisma. */
export const COPY_STARTED_AGAIN_EXIT_CODE: number;
/** Lets the game server's modules import only its own files, as on Zaisma's rooms. Called once, before it's imported. */
export function refuseOutsideModules(entryFile: string): void;
/** Counts every WebAssembly memory the game server makes or gets from its modules in memorySizeBytes. Called once, before it's imported. */
export function countWebAssemblyMemories(): void;
/** What the runner holds before the game server loads, for memorySizeBytes. */
export function memoryBaselineBytes(): number;
/** The game server's memory now, without baselineBytes: its heap and every ArrayBuffer. */
export function memorySizeBytes(baselineBytes: number): number;
/** The game server with each handler timed against Zaisma's CPU, per room, ending a room that goes past its limits. */
export function heldToZaismaLimits<T extends object>(
  gameServer: T,
  options: { print: (level: "warn" | "error", text: string) => void; onStart?: () => void; nowMs?: () => number; elapsedMs?: () => number; cpuMs?: () => number },
): T;
