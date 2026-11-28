<!-- Made by scripts/build-skill.mjs: never edit it by hand. -->

# Pieces

A piece is a shared building block a game is made from or with: a body that already walks, input for every device, save and load, a sky, online play, a pack of footsteps, a skill for the AI that builds the game. A game adds the pieces it wants and spends its effort on what makes it its own. Every piece is optional, and no game is locked into any of them.

Pieces are open. Anyone publishes one, for any engine or kind of game. Zaisma's own are added, updated and checked exactly as a stranger's are: nothing in the command knows any piece, standard or publisher by name. Zaisma's are MIT licensed, in [`pieces/`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces).

This page is the frame every piece stands on: what a piece states about itself, how it's added to a game, how its versions move, how its settings and hooks are opened, and how one is published to [Zaisma's marketplace](#the-marketplace), where developers share and rate them.

## The kinds

A kind is how a piece arrives and what it may hold, never only a label.

| Kind | What it is | How it arrives |
| --- | --- | --- |
| `foundation` | A standard everything else fits: a skeleton, a body, input, save and load, lighting, a networking core. | Added to a game, and moved by version. |
| `extension` | Plugs into one foundation: a kind of sync, a camera style, a way to move, an ability. | Added to a game, and moved by version. |
| `game_system` | A genre's part: a round timer, a combo counter, an inventory. | Added to a game, and moved by version. |
| `template` | A genre's systems wired together, with no style of their own. | Copied into a game once, and then the game's own. |
| `pack` | Images, models and sounds, as a folder in its maker's own structure. | Added to a game, and moved by version. |
| `preset` | Values for another piece or a tool: a way to move, a look, a mix. | Added to a game, and moved by version. |
| `skill` | Instructions for a developer's AI. Always under an open licence, text all through, and read in full before anyone gets it. | Fetched for the AI (`pieces get`); a game never holds one. |
| `tool` | Something a developer runs on their own computer. Open or closed source, as its maker chooses. | Fetched to the developer's computer (`pieces get`); a game never holds one. |

The first four are the layers a game's own code is built from: each is built on a standard, and all but a template open settings and hooks. What people call a module is an extension or a game system.

## Standards

Every foundation, extension, game system and template names the **standard** it's built on, so pieces made to fit one set of foundations are never mistaken for pieces made to fit another. A pack, preset, skill or tool names one when it's made for one (a model pack rigged to a skeleton), and gives `null` when it fits anywhere. A standard is whatever its keeper says it is: a set of foundations for three.js, a base for Godot, a skeleton alone.

A standard's name is a name on npm, like `@studio/standard`. Two makers' standards can never share a name, and whoever holds the name on npm keeps the standard. A piece built on someone else's standard names it the same way; a small standard can be one piece, named after itself. Zaisma's are in [Zaisma's pieces](#zaismas-pieces): one standard among any that people publish.

Adding a piece built on a standard the game didn't have says so, plainly. Nothing stops it: a game chooses its pieces.

## Adding pieces to a game

```
npx @zaisma/cli pieces add @studio/dash-move          # by its name, the newest version
npx @zaisma/cli pieces add @studio/dash-move@^1.2     # or the newest within a range
npx @zaisma/cli pieces add ./my-piece                 # a piece's folder
npx @zaisma/cli pieces add ./my-piece-1.0.0.tgz       # or the .tgz that npm pack makes of it
npx @zaisma/cli pieces add @studio/dash-move --dry-run  # what it would bring, changing nothing
npx @zaisma/cli pieces                                # what the game has
```

Run them in the game's folder (the one with its `index.html`, or its source for a game that's built), or give `--folder`. Each takes `--json`.

**Where a name is looked up.** With `ZAISMA_KEY` set, on [Zaisma's marketplace](#the-marketplace) first, then on npm; with no key, on npm alone. The game's record keeps where each piece came from (`source_kind`), and a later `pieces update` asks the same place. A skill or a tool is never added to a game: `pieces get` fetches it.

A piece's files go in `pieces/<name>/` with its `piece.json`, its game server files (when it has any) in `zaisma-server/pieces/<name>/`, where a game server on Zaisma can import them and players are never served them, and the game's record of its pieces in `pieces/pieces.json`. Commit all three.

**What adding does, always:**

- **What a piece needs is stated, and comes with it.** Every piece states what it needs and which versions it accepts; adding brings what's missing, and says what it brought.
- **Never a second copy.** A piece the game already has, at a version the new piece accepts, is left exactly as it is.
- **Never moved by itself.** A piece changes version only when you run `pieces update` for it.
- **A clash stops everything, plainly.** When the game has a version the new piece doesn't accept, nothing is added, and the error (`piece_version_clash`) says both versions and the two ways out: move the one in the game, or use a version of the new piece that accepts it. Two pieces being added that need versions of the same thing with no overlap stop the same way.
- **A library isn't doubled either.** A piece may need a library that isn't a piece (three.js). A game that has it in its own `package.json` uses its own; one outside the accepted range is a clash like any other. A game without it gets the library's browser files in `pieces/<library>/`, and the command prints the import map its page needs.
- **An engine is stated, never brought.** A piece for an engine that isn't a library on npm (Godot) says which versions it needs; the command says so and leaves the engine to the game.
- **A piece's code is never run.** Adding copies the files a piece lists and nothing else: no install scripts, no links, no path outside the game's folder. A piece from npm is checked against npm's own hash of it first, and one from Zaisma's marketplace file by file against the hashes its version lists.

**Using one:** import it from where it was added, as the command prints:

```js
import { createDash } from "./pieces/@studio/dash-move/index.js";
```

Each piece's `index.d.ts` is its reference, with every call, setting, hook and error explained, and its `README.md` shows it in use. An AI reads those two and never needs the piece's insides. `zaisma pieces --json` answers every piece's settings and hooks too.

**A page with no bundler** needs an import map before its scripts when a piece brought a library, so the pieces find it. `zaisma pieces` prints it:

```html
<script type="importmap">{"imports":{"three":"./pieces/three/build/three.module.js"}}</script>
```

**Uploading:** `zaisma check` and `zaisma upload` leave every `.d.ts` out of what they check and send, since type files never run. Uploading through the MCP's `upload_files`, leave them out the same way.

## Moving a version

```
npx @zaisma/cli pieces newer                              # what has a newer version where it came from, and what holds it back
npx @zaisma/cli pieces update @studio/dash-move           # move one to the newest
npx @zaisma/cli pieces update @studio/dash-move --version "^1.4"
npx @zaisma/cli pieces update @studio/dash-move --from ./dash-move-1.5.0.tgz   # one that didn't come from npm
npx @zaisma/cli pieces remove @studio/dash-move
```

- **A version moves when the game chooses,** one piece at a time: `pieces update` moves the piece named and nothing else. What its new version needs and the game lacks is brought; a piece the game has that it no longer accepts is a clash, with the ways out.
- **Only when everything else accepts it.** If another piece in the game needs a range the new version is outside, nothing moves, and the error names that piece. `pieces newer` shows this before you try: the newest version, the newest the rest of the game accepts, and which pieces hold it back.
- **Removing** takes one piece out, unless another needs it (`piece_still_needed`). What it needed stays: the answer names what no piece needs any more, for you to remove or keep.
- **A template is the game's own** once copied: it has no version to move and nothing to remove, and it no longer holds the versions of the pieces it brought.

## Settings and hooks

**A piece is never edited by a game.** Everything a game would change is a setting or a hook, so the piece can move to a newer version and keep the game's changes. A super jump is a setting turned up while playing. If a game would have to copy a piece to change it, the piece is missing a hook: tell its maker.

Every piece states its settings and hooks in its `piece.json`, so they're read without opening its code:

- A **setting** is a number or an integer with its range, `true` or `false`, one of a few choices, text, or a colour, with a default. Every setting can be changed while playing.
- A **hook** is a point where the piece calls the game's code. An `event` tells the game something happened. A `decision` asks the game before something happens, and what the game answers is what happens.

Pieces written in JavaScript open them the same way, through [`@zaisma/piece`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/piece): a create call takes `{ settings, hooks }` beside its own arguments and gives back an object with `settings` and `hooks` on it.

```js
const dash = createDash({ settings: { dashSpeedMPerSec: 18 }, hooks: { dashed: () => playWhoosh() } });

dash.settings.set({ dashCooldownSec: 0.2 });                  // while playing
dash.settings.get("dashCooldownSec");                         // 0.2
dash.settings.list();                                         // every setting: what it takes, its default, what it is now
dash.hooks.on("beforeDash", (dashDistanceM) => (isSlowed ? dashDistanceM / 2 : dashDistanceM));
```

In code a name is in the language's own style (`dash_speed_m_per_sec` is `dashSpeedMPerSec` in JavaScript). A setting or hook the piece doesn't have is refused, with the ones it does have in the error's `fix`; so is a value outside what a setting takes.

**What a piece keeps.** A piece that has something of the player's to bring back next time (the controls they rebound, how fast they like the view to turn) says so with `kept`, which `@zaisma/piece`'s `openKept` opens from the settings that are the player's own choices and any state of its own. Any save keeps it beside the game's progress and gives it back when the game opens: the game names the piece and handles nothing else.

```js
const save = await openSave({ saveFormatVersionNumber: 1, defaults: { level: 1 }, keptPieces: [input] });
```

A kept setting is kept only once it differs from what the game made the piece with, so a game that changes its own default later still reaches every player who never changed it. What a piece keeps carries its own format number: a record from a newer version of the piece is kept as it is, never read and never lost, and so is one of a piece the game no longer keeps.

`zaisma pieces` marks a piece whose files were changed by hand, and `pieces update` and `pieces remove` refuse to lose the edits until you say `--discard-edits`.

## Zaisma's pieces

| Piece | Kind and standard | Gives | Needs |
| --- | --- | --- | --- |
| `@zaisma/piece` | `foundation`, its own small standard `@zaisma/piece` | How a JavaScript piece opens its settings and hooks, and what it keeps between plays, the same in every piece, in a browser and on a game server. A game never adds it by name: it comes with any piece that needs it. | nothing |
| [`@zaisma/net`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/net) | `foundation`, on `@zaisma/standard` | The online core: kinds of sync for characters, objects, events and turns, sharing one room. A piece says what it shares (a character's fields and how it moves a step), never how; the same game runs on Zaisma's relay, with a game server in Zaisma's rooms, and on that game server on your own machine, changing one word. With a game server, a player's own character moves at once and the server's word eases in; everyone else's are drawn smoothly a moment behind; hits can be judged by what the attacker saw. | `@zaisma/piece` |
| [`@zaisma/input`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/input) | `foundation`, `@zaisma/standard` | Input for every device: keyboard and mouse, touch (a stick, a drag to look and a button for each action, drawn for it) and gamepads, read as the actions a game names, where the player moves and how far they turn the view in radians. Prompts as each device names its buttons, a controls screen's rebinding, and rumble. It keeps the player's rebound controls and their own choices among its settings for a save. | `@zaisma/piece` |
| [`@zaisma/save`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/save) | `foundation`, `@zaisma/standard` | Save and load: a game's progress and what each of its pieces keeps of its own, written shortly after a change and at once as the game closes, older saves upgraded, and never written over when it changed elsewhere. Kept in the browser (on Zaisma it follows a signed-in player to every device) or on the game's own game server, the same on Zaisma's rooms and on your own server, with the later of two devices' progress winning. | `@zaisma/piece` |
| [`@zaisma/lighting`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/lighting) | `foundation`, `@zaisma/standard` | Lighting and sky for three.js: a sky with sun, moon, stars and clouds, sunlight whose shadows follow the player, fill light, reflections and fog that match it (glowing warm toward a low sun, and pooling low as ground fog), all set by the time of day, which can run on its own. Night stays playable, every colour can be changed while playing, and its quality fits the device, stepping down while frames run slow. The sky's numbers have no engine, for another engine to follow. | `@zaisma/piece`, the library `three` |
| [`@zaisma/lighting-effects`](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/lighting-effects) | `extension` of the lighting, `@zaisma/standard` | Camera effects: bloom on bright things, colour grading with named moods (vivid, warm, cool, faded, moody, noir, dreamy, or a game's own), sun rays, and soft shade in corners on PCs only. Each is off until a game turns it on and has its own level per device; auto levels follow the lighting's quality and drop on slow frames, so a phone keeps its frame rate. | `@zaisma/lighting`, `@zaisma/piece`, the library `three` |

Zaisma's foundations are built on the standard `@zaisma/standard`; the skeleton and its animation names are a small standard of their own, `@zaisma/skeleton`, so another maker's standard can build on just that.

## Making a piece

A piece is a folder with a `piece.json` at its top, its statement: what it is, the standard it's built on, what it needs, and its settings and hooks. The command, and anything else that lists pieces, reads only this.

```json
{
  "statement_version_number": 1,
  "name": "@studio/dash-move",
  "piece_version": "1.0.0",
  "kind": "extension",
  "standard": "@studio/standard",
  "summary": "A dash for the character: a burst of speed with a cooldown.",
  "license": "MIT",
  "entry_path": "index.js",
  "server_entry_path": null,
  "file_paths": ["index.js", "index.d.ts", "piece.json.js", "README.md", "LICENSE.txt"],
  "server_file_paths": [],
  "needs": [
    { "name": "@studio/body", "version_range": "^1.0.0", "kind": "piece" },
    { "name": "@zaisma/piece", "version_range": "^1.0.0", "kind": "piece" },
    { "name": "three", "version_range": ">=0.160.0 <1.0.0", "kind": "library" }
  ],
  "settings": [
    { "name": "dash_speed_m_per_sec", "value_kind": "number", "default_value": 14, "minimum_number": 1, "maximum_number": 60, "maximum_character_count": null, "choices": null, "summary": "How fast a dash moves the character." },
    { "name": "dash_cooldown_sec", "value_kind": "number", "default_value": 1.5, "minimum_number": 0, "maximum_number": 30, "maximum_character_count": null, "choices": null, "summary": "How long before the character can dash again." }
  ],
  "hooks": [
    { "name": "before_dash", "hook_kind": "decision", "summary": "Asked before each dash with its distance in metres; answer another distance to change it, or 0 to stop it." },
    { "name": "dashed", "hook_kind": "event", "summary": "Told when a dash ends." }
  ]
}
```

### What a piece states

Every field is there every time, and an unknown one is refused, so a typo never passes quietly.

| Field | What it holds |
| --- | --- |
| `statement_version_number` | The format this file is written in: `1`. A command that meets a higher number says to run the newest command instead of guessing. |
| `name` | The piece's name, as npm takes them. |
| `piece_version` | Its version: three numbers, like `1.0.0`. Follow semver: a change that breaks games raises the first number. |
| `kind` | `foundation`, `extension`, `game_system`, `template`, `pack`, `preset`, `skill` or `tool` ([The kinds](#the-kinds)). |
| `standard` | The standard it's built on, by its name on npm ([Standards](#standards)); `null` only for a pack, preset, skill or tool built on none. |
| `summary` | A sentence or two on what it gives a game, up to 400 characters. |
| `license` | The licence it's under, as SPDX names it: `MIT`, `Apache-2.0`, `CC0-1.0`. A piece whose source is closed gives `UNLICENSED`, or `LicenseRef-<name>` for terms of its maker's own. A skill is always under an open one. |
| `entry_path` | The file to start from: for a layer, the one a game imports (`null` with only game server files); for a skill, `SKILL.md`, the file an AI reads first; for a preset or a tool, its main file or `null`; for a pack, `null`. |
| `server_entry_path` | The file a game server imports; `null` for a piece with no game server files. |
| `file_paths` | Every file a game gets, each by its path inside the piece: forward slashes, nothing hidden (no part starting with a dot) and nothing in `node_modules`. The `piece.json` always comes too and isn't listed. A template's are copied into the game's own folder. |
| `server_file_paths` | Every file a game server gets. A file both sides share is listed in both. Empty for a template, whose game server files are the game's own, under `zaisma-server/` in `file_paths`. |
| `needs` | What it needs: each `{ name, version_range, kind }`. |
| `settings` | Its settings: each `{ name, value_kind, default_value, minimum_number, maximum_number, maximum_character_count, choices, summary }`. Empty for anything but a foundation, an extension or a game system. |
| `hooks` | Its hooks: each `{ name, hook_kind, summary }`. Empty the same way. |

**A need** is `{ name, version_range, kind }`. `version_range` is a semver range like `^1.0.0`, `>=0.160.0 <1.0.0` or `1.x || 2.x`. `kind` says what it is:

| Need `kind` | What it is |
| --- | --- |
| `piece` | Another piece, by its name. Brought when the game lacks it. |
| `library` | A library on npm that isn't a piece. The game's own is used when its `package.json` has one; else its browser files are brought. |
| `engine` | An engine that isn't a library on npm, by its name in lowercase (`godot`). Stated to the developer, never brought or checked. |

**A setting** names what it holds and its unit, in lowercase with underscores ([`docs/NAMING.md`](naming.md)): `jump_height_m`, `shadows_enabled`. Its `value_kind` says what it takes, and the fields that don't apply to that kind are `null`:

| `value_kind` | `default_value` | Also given |
| --- | --- | --- |
| `number` | a number | `minimum_number` and `maximum_number`: every number has a range |
| `integer` | a whole number | `minimum_number` and `maximum_number` |
| `boolean` | `true` or `false` | |
| `choice` | one of `choices` | `choices`: 2 to 50 lowercase words |
| `text` | text | `maximum_character_count` |
| `color` | six hex digits in lowercase, like `"#3fa9f5"` | |

A setting can be changed while playing. What can only be given once, when the piece is made, is an argument of its create call instead, explained in its reference.

**A hook** is `{ name, hook_kind, summary }`, `hook_kind` being `event` (the piece tells the game) or `decision` (the piece asks, and the game's answer is what happens). What a hook is called with is in the piece's reference.

### Its code

What makes a piece good to build on:

- **Files that run as they are,** with no build step. In JavaScript: plain ES modules that import the piece's own files, its needs, and nothing else.
- **Needs imported from where a game has them.** A game holds `@studio/dash-move` at `pieces/@studio/dash-move/`, so from there a piece of the same scope is `../body/index.js`, one of another scope `../../@zaisma/piece/index.js`, and one with no scope `../../round-timer/index.js`. A library is imported by its name (`three`).
- **One statement.** A JavaScript piece reads its own settings and hooks from `./piece.json.js`, the statement as a module, and opens them with `@zaisma/piece` (its [README](https://github.com/zaisma/zaisma-sdk/blob/main/pieces/piece/README.md) shows how). List `piece.json.js` in `file_paths`; `zaisma pieces check <folder> --fix` writes it from `piece.json`, and a piece whose two disagree is refused.
- **An `index.d.ts`** with every call, setting, hook and error explained and an example: it's what an AI reads.
- **Closed inputs and plain errors:** an unknown setting or argument is refused, and every error has a stable `code`, the `field` at fault and a `fix`.
- **Names that say what they hold** ([`docs/NAMING.md`](naming.md)).
- **No file without an extension** in a piece for a game whose folder is uploaded as it is: Zaisma's upload takes none, so a licence travels as `LICENSE.txt`.

### Check and publish

```
npx @zaisma/cli pieces check ./my-piece          # before publishing
npx @zaisma/cli pieces check ./my-piece --fix    # and write piece.json.js again from piece.json; for a pack, list its folder's files in file_paths
```

The check reads the statement and the files it lists, and runs nothing. It ends with exit code 6 when the piece wouldn't add or would break in a game:

| Problem | Kind | What it found |
| --- | --- | --- |
| `bad_piece_statement` | refused | The piece.json isn't one: the message names the field. |
| `piece_statement_newer` | refused | The piece.json is written for a newer command than this one. |
| `missing_file` | refused | The piece.json lists a file that isn't there, or the file is a link. |
| `stale_statement_module` | refused | piece.json.js isn't piece.json as a module any more; --fix writes it again. |
| `package_disagrees` | refused | The package.json beside it has another name or version, or leaves a listed file out of what npm packs. |
| `unlisted_import` | refused | A file imports a file of the piece's own that the piece.json doesn't list, so a game wouldn't get it. |
| `undeclared_need` | refused | A file imports another piece or a library that isn't in needs. |
| `forbidden_file` | refused | A file is a program for Windows, macOS or Linux, a shell script, an archive or a PDF, which Zaisma's marketplace takes in no piece, as in no game. |
| `file_mislabeled` | refused | A pack's or preset's file isn't what its name says: its bytes are another kind of file. Zaisma's marketplace refuses it. |
| `skill_file_not_text` | refused | A skill's file isn't text: a skill is read in full before anyone gets it. |
| `contains_code` | note | A pack or preset holds a file that can run, can point at a script, or can't be seen through, so the marketplace marks it Contains code, never No code. |
| `file_not_uploadable` | note | A file is of a type Zaisma's upload doesn't take, so a game whose folder is uploaded as it is can't hold the piece. |
| `no_reference` | note | The file a game imports has no .d.ts beside it: it's what an AI reads to use the piece without opening its code. |
| `no_readme` | note | There's no README.md among the piece's files. |

Publish it to [Zaisma's marketplace](#the-marketplace) with `zaisma pieces publish`, to npm with `npm publish` (its `package.json` giving the same name and version as its `piece.json` and packing every file it lists), or both; anyone adds it by name. A piece that's on neither is added from its folder or its `.tgz`.

## The marketplace

Zaisma's marketplace (zaisma.com/marketplace) is where developers publish, share and rate pieces of every kind. It reads a piece's statement and never keeps a second one: what a listing says a piece is, is what its `piece.json` says. Zaisma's own pieces are listed and rated like anyone's.

```
npx @zaisma/cli pieces publish ./my-piece                       # its own check, its files, then Zaisma's checks
npx @zaisma/cli pieces publish ./my-piece --visibility listed   # and put it in the marketplace's lists
npx @zaisma/cli pieces search footsteps --kind pack             # find pieces, the best rated first
npx @zaisma/cli pieces get @studio/level-notes                  # fetch a skill or a tool
```

Each needs `ZAISMA_KEY`. A developer's AI does the same through the MCP: `publish_piece`, `search_pieces`, `get_piece`, `read_piece_file` ([`docs/DEVELOPER-API.md`](DEVELOPER-API.md#the-developer-marketplace)).

- **Private first.** A new piece is `private`: only its maker fetches it, which is all a studio sharing pieces between its own games needs. `unlisted` opens it to anyone who has its name; `listed` puts it in the marketplace's lists.
- **A version never changes.** Raise `piece_version` for the next one. A game moves to it only when it chooses (`pieces update`).
- **Names.** A scope (`@studio`) belongs to the first developer to publish under it on Zaisma; `@zaisma` is Zaisma's own.
- **What a piece needs** shows on its listing from its own statement: each need with the versions it accepts, a link to its own listing, and the newest version there the range accepts. Zaisma says a piece fits a version only when it ran the two together; everything else says Not tested, never a guessed Fits.
- **A test game.** A listing can link one of its maker's games that uses the piece, to try before using it.
- **Pictures of its own.** A listing can carry a cover and a gallery its maker made (see A listing's pictures).
- **Looking before getting.** A listing shows every picture, sound and 3D model inside the piece, to look at, hear and turn (see Looking before getting).
- **Ratings.** A like or a dislike, one per developer, anonymous. Good pieces rise in the marketplace's order and poor ones sink.
- **Copyright.** As everywhere on Zaisma, a piece stays up until it's reported: Zaisma doesn't guess whether something was copied (zaisma.com/legal/copyright).

### A listing's pictures

A piece's listing can show pictures its maker made: a **cover**, which the marketplace's lists show and the listing shows first, and up to 8 **gallery pictures**: the piece itself, an art pack's own cover art, or the piece in use in a game. Keep them in the piece's folder under `listing/`, and `pieces publish` makes the listing show exactly those:

```
my-pack/
  piece.json
  textures/oak.png …           the piece: what piece.json lists in file_paths
  listing/
    cover.png                  the cover (.png, .jpg, .jpeg or .webp)
    gallery/
      1-in-a-level.png         gallery pictures, in name order
      2-close-up.jpg
```

- **They're the listing's, never the piece's.** No statement lists them (`pieces check --fix` leaves `listing/` out of a pack's `file_paths`), nothing that adds the piece to a game gets them, and they stay as versions change.
- **What the folder doesn't say stays as it is.** No `listing/` folder changes nothing. No cover file leaves the cover; no `listing/gallery/` folder leaves the gallery. A gallery picture the folder no longer has is taken away.
- **Sizes.** A PNG, JPEG or WebP, at least 1280 by 720 px (a cover landscape, 16:9 shows best; 2560 by 1440 shows sharp on the largest screens), up to 10 MB.
- **Checked.** Each is matched against known abuse material before it's kept. A picture Zaisma doesn't take never fails the publish: the command says which and why, and `--json` answers `listing_pictures`, each `{ path, kind, picture_status, problem }` with `picture_status` `sent`, `kept`, `removed` or `refused`.

A developer's AI does the same with `add_piece_image` and `remove_piece_image`.

### Looking before getting

A listing shows what's inside a piece's newest version, so a pack is judged by its own files and not by its cover alone:

- **Pictures** (PNG, JPEG, WebP, GIF, AVIF, BMP, ICO, SVG) open whole in a viewer that steps through them.
- **3D models** (glTF as `.glb`, `.gltf` or `.vrm`; OBJ; STL) turn in a viewer: drag to turn, scroll or pinch to zoom. It draws every mesh where its scene puts it, with its base colour, its base colour picture and its vertex colours. It doesn't run animation (a rigged model stands in its bind pose), and it says so when a model's shapes are packed with Draco or Meshopt, which it can't open. A `.gltf` reads its `.bin` and its pictures from beside it in the piece.
- **Sounds** (Ogg, MP3, WAV, FLAC, M4A, AAC) play from their rows.
- Every other file is named and nothing more: text, data, code, and formats no browser shows (FBX, PSD, TIFF, MIDI).

Nothing a maker does turns this on: it's every such file of the newest version that passed its checks. The files come as they're stored from the game domain's own address for pieces, apart from zaisma.com and from every game, and that address answers only what can't run: never a script, a page or text, whatever a piece holds. A model's viewer is Zaisma's own page, framed from there, and runs nothing from the model. Anyone who can see a listing sees its previews; a private piece's open only for its maker, through an address its listing signs for an hour. Looking isn't getting: a key's say over fetching (below) holds bringing a piece's files into a project.

### What Zaisma checks

Every version passes Zaisma's fixed checks before anyone can fetch it, the same ones a game's version passes ([`docs/DEVELOPER-API.md`](DEVELOPER-API.md#the-fixed-checks-are-the-review)): no AI reads anything, and the same files always get the same answer. Then what its kind adds:

- **Packs and presets: every file is opened.** An image can only be an image, and a sound only a sound: a file whose bytes aren't what its name says refuses the version (`file_mislabeled`). The version is then marked **No code**, a guarantee that it holds no scripts or code and nothing in it can run, or **Contains code**, when a file can run (a script, a shader, a page, a program), can point at a script already in the game (an engine's own scene or resource), or is one Zaisma can't see through (an archive, a format it doesn't know). `zaisma pieces check` opens the files the same way and says which it would be.
- **Skills: text, in full.** A skill's files are all text, and its listing shows them whole, so it's read before anyone gets it. The version read is the version fetched, and a new version's listing shows what changed, line by line.
- **No programs or archives, in any kind.** A piece's files pass the same file rule as a game's: no program for Windows, macOS or Linux, no shell script (a file starting `#!`), no archive and no PDF, whatever it's called. A tool is its source, a web page or a script run with its runtime, never a built program.
- **Templates and layers** change the game they're added to, and are expected to: they run in the game's own sandbox like the rest of its code.

A finding that refuses a version comes with its fix: `file_mislabeled`, `skill_file_not_text`, or one of the fixed checks' own codes (`crypto_miner`, `disguised_code` and the rest). `needs_review` and `scan_failed` hold a version for a person at Zaisma.

### Fetching, and what an AI may fetch

A piece from another developer is a stranger's files, and a skill is a stranger's instructions to an AI. So every key and connected AI app says whether what holds it may fetch other developers' pieces, chosen when it's made (zaisma.com/dashboard/settings):

| Choice | What it does |
| --- | --- |
| Ask me first (`ask`, the default) | It fetches only the pieces you said yes to. A first try stops with `piece_approval_needed` and the piece's listing, where you read what it is and say yes or no. |
| Download freely (`free`) | It fetches any piece it can see. |
| Can't download (`none`) | It never fetches another developer's piece, or reads its files. |

Your own pieces never ask. Reading a listing and a statement is always open, and so is looking at its pictures, sounds and models there; the setting holds fetching the piece's files, code and all, into a project. It governs what comes through Zaisma: a piece that's also on npm can be had from npm.

## Errors

The command's errors, each with a `fix`:

| Code | What happened |
| --- | --- |
| `bad_piece_statement` | A piece's `piece.json` isn't one: `field` names what's wrong in it. |
| `piece_statement_newer` | A piece's `piece.json` is written for a newer command than this one: run the newest. |
| `bad_piece_source` | What was given isn't a piece's folder, its `.tgz` or a name on npm, or its archive can't be trusted. |
| `piece_not_found` | There's no such piece or version where it was looked for. |
| `piece_source_unreachable` | npm couldn't be reached, so nothing was changed. |
| `piece_not_addable` | `pieces add`: the piece is a skill or a tool, which a game never holds: `pieces get` fetches it. |
| `piece_folder_not_empty` | `pieces get`: the folder already holds files that aren't a copy of the piece. |
| `piece_not_ready` | `pieces publish`: the piece's own check found something that refuses it, so nothing was sent. |
| `piece_file_changed` | A file fetched from Zaisma's marketplace isn't the one its version lists, so nothing was changed. |
| `piece_already_added` | `pieces add`: the game already has this piece at another version; a piece moves to another version only with `pieces update`. |
| `piece_not_added` | `pieces update`, `pieces remove`: the game has no such piece. |
| `piece_version_clash` | Two pieces need versions of the same thing that don't overlap, so nothing was changed; the error says both versions and the ways out. |
| `piece_need_unmet` | Something a piece needs wasn't found, so nothing was changed. |
| `piece_edited` | `pieces update`, `pieces remove`: the piece's files in the game were changed by hand; `--discard-edits` loses the edits. |
| `piece_source_needed` | `pieces update`: the piece came from a folder or a `.tgz`, so `--from` must say where the new version is. |
| `piece_not_updatable` | `pieces update`: a template is copied once and is the game's own. |
| `piece_not_removable` | `pieces remove`: a template's files are the game's own. |
| `piece_still_needed` | `pieces remove`: another of the game's pieces needs this one, so nothing was changed. |
| `template_file_exists` | `pieces add`: a template would write over a file the game already has, so nothing was changed. |
| `bad_pieces_record` | The game's `pieces/pieces.json` can't be read. |
| `pieces_record_newer` | The game's `pieces/pieces.json` was written by a newer command than this one: run the newest. |
