# @zaisma/net

The online core. One room carries every kind of sync a game uses: **characters**, **objects**, **events** and **turns**. Each piece says what it shares, never how, and the same game code runs on Zaisma's relay (no server code), on a game server in Zaisma's rooms, and on that game server run on your own machine. Only one word changes between them.

```
npx @zaisma/cli pieces add @zaisma/net
```

## In the game

```js
import { createNet, charactersKind, eventsKind, objectsKind, turnsKind } from "./pieces/@zaisma/net/index.js";
import { walker } from "./walker.js";

const room = await Zaisma.joinRoom();
const net = createNet(room);                 // with a game server: createNet(room, { authorityKind: "server" })
const characters = net.use(walker);
const objects = net.use(objectsKind());
const events = net.use(eventsKind({ eventNames: ["emote"] }));
const turns = net.use(turnsKind());

function frame() {
  characters.setInput({ moveX: stick.x, yaw: camera.yaw, jump: buttons.justPressed("jump") });
  net.update();                              // every frame: runs the fixed steps that are due
  for (const characterId of characters.ids()) drawCharacter(characterId, characters.drawn(characterId));
  requestAnimationFrame(frame);
}
```

## What a character shares

A character module declares what a character shares and how it moves in one fixed step. It never says how it's sent:

```js
// walker.js
export const walker = charactersKind({
  stateFields: [
    { name: "x", valueKind: "number", minimumNumber: -500, maximumNumber: 500, stepSizeNumber: 0.001, snapAboveNumber: 3 },
    { name: "y", valueKind: "number", minimumNumber: -100, maximumNumber: 500, stepSizeNumber: 0.001, snapAboveNumber: 3 },
    { name: "upSpeedMPerSec", valueKind: "number", minimumNumber: -60, maximumNumber: 60, stepSizeNumber: 0.001 },
    { name: "yaw", valueKind: "angle" },
    { name: "isGrounded", valueKind: "boolean", defaultValue: true },
    { name: "animation", valueKind: "choice", choices: ["idle", "run", "jump"] },
  ],
  inputFields: [
    { name: "moveX", valueKind: "number", minimumNumber: -1, maximumNumber: 1 },
    { name: "yaw", valueKind: "angle" },
    { name: "jump", valueKind: "press" },
  ],
  step(state, input, { tickDurationSec }) {
    // move by the input, from the state alone: no clock, no random numbers
    return state;
  },
});
```

From that the core does what Shieldbreak's netcode proved:

- **With a game server, the server is the word.** Each player's own character moves at once from their input; when the server's word arrives the game starts from it and replays what the server hasn't answered, and anything that was off eases away (`correctionSmoothingSec`) instead of jumping. Both sides keep the state on the same steps, so a game that ran the same inputs as the server is never corrected at all.
- **The server never runs a player faster than time,** however many inputs they send; it takes them one a step behind a buffer as deep as their arrival's jitter, catches up a backlog, keeps a character moving through a short stall, and never loses a press.
- **Everyone else's characters are drawn a moment behind, blended,** as little behind as their snapshots' lateness allows (`minimumInterpolationDelayMs`): never stalling, jumping or going backwards.
- **Fair hits:** the server keeps half a second of where everyone was; `stateAt(targetId, viewTimeMs(attackerId))` is where the attacker saw the target.
- **On the relay,** each player's game is the word on its own character and the host's on the bots, handed to the next host when it leaves.

## Objects, events, turns

```js
objects.create("ball", { x: 0 });                                  // this player owns it
objects.set("ball", { x: 2 }, { delivery: "latest_only" });        // only its owner may; every frame is fine
objects.on("changed", (object) => moveBall(object.properties));

events.send("emote", { name: "wave" });
events.on("emote", (payload, fromPlayerId) => showEmote(fromPlayerId, payload.name));

turns.on("changed", (turnsNow, reason) => showTurn(turnsNow.turnPlayerId, turnsNow.deadlineMs));
turns.move({ column: 3 });                                          // in this player's turn; whoever's in charge checks it
```

A late joiner gets every object and the turns as they are; a leaver's objects are removed or handed on (`objectsOwnerLeftMode`) and their turn passes.

## With a game server

`pieces add` puts the server half in `zaisma-server/pieces/@zaisma/net/`. Give it the same kinds; a game's own declaration (`walker.js`) is copied into `zaisma-server/` too, since players never get its files:

```js
// zaisma-server/index.js
import { defineNetServer, eventsKind, objectsKind } from "./pieces/@zaisma/net/server.js";
import { walker } from "./walker.js";

export default defineNetServer({
  kinds: [walker, objectsKind(), eventsKind({ eventNames: ["emote"] })],
  ticksPerSec: 30,
  hooks: { beforeObjectChange: (isAllowed, { changes }) => isAllowed && !(changes?.x > 100) },
  onTick(state, tickDurationSec, room) {
    const characters = walker.onServer(state, room);
    for (const characterId of characters.ids()) if (characters.state(characterId).y < -20) characters.set(characterId, { x: 0, y: 2 });
  },
});
```

It's plain game server code, so it runs the same in Zaisma's rooms, in `npx @zaisma/cli play-locally`, and on your own server.

## Settings and hooks

Opened like every piece's ([`@zaisma/piece`](../piece)): `net.settings.set({ snapshotsPerSec: 30 })` while playing, `net.hooks.on("characterCorrected", ...)`. With a game server, the server's own settings rule the room. `index.d.ts` lists each with what it does.

**A kind of your own** is made with `defineKind`, from the same parts: `defineShape`, `createTicker`, `createInputQueue`, `createTimeline` and `createSnapshotBuffer`.

`index.d.ts` and `server.d.ts` are the reference. How pieces work: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md). MIT licensed.
