# Pieces

A piece is a shared building block a game is made from: a body that already walks, input for every device, save and load, a sky, online play. A game adds the pieces it wants and spends its effort on what makes it its own. Every piece is optional, and no game is locked into any of them.

Pieces are open. Anyone publishes one, for any engine or kind of game. Zaisma's own are added, updated and checked exactly as a stranger's are: nothing in the command knows any piece, standard or publisher by name. Zaisma's are MIT licensed, in [`pieces/`](../pieces).

This page is the frame every piece stands on: what a piece states about itself, how it's added to a game, how its versions move, and how its settings and hooks are opened.

## The layers

| Kind | What it is |
| --- | --- |
| `foundation` | A standard everything else fits: a skeleton, a body, input, save and load, lighting, a networking core. |
| `extension` | Plugs into one foundation: a kind of sync, a camera style, a way to move, an ability. |
| `game_system` | A genre's part: a round timer, a combo counter, an inventory. |
| `template` | A genre's systems wired together, with no style of their own. It's copied into a game once and is then the game's own. |

## Standards

Every piece names the **standard** it's built on, so pieces made to fit one set of foundations are never mistaken for pieces made to fit another. A standard is whatever its keeper says it is: a set of foundations for three.js, a base for Godot, a skeleton alone.

A standard's name is a name on npm, like `@studio/standard`. Two makers' standards can never share a name, and whoever holds the name on npm keeps the standard. A piece built on someone else's standard names it the same way; a small standard can be one piece, named after itself. Zaisma's are in [Zaisma's pieces](#zaismas-pieces): one standard among any that people publish.

Adding a piece built on a standard the game didn't have says so, plainly. Nothing stops it: a game chooses its pieces.

## Adding pieces to a game

```
npx @zaisma/cli pieces add @studio/dash-move          # by its name on npm, the newest version
npx @zaisma/cli pieces add @studio/dash-move@^1.2     # or the newest within a range
npx @zaisma/cli pieces add ./my-piece                 # a piece's folder
npx @zaisma/cli pieces add ./my-piece-1.0.0.tgz       # or the .tgz that npm pack makes of it
npx @zaisma/cli pieces add @studio/dash-move --dry-run  # what it would bring, changing nothing
npx @zaisma/cli pieces                                # what the game has
```

Run them in the game's folder (the one with its `index.html`, or its source for a game that's built), or give `--folder`. Each takes `--json`.

A piece's files go in `pieces/<name>/` with its `piece.json`, its game server files (when it has any) in `zaisma-server/pieces/<name>/`, where a game server on Zaisma can import them and players are never served them, and the game's record of its pieces in `pieces/pieces.json`. Commit all three.

**What adding does, always:**

- **What a piece needs is stated, and comes with it.** Every piece states what it needs and which versions it accepts; adding brings what's missing, and says what it brought.
- **Never a second copy.** A piece the game already has, at a version the new piece accepts, is left exactly as it is.
- **Never moved by itself.** A piece changes version only when you run `pieces update` for it.
- **A clash stops everything, plainly.** When the game has a version the new piece doesn't accept, nothing is added, and the error (`piece_version_clash`) says both versions and the two ways out: move the one in the game, or use a version of the new piece that accepts it. Two pieces being added that need versions of the same thing with no overlap stop the same way.
- **A library isn't doubled either.** A piece may need a library that isn't a piece (three.js). A game that has it in its own `package.json` uses its own; one outside the accepted range is a clash like any other. A game without it gets the library's browser files in `pieces/<library>/`, and the command prints the import map its page needs.
- **An engine is stated, never brought.** A piece for an engine that isn't a library on npm (Godot) says which versions it needs; the command says so and leaves the engine to the game.
- **A piece's code is never run.** Adding copies the files a piece lists and nothing else: no install scripts, no links, no path outside the game's folder. A piece from npm is checked against npm's own hash of it first.

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
npx @zaisma/cli pieces newer                              # what has a newer version on npm, and what holds it back
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

Pieces written in JavaScript open them the same way, through [`@zaisma/piece`](../pieces/piece): a create call takes `{ settings, hooks }` beside its own arguments and gives back an object with `settings` and `hooks` on it.

```js
const dash = createDash({ settings: { dashSpeedMPerSec: 18 }, hooks: { dashed: () => playWhoosh() } });

dash.settings.set({ dashCooldownSec: 0.2 });                  // while playing
dash.settings.get("dashCooldownSec");                         // 0.2
dash.settings.list();                                         // every setting: what it takes, its default, what it is now
dash.hooks.on("beforeDash", (dashDistanceM) => (isSlowed ? dashDistanceM / 2 : dashDistanceM));
```

In code a name is in the language's own style (`dash_speed_m_per_sec` is `dashSpeedMPerSec` in JavaScript). A setting or hook the piece doesn't have is refused, with the ones it does have in the error's `fix`; so is a value outside what a setting takes.

