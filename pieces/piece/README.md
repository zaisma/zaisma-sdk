# @zaisma/piece

How a JavaScript piece opens its settings and hooks, the same way in every piece. A piece states them once, in its `piece.json`; this reads that statement and gives a game the two things it changes a piece through. No dependencies, and the same in a browser and on a game server.

A game never needs to add it by name: it comes with any piece that needs it.

## In a piece

State the settings and hooks in `piece.json`:

```json
"needs": [{ "name": "@zaisma/piece", "version_range": "^1.0.0", "kind": "piece" }],
"settings": [
  { "name": "jump_height_m", "value_kind": "number", "default_value": 1.2, "minimum_number": 0, "maximum_number": 50, "maximum_character_count": null, "choices": null, "summary": "How high a jump reaches, in metres." }
],
"hooks": [
  { "name": "before_jump", "hook_kind": "decision", "summary": "Asked before each jump with its height in metres; answer another height to change it." },
  { "name": "landed", "hook_kind": "event", "summary": "Told when a jump ends, with the height it reached." }
]
```

List `piece.json.js` in `file_paths` and run `npx @zaisma/cli pieces check <the piece's folder> --fix`: it writes the statement as a module, so the code reads the one statement and never a second copy of it.

```js
import statement from "./piece.json.js";
import { openPiece } from "../piece/index.js"; // from a piece of another scope: "../../@zaisma/piece/index.js"

export function createJumper(given = {}) {
  const { settings, hooks, tell, ask, refuse } = openPiece(statement, given);

  function jump() {
    const heightM = ask("beforeJump", settings.get("jumpHeightM")); // the game may change it
    if (typeof heightM !== "number") refuse("bad_jump_height", { message: "beforeJump answered something that isn't a number.", field: "beforeJump", fix: "Answer a height in metres, or nothing." });
    // ... jump heightM high ...
    tell("landed", { heightM }); // the game hears of it
  }

  return { settings, hooks, jump };
}
```

- A **setting** is anything a game would turn: a number or integer with its range, `true` or `false`, one of a few choices, text, or a colour. Every setting can be changed while playing; what can only be given once is an argument of the create call instead.
- A hook is an **event** (`tell`: the piece says what happened) or a **decision** (`ask`: the piece proposes, and what the game answers is what happens; check the answer before using it).
- If a game would have to edit the piece to change something, the piece is missing a setting or a hook.

## In a game

Every piece made this way is changed the same way:

```js
const jumper = createJumper({ settings: { jumpHeightM: 2 }, hooks: { landed: () => playThud() } });

jumper.settings.set({ jumpHeightM: 12 }); // a super jump, turned up while playing
jumper.settings.get("jumpHeightM"); // 12
jumper.settings.list(); // every setting: what it takes, its default, what it is now
const stop = jumper.hooks.on("beforeJump", (heightM) => (isOnMoon ? heightM * 6 : heightM));
```

Names are the statement's in JavaScript's style: `jump_height_m` is `jumpHeightM`. A setting or hook the piece doesn't have is refused with a `PieceError` whose `fix` lists the ones it does; so is a value outside what a setting takes.

`index.d.ts` is the reference. How pieces work: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md). MIT licensed.
