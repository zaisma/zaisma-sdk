# Saves

Open this when the game keeps progress.

## What Zaisma does

Cloud saves need no code. The game saves in the browser as it always would, in `localStorage` or IndexedDB; for a signed-in player, Zaisma mirrors that to their account and puts it back before the game starts on any device. Guests' progress stays in their browser. A game turns cloud saves on or off with `update_game`, `cloud_saves_enabled`.

Zaisma keeps up to 5 earlier versions of each player's save: about once an hour while they play, and whenever progress was about to be lost (another device's progress replacing it, a save that shrank to under half). The developer and their AI read, change, reset and restore any player's save with `get_save`, `change_save`, `reset_save` and `restore_save_copy`.

## When to save

- **At the moments a player would be upset to lose:** finishing a level, buying or earning something, changing settings, reaching a checkpoint.
- **When the game is hidden or closing:** on `visibilitychange` when `document.hidden`, and on `pagehide`. Phones close background tabs without warning.
- **Not every frame.** Writing storage many times a second slows the game and adds nothing.

## What goes in a save

- **Progress and settings, not the world.** Unlocked levels, inventory, currency, options, the current checkpoint. Not every enemy's position, and nothing the game can rebuild.
- **A version number in it.** Store `saveFormatVersion: 1` (or similar) beside the data, and upgrade older saves when the game loads them, so an update never breaks a player's progress.
- **Small.** A save is up to 5 MB (`save_too_big`). Keep big caches out of it: IndexedDB databases with "cache" in their name are left out of saves.
- **Plain values.** `localStorage` holds text; keep the save's shape simple enough to read back after the game changes.

## Online games

What decides a match (scores, items won, rank) belongs on the game server and in its database, not in the player's browser save, which the player controls. Purchases come from Zaisma's records (`Zaisma.items.owns()`, `Zaisma.items.owned()`), never from a save.

## In the game

A game that draws its own save screens uses `Zaisma.saves`: `listCopies()`, `getCopy(saveCopyId)` and `restoreCopy(saveCopyId)` reach the player's earlier versions, `on("conflict")` hears when two devices' progress met and which one won, and `on("developerChange")` hears when the developer changed the save. `Zaisma.player.offerAccount()` picks the moment to ask a guest to make an account and keep their progress, like after their first win.

## With the save piece

`@zaisma/save` (`npx @zaisma/cli pieces add @zaisma/save`, `pieces.md`) does all of the above for the game: a format number with `upgrades` for older saves, writes shortly after a change and at once when the game is hidden or closed, and never writes over a save from a newer version, one it can't read, or one that changed elsewhere. Name the game's pieces in its kept pieces, as below, and what they keep of their own comes back too, like the input piece's rebound controls and sensitivity. Its `index.d.ts` is the reference.

```js
const save = await openSave({ saveFormatVersionNumber: 1, defaults: { level: 1, coinCount: 0 }, keptPieces: [input] });
save.update((progress) => { progress.coinCount += 5; });
Zaisma.saves.on("developerChange", () => save.reread());
```

It keeps the save in the browser by default, so cloud saves follow it with no code. For progress kept on the game's own game server (a game also played off Zaisma, on your own server), give it a server store and answer its requests in `onRequest` with its `server.js`, the same on Zaisma's rooms and on your own server:

```js
const save = await openSave({ saveFormatVersionNumber: 1, defaults: { level: 1 }, store: serverStore({ request: (body) => Zaisma.server.request(body) }) });
// zaisma-server/index.js: import { answerSaveRequest } from "./pieces/@zaisma/save/server.js";
//   onRequest: const saveAnswer = await answerSaveRequest(player, request, server); if (saveAnswer !== undefined) return saveAnswer;
```