`zaisma pieces` marks a piece whose files were changed by hand, and `pieces update` and `pieces remove` refuse to lose the edits until you say `--discard-edits`.

## Zaisma's pieces

| Piece | Kind and standard | Gives | Needs |
| --- | --- | --- | --- |
| `@zaisma/piece` | `foundation`, its own small standard `@zaisma/piece` | How a JavaScript piece opens its settings and hooks, the same in every piece, in a browser and on a game server. A game never adds it by name: it comes with any piece that needs it. | nothing |

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
| `kind` | `foundation`, `extension`, `game_system` or `template`. |
| `standard` | The standard it's built on, by its name on npm ([Standards](#standards)). |
| `summary` | A sentence or two on what it gives a game, up to 400 characters. |
| `license` | The licence it's under, as SPDX names it: `MIT`, `Apache-2.0`. |
| `entry_path` | The file a game starts from (in JavaScript, the one it imports); `null` for a piece with only game server files. |
| `server_entry_path` | The file a game server imports; `null` for a piece with no game server files. |
| `file_paths` | Every file a game gets, each by its path inside the piece: forward slashes, nothing hidden (no part starting with a dot) and nothing in `node_modules`. The `piece.json` always comes too and isn't listed. A template's are copied into the game's own folder. |
| `server_file_paths` | Every file a game server gets. A file both sides share is listed in both. Empty for a template, whose game server files are the game's own, under `zaisma-server/` in `file_paths`. |
| `needs` | What it needs: each `{ name, version_range, kind }`. |
| `settings` | Its settings: each `{ name, value_kind, default_value, minimum_number, maximum_number, maximum_character_count, choices, summary }`. Empty for a template. |
| `hooks` | Its hooks: each `{ name, hook_kind, summary }`. Empty for a template. |

**A need** is `{ name, version_range, kind }`. `version_range` is a semver range like `^1.0.0`, `>=0.160.0 <1.0.0` or `1.x || 2.x`. `kind` says what it is:

| Need `kind` | What it is |
| --- | --- |
| `piece` | Another piece, by its name. Brought when the game lacks it. |
| `library` | A library on npm that isn't a piece. The game's own is used when its `package.json` has one; else its browser files are brought. |
| `engine` | An engine that isn't a library on npm, by its name in lowercase (`godot`). Stated to the developer, never brought or checked. |

**A setting** names what it holds and its unit, in lowercase with underscores ([`docs/NAMING.md`](NAMING.md)): `jump_height_m`, `shadows_enabled`. Its `value_kind` says what it takes, and the fields that don't apply to that kind are `null`:

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
- **One statement.** A JavaScript piece reads its own settings and hooks from `./piece.json.js`, the statement as a module, and opens them with `@zaisma/piece` (its [README](../pieces/piece/README.md) shows how). List `piece.json.js` in `file_paths`; `zaisma pieces check <folder> --fix` writes it from `piece.json`, and a piece whose two disagree is refused.
- **An `index.d.ts`** with every call, setting, hook and error explained and an example: it's what an AI reads.
- **Closed inputs and plain errors:** an unknown setting or argument is refused, and every error has a stable `code`, the `field` at fault and a `fix`.
- **Names that say what they hold** ([`docs/NAMING.md`](NAMING.md)).
- **No file without an extension** in a piece for a game whose folder is uploaded as it is: Zaisma's upload takes none, so a licence travels as `LICENSE.txt`.

### Check and publish

```
npx @zaisma/cli pieces check ./my-piece          # before publishing
npx @zaisma/cli pieces check ./my-piece --fix    # and write piece.json.js again from piece.json
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
| `file_not_uploadable` | note | A file is of a type Zaisma's upload doesn't take, so a game whose folder is uploaded as it is can't hold the piece. |
| `no_reference` | note | The file a game imports has no .d.ts beside it: it's what an AI reads to use the piece without opening its code. |
| `no_readme` | note | There's no README.md among the piece's files. |

Publish it with `npm publish`, its `package.json` giving the same name and version as its `piece.json` and packing every file it lists; anyone adds it by name. A piece that isn't on npm is added from its folder or its `.tgz`.

## Errors

The command's errors, each with a `fix`:

| Code | What happened |
| --- | --- |
| `bad_piece_statement` | A piece's `piece.json` isn't one: `field` names what's wrong in it. |
| `piece_statement_newer` | A piece's `piece.json` is written for a newer command than this one: run the newest. |
| `bad_piece_source` | What was given isn't a piece's folder, its `.tgz` or a name on npm, or its archive can't be trusted. |
| `piece_not_found` | There's no such piece or version where it was looked for. |
| `piece_source_unreachable` | npm couldn't be reached, so nothing was changed. |
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
