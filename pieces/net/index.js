// The networking core, in a player's game: one room carries every kind of sync the game uses (characters, objects,
// events, turns), each piece saying what it shares and never how, the same on Zaisma's relay, on a game server in
// Zaisma's rooms, and on that game server run on a developer's own machine. The reference is index.d.ts. MIT licensed.
export { createNet } from "./core.js";
export { defineKind } from "./kinds/define.js";
export { charactersKind } from "./kinds/characters.js";
export { eventsKind } from "./kinds/events.js";
export { objectsKind } from "./kinds/objects.js";
export { turnsKind } from "./kinds/turns.js";
export { defineShape } from "./shape.js";
export { createInputQueue, createSnapshotBuffer, createTicker, createTimeline } from "./timing.js";
export { PieceError } from "../piece/index.js";
