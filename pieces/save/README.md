# @zaisma/save

Save and load for a game's progress, and for what each of its pieces keeps of its own, like the controls a player chose. A game describes its progress once and changes it as the player plays; this piece writes it at the right moments and brings it back when the game opens again.

```
npx @zaisma/cli pieces add @zaisma/save
```

```js
import { createInput } from "./pieces/@zaisma/input/index.js";
import { openSave } from "./pieces/@zaisma/save/index.js";

const input = createInput({ actions: { jump: { keys: ["Space"] } } });
const save = await openSave({
  saveFormatVersionNumber: 2,
  defaults: { level: 1, coinCount: 0, options: { musicEnabled: true } },
  upgrades: { 1: (formatOne) => ({ level: formatOne.level, coinCount: formatOne.coins }) }, // from format 1 to 2
  keptPieces: [input], // the player's rebound keys and sensitivity come back too
  hooks: { changedOutside: (progress) => redraw(progress) },
});

save.progress.level;                                     // read
save.update((progress) => { progress.coinCount += 5; }); // change: written shortly after, many changes as one
save.writeNow();                                         // at a checkpoint
```

## What it takes care of

- **What pieces keep of their own.** A piece that keeps something between plays has `kept` (it opens it with [`@zaisma/piece`](../piece)'s `openKept`). Name it in `keptPieces` and its record goes beside the game's progress and comes back when the game opens, with no code of the game's. The input piece keeps the player's rebound actions and their own choices among its settings (how fast the view turns, inverted look, swapped sticks, rumble), each only once it differs from what the game made it with, so a game that changes its own defaults later still reaches every player who never changed them. A record from a newer version of a piece, or of a piece the game no longer keeps, is kept as it is, never lost.
- **Writing at the right moments:** shortly after a change (`write_delay_ms`), and at once when the game is hidden or closed, since phones close tabs without warning. `writing_enabled` off holds writes (a replay, a tutorial that mustn't count).
- **Older saves:** brought up to date step by step with `upgrades`, and a field added later starts at its default, at any depth.
- **Never writing over a save it didn't make:** one from a newer version of the game, one it can't read, or one that changed underneath it (another tab, another device, an earlier copy put back, the developer). It keeps the stored one, tells the `problem` or `changedOutside` hook, and writes nothing until the game says so.

## Where it's kept

| Store | Where | Use it when |
| --- | --- | --- |
| `browserStore()`, the default | The browser's localStorage. On Zaisma, with cloud saves on, it follows a signed-in player to every device and Zaisma keeps 5 earlier copies, with no more code. | Almost always. |
| `serverStore({ request })` | The game's own game server, in its database, for each signed-in player, with a copy in the browser. | The progress should live on the game's server: a game also played off Zaisma, or one whose server reads it. |
| Your own | Anything with `read`, `write`, `listen`, `flush` and `dispose` (`stores.d.ts`). | Your own backend. |

On Zaisma, listen for the developer changing a player's save so it's taken in place: `Zaisma.saves.on("developerChange", () => save.reread())`.

### On the game server, on Zaisma or your own

`serverStore` sends its requests through any request function, and the piece's `server.js` answers them in the game server's `onRequest`. It's plain game server code, so the same game server runs in Zaisma's rooms and on your own server with `@zaisma/game-server/node`.

```js
// In the game: on Zaisma, or with { serverUrl } for your own server (after Zaisma.setUpOffZaisma off Zaisma).
const save = await openSave({
  saveFormatVersionNumber: 1,
  defaults: { level: 1 },
  store: serverStore({ request: (body) => Zaisma.server.request(body) }),
});

// zaisma-server/index.js
import { answerSaveRequest } from "./pieces/@zaisma/save/server.js";
export default {
  async onRequest(player, request, server) {
    const saveAnswer = await answerSaveRequest(player, request, server);
    if (saveAnswer !== undefined) return saveAnswer;
    // ... the game's own requests ...
  },
};
```

- **Cheap:** a copy is written in the browser at once, and sent at most every 10 seconds (`minimumSendIntervalSec`), as the page closes, and at `writeNow`. A save of up to 256 KB is sent in parts of a request each.
- **Offline, and guests:** a guest's save stays in the browser (a guest's player ID lasts only for their pass); progress made offline, or before a guest makes an account, is sent the next time it can be.
- **Two devices:** written only over the version the device last saw. When two devices both played on, the one saved last wins, as on Zaisma, and the `conflict` hook gets the other to offer.
- **Erased with the player:** its rows hold `player_id`, so `server.database.erasePlayer` erases a player's saves with the rest.

Keep progress and settings in a save, never what decides an online match (that belongs on the game server) or purchases (`Zaisma.items`).

`index.d.ts`, `stores.d.ts` and `server.d.ts` are the reference. How pieces work: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md). MIT licensed.
