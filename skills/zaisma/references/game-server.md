<!-- Made by scripts/build-skill.mjs: never edit it by hand. -->

# @zaisma/game-server

Write a game server once; run it in Zaisma's rooms or on your own Node server. Rooms, players, state sync, chat, the game's database and its requests behave the same in both.

To play your multiplayer game on your own computer before you upload it, run `npx @zaisma/game-server@1 play-locally` in the game's folder (or `npx @zaisma/cli play-locally`, which runs it). When it starts, it asks npm whether a newer bench is out and, if one is, says so in one line: run it again to use it, or, where your project or computer installed an older one, the `npm install` that moves it up. Offline, or on the latest, it says nothing and never waits. It serves the game, runs its game server, and opens a test bench: each player on Zaisma's own game page, guests until they sign in with a name, and a dev bar whose Add a player opens another tab as a new player, with passes signed by a key of its own, so two tabs play together with no account, key or internet. Flags: `[folder]`, `--port 4800`, `--game <slug>`, `--on-network`, `--no-open`, `--json`; Zaisma's README has the whole of it under "Play it on your own computer".

```ts
// server.ts
import { defineGameServer } from "@zaisma/game-server";

export default defineGameServer({
  ticksPerSec: 20,
  setup: () => ({ scores: {} }),
  onJoin: (state, who, room) => ({ ...state, scores: { ...state.scores, [who.id]: 0 } }),
});
```

On your own server (Node 22.18 or later):

```
npx @zaisma/game-server@1 ./server.ts --game <your-game-slug> --port 8080
```

or from code:

```ts
import { startServer } from "@zaisma/game-server/node";
import gameServer from "./server.ts";

const running = startServer({ gameServer, gameSlug: "your-game-slug", port: 8080 });
// Later: await running.close(); every room saves first.
```

For the fast lane (WebTransport, where `latest_only` sends go as datagrams), install its two optional packages beside the runner and give it all three of `--webtransport-port`, `--certificate-path` and `--certificate-key-path` (`startServer({ webtransportPort, certificatePath, certificateKeyPath })`):

```
npm install @fails-components/webtransport@1.6.11 @fails-components/webtransport-transport-http3-quiche@1.6.11
npx @zaisma/game-server@1 ./server.ts --game <your-game-slug> --port 8080 --webtransport-port 443 --certificate-path fullchain.pem --certificate-key-path privkey.pem
```

Games join it with `Zaisma.joinRoom({ serverUrl, transport: "webtransport" })`, and fall back to the WebSocket by themselves where it doesn't connect.

A mistake in your game server's code becomes a coded error in the game's logs, never a silent success, and the Node runner behaves the same as Zaisma's rooms. Versions follow semver: within 1.x the package only gains things.

- The game server, handler by handler: the "Multiplayer" section of the [README](https://github.com/zaisma/zaisma-sdk#multiplayer) and [`docs/DEVELOPER-API.md`](https://github.com/zaisma/zaisma-sdk/blob/main/docs/DEVELOPER-API.md).
- Every name and option follows [`docs/NAMING.md`](https://github.com/zaisma/zaisma-sdk/blob/main/docs/NAMING.md).

MIT licensed.

### Multiplayer

Games include the SDK with `<script src="_zaisma/v1.js"></script>` and call `await Zaisma.joinRoom()`. Its reference is its types, [`packages/sdk/zaisma.d.ts`](packages/sdk/zaisma.d.ts) (served beside it as `_zaisma/v1.d.ts`): every call, option, event and error code, explained. Save it beside your game's folder (uploads take no `.ts` files) and put `/// <reference path="../zaisma.d.ts" />` (and in JavaScript, `// @ts-check`) at the top of your script, and your editor and AI get errors instead of guesses. A room link (`zaisma.com/g/<game>?room=CODE`) drops friends into the same match, as guests or signed in. A game that needs a Zaisma account for multiplayer or the whole game (its `account_requirement` setting) gives guests no passes (`error.code === "account_needed"`), and its page asks them to sign in. Any game can ask a guest to sign in while it runs with `await Zaisma.player.signIn()`: the page offers an account beside the game, signing in happens in a new tab so the game keeps running, and the next `Zaisma.player.getPass()` or `joinRoom()` is the account's. Player passes come from the game's zaisma.com page, which checks that a real browser opened it (Cloudflare's invisible check, started as the page opens so Play doesn't wait), so bots can't fill rooms: a game opened anywhere else, or a browser the check can't confirm, can't join (`error.code === "unchecked"`).

Multiplayer is server-client: the *client* is the game in the browser, the *game server* holds the official state and checks every move, and a *room* is one live match running one copy of the game server. A game server is a plain object:

```ts
export default {
  maximumPlayerCount: 8,   // up to 100
  ticksPerSec: 20,         // up to 60; leave out for turn-based games so the room sleeps between moves
  setup: (setupData) => ({ players: {} }),  // setupData: what room.reserve() passed, for a room another room made, else null
  onJoin(state, player, room, joinData, joinInfo) {}, // joinData: what the player's game passed to joinRoom({ joinData }), else null;
                                                       // joinInfo: { fromRoomCode, isReturning, isSpectator } (isReturning: back to a held seat)
  canJoin(state, player, room, joinData, joinInfo) {}, // true lets them in; false or { refusalMessage } turns them away
  onChat(state, player, room, chatInfo) {},    // a player's room.chat, before Zaisma's filter: true, false or { toPlayerIds }
  adultChatFilterEnabled: false,               // true: Zaisma's chat filter checks chat between adults too (on your meter)
  onLeave(state, player, room, leaveInfo) {},  // leaveInfo.reason: left, lost, idle, hidden or kicked
  onMessage(state, player, room, message) {},
  onBytes(state, player, room, bytes) {},      // bytes a player's game sent (room.sendBytes), a Uint8Array
  onTick(state, tickDurationSec, room) {},     // tickDurationSec: seconds since the last tick
  onRequest(player, request, server) {},       // a request outside any room (Zaisma.server.request): answer it (below)
  schedules: [{ name: "daily-reset", cron: "0 0 * * *" }], // runs by itself, in UTC (below)
  onSchedule(run, server) {},                  // run.name: which schedule is due
};
// room.broadcast(message, { exceptPlayerId, delivery }), room.send(playerId, message, { delivery }), room.players, room.end(message),
// room.broadcastBytes(bytes, { exceptPlayerId, fromPlayerId, delivery }), room.sendBytes(playerId, bytes, { delivery }),
// room.setListed(false), room.setOpen(false), room.reserve({ playerIds, setupData }),
// await room.database.query(sql, values), await room.database.batch([{ sql, values }])  (the game database, below)
// await room.verifyReceipt(receipt)  (a purchase's signed receipt, checked; server.verifyReceipt the same)
// room.readDataFile("maps/docks.bin")  (a data file beside the code, an ArrayBuffer; server.readDataFile the same; below)
```

Names follow [`docs/NAMING.md`](docs/NAMING.md): whole words, with the unit in the name. A game server with an option it doesn't take doesn't start, and says which ones it does take (`unknown_option`); the SDK refuses options and events it doesn't take the same way. Every message between a game and its room says its `type`, and a game's own messages travel in `data`; rooms count messages, not their size, so whole words cost nothing.

`canJoin` decides who comes in, before they join: answer `true` to let them in, `false` to turn them away, or `{ refusalMessage: "Wrong room password." }` to turn them away with a message they see (up to 200 characters). Any other answer, nothing included, like a string, turns them away too, and shows in your game server's errors with what to answer instead. Only decide there; change the state in `onJoin`.

```ts
canJoin(state, player, room, joinData) {
  return joinData?.password === state.password || { refusalMessage: "Wrong room password." };
},
```

Each player's ping, measured by the room, is `room.pingDurationMs(playerId)` on the game server and `room.pingDurationMs` in their game, and both read the room's clock with `room.serverTimeMs()` (see "Room connections" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md)).

A room takes up to 100 players at up to 60 ticks a second. Each player's game sends up to 30 messages a second (a burst of 60), so a game at 60 ticks sends two inputs in one message; the game server can still send every tick. Past 100 players, split a world into rooms and move players between them (`room.moveTo`).

**Bytes:** for snapshots and inputs where JSON is too big, a game sends bytes with `room.sendBytes(bytes)` (an `ArrayBuffer` or any typed array) and gets them with `room.on("bytes", (bytes, fromPlayerId) => {})`; the game server takes them in `onBytes` and sends them with `room.broadcastBytes(bytes)` and `room.sendBytes(playerId, bytes)`. `fromPlayerId` is the player they came from when the game server passes one player's bytes on (`room.broadcastBytes(bytes, { fromPlayerId: player.id })`, as the relay does), else `null`. Bytes have the same limits as messages: up to 16 KB each, counted together with them. The MCP's `get_stats` shows each game's room traffic per player and its biggest message types, with hints on what to send as bytes or send less.

**Sending only what changed:** turn on `stateSyncEnabled` and keep the world in the game server's state; each player then gets a full copy as they join and after that only what changed, after every tick (or every move, in a turn-based game), with no code to send it. `stateView(state, viewer, room)` cuts what each player sees: only what's near them in a big world, or without the other team's cards. In the game, `room.state` is the player's view and `room.smoothedState()` the same a moment (100 ms) behind, with positions moving evenly between updates. A player whose connection is backed up gets nothing until they've caught up, then a full copy. See `examples/arena`, and "State sync" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md).

```ts
// A 100-player world where each player gets only the players within 800 units of them.
export default {
  maximumPlayerCount: 100,
  ticksPerSec: 30,
  stateSyncEnabled: true,
  setup: () => ({ players: {} }),
  onJoin(state, player) { state.players[player.id] = { name: player.name, x: 0, y: 0, health: 100 }; },
  onLeave(state, player) { delete state.players[player.id]; },
  stateView(state, viewer) {
    const me = state.players[viewer.id];
    const nearby = {};
    for (const [id, other] of Object.entries(state.players)) {
      if (me && Math.hypot(other.x - me.x, other.y - me.y) <= 800) nearby[id] = { name: other.name, x: Math.round(other.x), y: Math.round(other.y), health: other.health };
    }
    return { players: nearby };
  },
};
// In the game: requestAnimationFrame(function draw() { drawPlayers(room.smoothedState()?.players ?? {}); requestAnimationFrame(draw); });
```

**Messages that can be dropped:** `{ delivery: "latest_only" }` on any send, from the game server or the game, marks a message only the newest of matters, like positions every tick or where a player aims: while a player's connection is backed up, a newer one with the same `latestKey` (which it needs, like `"position"`) replaces it, and the newest goes once they catch up. Zaisma's rooms carry them over the WebSocket today, and the same call moves to real datagrams once Cloudflare carries them; on your own server, the fast lane already sends them as datagrams (see [Run your game server yourself](#run-your-game-server-yourself)). `get_stats` says which of your message types would gain from it (`latest_only_available`).

**Sending less, by default:** a room is billed for each message players send, so the SDK sends less without being asked. What a game sends at once (in one frame of its loop, say) goes as one message of up to 8, and each still reaches `onMessage` on its own, in order; sends also keep under the room's 30 a second by themselves, so a game sending more waits a few milliseconds and goes combined instead of hearing `too_fast`. A `latest_only` send that's the same as the last one with its `latestKey` isn't sent at all, since the room already has it; reliable sends always go. A game that needs every send to go alone and at once turns either off: `Zaisma.joinRoom({ sendCombiningEnabled: false, unchangedSkippingEnabled: false })`. Rooms on your own server combine from game server 1.40. Send input when it changes, not every frame, and use 20 to 30 ticks unless the game truly needs 60; `get_stats` says when players send more than a game needs (`input_frequent`).

Games without server code can use the built-in `relay` (up to 16 players), which passes each message on to everyone else as it was sent (your game's `message` event gets the message, then `fromPlayerId` as its second argument), and bytes the same way. See `examples/arena` (real-time) and `examples/four-in-a-row` (turn-based).

#### Your game server on Zaisma

Put your game server in a `zaisma-server/` folder at the top of your upload and set multiplayer to "Your game server" (dashboard), or `multiplayer: "own"` (MCP or API). Zaisma's rooms run it for you:

```
index.html
zaisma-server/
  index.js        export default { setup, onJoin, onMessage, ... }
  physics.js      import { step } from "./physics.js" works in index.js
  levels/docks.js
  maps/docks.bin  a data file: room.readDataFile("maps/docks.bin")
```

- **Plain JavaScript ES modules:** `zaisma-server/index.js` default-exports the game server above, and can import the folder's other files by relative path: `.js` code, `.json` data (`import levels from "./levels.json"`) and `.wasm` WebAssembly, like a physics engine (`import mod from "./physics.wasm"` gives a `WebAssembly.Module`; `new WebAssembly.Instance(mod, imports)` starts it). Packages from npm (`import "lodash"`) and TypeScript need a build step: bundle into one `zaisma-server.js` at the top of the upload instead (`npx esbuild server.ts --format=esm --bundle --outfile=zaisma-server.js`), or into `zaisma-server/index.js` when it has data files. Up to 500 files and 64 MB in all, data files included, of which the code (`.js`, `.json` and `.wasm`) is up to 32 MB (`GAME_SERVER_LIMITS`).
- **Data files:** every other file in `zaisma-server/` (`.bin`, `.gz`, `.txt`, anything but `.js`, `.json` and `.wasm`) ships beside the code as a data file, like prebuilt navigation meshes, level geometry or a dictionary. `room.readDataFile("maps/docks.bin")` (or `server.readDataFile` in `onRequest`, `onSchedule` and `onWebhook`) answers it as an `ArrayBuffer`, by its path from `zaisma-server/`: no base64, no download, and nothing on the meter, since it comes with the code. It's the same `ArrayBuffer` every time, shared by every room of the version running in the same place, so read it and never change it; keep what you build from it in a variable outside the handlers (`const meshes = new Map()`) and every room there shares it too. A path with no data file throws a `GameServerError` `bad_room_call`. On your own server, data files are read from the game server's folder (`--data-folder`, or `startServer({ dataFolder })`; `zaisma-server` by default).
- **Time to start:** each call into the game server, a join, a request, has 50 ms of CPU (`GAME_SERVER_LIMITS.maximumCallCpuDurationMs`), as Cloudflare measures it, and a real-time room's ticks, each with the messages since the last one, go up to 30 to a call that shares 50 ms for each of them (1.5 seconds for 30, under Cloudflare's own stop). Cloudflare itself stops a call only at about 2 seconds, which freezes the match that long, so the room keeps the budget: when 20 of a room's calls within a minute go past theirs, the game server stops and the match ends, as for one that keeps failing, and its logs say so. A start has 5 seconds (`maximumStartCpuDurationMs`): loading the game server, `setup`, `onRestored`, and a real-time room's first tick after any of them, or after the room puts its state back in a fresh copy of the game server (one that started again and lost its memory, or one opened again after a stop), whether or not the game has `onRestored`, so build what the match needs once (a map's navigation, its collision) in that first tick, not spread over many. The game server's top-level code, outside its handlers, has Cloudflare's 1 second as it loads (`maximumLoadCpuDurationMs`), so heavy work goes in that first tick. One copy of the game server, shared by the version's rooms in one place, has 128 MB of memory (`maximumMemorySizeBytes`), its data files included: they load from storage into that memory when the copy starts, so with 64 MB of files about 60 MB is left for the matches. Every second of CPU is on the game's hosting meter, starts included.
- **Sealed off:** nothing of Zaisma's but its own game's database and secrets, and other servers only on the hosts you list (below), so it talks to its players through `room` and its answers to their requests. State is plain JSON.
- **Private:** players never get its files; the game domain refuses `zaisma-server/` and `zaisma-server.js`.
- **Real-time rooms batch input:** in a room with `ticksPerSec`, the state stays inside the sandbox, and players' messages and bytes reach `onMessage` and `onBytes` just before the next `onTick`, in the order they came, with what they send going out then (at most a tick later). A handler that throws leaves the rest of the batch to run, and what it changed in the state before throwing stays, as on your own server, where they run as they come. Either way a room's handlers run one at a time: one that awaits (the database, say) finishes before the room's next message, bytes or tick reaches the game server.
- **Kept in check:** an error in a handler loses that one message or tick and the match carries on. A call that runs past its CPU (above; a loop that never ends) is stopped, freezing the match meanwhile, and a match stopped twice ends. Your dashboard and the MCP's `get_stats` show these errors with the file and line they came from.
- **Memory outside the handlers:** a room's state is plain JSON, and it's all Zaisma keeps of a room. What the game server keeps in its own variables, outside the handlers (`const worlds = new Map()`), lives in the copy of the version that runs the room: the version's rooms running in the same place share it, as they share data files, and rooms elsewhere have copies of their own. It's lost whenever that copy starts again, which can happen at any time (a while unused, Zaisma's own updates, a call stopped for running too long), and then the room carries on from its last state, with no `onRestored` (that runs only when the room itself restarts): a turn-based room's state as of its last call, a real-time room's as of its last copy, taken every 5 seconds. So a world that isn't JSON (typed arrays, a collision tree, a physics engine's bodies) goes there, keyed by `room.roomCode`; each handler that finds its room's entry missing rebuilds it from the state, and the room deletes its entry once its match is over, since every room in that copy shares its 128 MB. On your own server and in play-locally, one process runs every room, so they all share it; it's lost when the process starts again (play-locally starts it again on each change to the game server, and when it goes over its 128 MB, as Zaisma's rooms do), and every room then comes back through `onRestored`.
- **Updates:** rooms keep the version they started with until they end; new rooms get the live version.

The same file runs on your own machine too (below), so you can test it there or move off Zaisma any time.

#### The game database

Every game has its own SQLite database, part of its hosting: shared by all its rooms, kept between matches, for what the game server owns or must trust (inventories, leaderboards, bans, worlds). Players' own progress belongs in cloud saves, which need no code. The game server uses it as `room.database` with plain SQL, in any handler that awaits it:

```js
async onJoin(state, player, room) {
  await room.database.query("CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
  const [mine] = await room.database.query("SELECT best_score FROM scores WHERE player_id = ?", [player.id]);
  room.send(player.id, { bestScore: mine?.best_score ?? 0 });
},
async onMessage(state, player, room, message) {
  if (message.type === "finished") {
    await room.database.query(
      "INSERT INTO scores VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET best_score = max(best_score, excluded.best_score)",
      [player.id, state.scores[player.id]],
    );
  }
},
```

- **`query(sql, values)`** runs one statement and answers its rows as objects (`[]` when it returns none). `values` fill its `?`s in order: text, numbers, `null` or a `Uint8Array` (whole numbers past 2^53 are refused with `bad_values` and can't be read back as numbers (`integer_too_large`): store them as text and read them with `CAST(col AS TEXT)`; use 1 and 0 for true and false; store objects as `JSON.stringify` and read them with `JSON.parse` or SQLite's JSON functions). To see what an `INSERT`, `UPDATE` or `DELETE` changed, add `RETURNING`.
- **`batch([{ sql, values }, ...])`** runs up to 100 statements in one transaction, so they all happen or none do (moving an item between two inventories, say), and answers each one's rows. `BEGIN` and `COMMIT` aren't taken; batch is the transaction.
- **Errors** are a `DatabaseError` with a `code` and a `fix`: `bad_sql` (SQLite's own message, or more than one statement in a query), `bad_values`, `integer_too_large` (a result holds a whole number past 2^53), `too_many_rows` (over 10,000 rows; page with `LIMIT`), `hosting_paused` (the game's hosting is paused this month, below), `database_full` (its storage, the database and kept rooms together, is at the 10 GB a game can have: it can change and delete rows but not grow) and `database_unavailable`.
- **Part of the game's hosting on Zaisma.** Rows written and read, and what it stores, count on the game's one hosting meter with its rooms and requests (see "Hosting" below). Every statement counts the rows SQLite touched, like Cloudflare's billing: an index makes lookups read fewer rows. When the game's hosting pauses, the database keeps answering for the hour running matches get, so their last saves land, then answers `hosting_paused` until it starts again.
- **You and your AI reach it too:** look at its tables and use, query it, fix data, change tables and roll it back to any minute in the last 30 days through the developer API, the MCP (`get_database`, `query_database`, `batch_database`, `restore_database`) or `zaisma database` in a terminal, with the same checks and limits (see "The game database" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md)).
- **Take it out, bring it in:** the whole database goes out and in as SQLite's own SQL dump (`export_database`, `import_database`), or as a ready SQLite file from a terminal: `zaisma database export <game> game.sqlite` and `zaisma database import <game> game.sqlite`.
- **The same code on your own server:** the Node runner keeps the database in a local SQLite file (below), checked the same way, with no limits. Moving between Zaisma and your own server is one command each way: export to the file the runner uses, or import the runner's file.

#### Room browsing

Open rooms are listed on the game's page (how full each is and where it runs, never who's in it), with "playing now" under the title (every room counts, hidden ones too), and the game gets the same list to show its own way:

```js
const { rooms, playingPlayerCount, regions } = await Zaisma.rooms.list();   // how full each room is and where it runs, never who's in it
Zaisma.rooms.list({ region: "EU", labels: { Mode: "Classic" } }); // one region, or rooms with these labels
const room = await Zaisma.rooms.quickJoin();  // the linked room, else a busy room with space nearby, else a new one
Zaisma.joinRoom({ isListed: true });          // a new room others find in room lists (by default only its code and link reach it)
Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });  // name and label a new room
await Zaisma.checkChat(typed);               // { isAllowed, reason, message, hasSwearing, text }: Zaisma's chat check
```

Rooms can have a name and up to 4 labels (like Mode and Map), set by your game server with `room.setInfo({ name, labels })`, by the room's first player with the relay, or when the room is made. Names and labels players type are fine; on zaisma.com they show only if they pass Zaisma's text filter (no links, handles, emails, phone numbers or contact apps; no slurs or sexual words), and players can report them. Inside your game they're yours to look after, under the content rules.

On the game server, `room.setListed(false)` hides a room (its code and links still work) and `room.setOpen(false)` closes it to new players once a match starts; players who were in it can still come back. With the relay, the room's first player can do the same from the game (`room.setListed`, `room.setOpen`, `room.setInfo`). In the dashboard, a game lists its rooms on the page and in the game, only in the game, or nowhere.

Join on the game page is an ordinary room link, so the game decides what comes first:

- **Straight in:** call `joinRoom()` or `quickJoin()` when the game starts; both follow a link to a Zaisma room; on your own servers, join with `joinRoom({ serverUrl: Zaisma.rooms.linkedServerUrl, roomCode: Zaisma.rooms.linkedRoomCode })`, since only `joinRoom({ serverUrl })` follows a link that names a server.
- **A menu or character customizer first:** check `Zaisma.rooms.linkedRoomCode`, show your screen, then join with what the player picked: `joinRoom({ joinData: { character: "knight" } })` hands it to your game server's `canJoin` and `onJoin` (plain JSON, up to 4 KB; it comes from the player's browser, so check it like any message). If the room filled up meanwhile, `joinRoom` fails with `error.code === "room_full"` and `quickJoin` finds another.
- **Your own lobby:** list rooms only in the game and draw them yourself from `Zaisma.rooms.list()`.

#### Lobbies and matches

A room can make a room for some of its players and send them there, like a lobby starting a match:

```ts
const roomCode = room.reserve({ playerIds: [a.id, b.id], setupData: { map: "Docks", teams } });  // in your game server
```

```js
room.on("move", (move) => { room.leave(); move.join(); });  // in the game: go to the new room
```

The new room runs the same game server, and its `setup(setupData)` gets your setup data, so it can start the match already set up (players can read it but can't change it; up to 4 KB). It's ready before anyone hears its code, only the players named can join it (it's a closed room, until your server opens it), and it's hidden from room lists unless you pass `isListed: true` (with a `name` and `labels` if you like). To send players to a room that's already running instead, like the next area of an open world, use `room.moveTo(roomCode, { playerIds, joinData })`: the other room's `canJoin` decides, and `onMoved(state, moveResult, room)` hears `{ roomCode, movedPlayers, refusals }`. A room can reserve up to 20 rooms a minute. See `examples/four-in-a-row`: its "Find an opponent" waits in a lobby room until there's someone to play.

A griefed world or a bad update can be undone: `server.restoreKeptRoom(roomCode, { restoreToAt })` puts a kept room's world back as it was at any minute in the last 30 days, by your game's own rule of who may, and `server.undoKeptRoomRestore` undoes it for 30 days; `server.listKeptRoomRestores(roomCode)` gives a restore screen what it draws from. Players drop for a second or two and reconnect, and `onRestored` hears `restoreInfo.keptRoomRestore`, so your game tells them its own way. Your AI does the same through the API and MCP (`restore_kept_room`, `restore_every_kept_room`), and a deleted world comes back with `bring_back_kept_room` for about 28 days. See `docs/DEVELOPER-API.md`, Kept rooms.

**One room at a time.** A player sits in one of your game's rooms at a time, as on Steam: when they join another room, their seat in the first closes with "Joined from somewhere else" and your game server's `onLeave` runs there with reason `"left"`. Moving a player (`room.moveTo`, `room.reserve`) and watching (`isSpectator`) never close a seat. A game that keeps players in more than one room, like a hangout hub beside its matches, raises `maximumRoomCountPerPlayer` (up to 10): a join past it closes the oldest seat. "Playing now" counts each player once.

**Kept rooms** are for worlds that last, like a survival server: a kept room doesn't end when everyone leaves, but sleeps with its state saved, costs nothing while it sleeps, and wakes as it was when someone joins, a day or a month later.

```ts
room.setKept(true);  // in your game server, like in setup or when players build their first base
```

A listed kept room stays on the game page's Rooms tab with nobody in it, like a server waiting for players (`Zaisma.rooms.list` says `isKept`). A world waking from its sleep runs `onRestored` with `restoreInfo.lostDurationSec` 0 and `restoreInfo.savedAt`, so you can grow crops for the time that passed, and it wakes on the game's live version, with `restoreInfo.savedVersionId` saying which one saved it. `room.end()` ends it for good, and `room.setKept(false)` makes it an ordinary room again. Saved worlds count toward the game's storage with its database, on its hosting meter: at the 10 GB a game can have, new rooms can't be kept until you make room, but kept rooms keep saving. List and delete them with `list_kept_rooms` and `delete_kept_room`, or `zaisma kept-rooms`. A room made with `room.reserve({ ..., isKept: true })` starts kept. On your own server the Node runner keeps them in `--room-state-file`.

`room.roomCode` tells the game server which room it's in, so a game with one shared world can keep only that room and turn players away from any other code, even from a changed page:

```ts
canJoin(state, player, room) { return room.roomCode === "WRLD22" || { refusalMessage: "Join the main world." }; },
onJoin(state, player, room) { room.setKept(true); },
```

Playing alone needs no room, so don't make one until others can join: time in a room counts toward hosting even with one player.

**Hosting.** Everything a game runs on Zaisma's servers (its rooms' awake time, connections and messages, its game server's CPU and starts, data Zaisma's relay sends its players, its database, and requests and schedule runs to its game server) counts on one meter, and every game gets a free allowance each month (UTC): 8 friends playing a real-time game every night use about a third of it, and it covers about 1,300 player-hours of an 8-player real-time game. Your dashboard and `get_stats` show it as a percentage, with what used it. Past it, a game keeps going only when its developer has added hosting credit and given it a monthly budget (`monthly_budget_cents`; see "Hosting and credit" in [docs/DEVELOPER-API.md](docs/DEVELOPER-API.md)). Otherwise its hosting pauses until the month resets: no new rooms open (joining fails with `error.code === "hosting_paused"`), no new relayed connections or requests start, and matches already running get an hour to finish (`room.endsAt`, the game server's `onEnding`, the SDK's `ending` event). Game files, saves, sign-in, publishing and spectators are never on the meter, and your own servers never are.

#### Spectators

A game server that turns watching on lets people watch a match without playing, like a tournament's crowd or friends waiting for the next round:

```ts
export default {
  maximumSpectatorCount: 20,   // up to 100; leave it out, or 0, and nobody can watch
  onSpectatorJoin(state, spectator, room) { room.send(spectator.id, { type: "snapshot", state }); },  // catch them up
  onSpectatorLeave(state, spectator, room) {},
  onTick(state, tickDurationSec, room) {
    room.broadcast({ type: "positions", positions: state.positions });                       // players and spectators
    room.broadcast({ type: "hands", hands: state.hands }, { audience: "players" });          // never the spectators
    room.broadcast({ type: "commentary", text: state.commentary }, { audience: "spectators" });
  },
};
```

```js
const room = await Zaisma.joinRoom({ isSpectator: Zaisma.rooms.isLinkedAsSpectator });  // in the game
room.isSpectator;    // watching: room.send and room.sendBytes throw error.code "spectator_cannot_send"
room.spectatorCount; // how many watch; the "settings" event says when it changes
```

A spectator gets everything the room sends everyone (`audience` picks who: `"everyone"`, the default, `"players"` or `"spectators"`, for `room.broadcast` and `room.broadcastBytes`), and `room.send(spectator.id, ...)` reaches one. They send nothing, so they can't bother players or dodge the room's limits; they're never in `room.players`, don't count toward `maximumPlayerCount` or "playing now", are never idle or away, and are free: watching isn't player time. `room.spectators` lists them, `joinInfo.isSpectator` tells `canJoin` a watcher is asking, and `room.kick` works on them too. A closed or full room can still be watched (watching a match under way is the point); a room with nobody playing can't (`room_not_running`), one whose audience is full answers `spectators_full`, and a player already playing in the room answers `already_playing`. When the last player leaves, the spectators are told the match ended.

On zaisma.com, Watch shows beside Join (friends playing, the Players plate, the Rooms tab) for games that take spectators, with the same rules as Join, and opens the game with `Zaisma.rooms.isLinkedAsSpectator` true. The Rooms tab and the Players plate say how many are watching, never who.

#### Players who walk away

Players who walk away stop holding seats and running matches, in every game, with no code:

- **Lost connections** (a closed laptop, lost signal): the SDK pings the room every 25 seconds without waking it, and a connection that stops answering is dropped about a minute later (within seconds in a real-time room). The SDK says goodbye as the page closes, so most players leave at once.
- **Idle:** after 10 minutes without input the SDK asks "Still there?" with a small plate at the top of the game for 30 seconds; no answer, and the player walks away. Rooms check for themselves too: a game that sends nothing at all for a minute past that counts as idle.
- **Hidden:** in a real-time room (one with `ticksPerSec`), a game hidden for 2 minutes counts as away.

A player whose connection drops stays in the match first, as away with reason `lost`, for 30 seconds while the SDK reconnects: `onAway` runs if your game server has one, every player's game sees `awayReason: "lost"` for them in `room.players`, and if they're back in time, `onBack` runs and they carry on where they were. Freeze their character meanwhile (in `onTick`, skip players whose `room.awayReason(playerId)` is `"lost"`), or do nothing and they stand still.

A player who walks away, or whose connection stays lost, leaves the match (`onLeave` with `leaveInfo.reason`) and the room holds their seat for 5 minutes: they come straight back to it with any input, or by reconnecting, and `onJoin` gets `joinInfo.isReturning`. Held seats count toward `maximumPlayerCount`, but players who walked away don't count as playing now or toward how full a room looks, and a room where everyone's away stops ticking. Once the seat runs out, the SDK offers their old room again if it has space. Zaisma never covers your game or sends anyone away from it for being idle.

When Zaisma restarts its rooms (every update to Zaisma does), a real-time match comes back where it was a few seconds before, and its players reconnect into it: the room saves its state every `stateSaveIntervalSec` (5 by default, 1 to 60), and `onRestored(state, restoreInfo, room)` runs once with `restoreInfo.lostDurationSec`, the seconds of play lost, so you can resync clocks or tell your players. Turn-based rooms save after every move, so they lose nothing. Publishing with `match_update_mode: "now"` moves every live match to the new version the same way, within seconds; your game server can hold it until the end of a round with `onVersionUpdate` ([Updates](docs/DEVELOPER-API.md#updates)).

Your game server picks what happens:

```ts
export default {
  idleCheck: "server",       // who checks: "server" (the default), "client" (each player's game decides), or "off"
  idleTimeoutSec: 300,       // seconds without input before "Still there?" (default 600)
  seatHoldDurationSec: 120,  // seconds a seat stays held (default 300, up to 1800; 0 for none)
  reconnectTimeoutSec: 30,   // seconds a player whose connection dropped stays in the match (default 30, up to 300; 0 to take them out at once)
  maximumRoomCountPerPlayer: 1,  // rooms of your game one player sits in at once (default 1, up to 10; see "Lobbies and matches")
  awayMode: "lobby",         // send players who walk away back to the room that made this one (room.reserve); "hold" is the default
  onAway(state, player, room, awayInfo) {},  // awayInfo.reason "idle", "hidden" or "lost"; for idle and hidden, the player stays and you kick, move or keep them
  onBack(state, player, room) {},          // a player onAway kept, or whose connection dropped, came back: send them the full state
  stateSaveIntervalSec: 5,   // how often a real-time room saves its state, for a restart to come back with (default 5, 1 to 60)
  onRestored(state, restoreInfo, room) {}, // the room restarted with its saved state: restoreInfo.savedAt, lostDurationSec and savedVersionId
  onVersionUpdate(state, versionUpdate, room) {}, // a version published "now" is coming: call room.applyVersionUpdate() at a good moment, or it switches at versionUpdate.appliesAt
  onPurchase(state, player, room, purchase) {}, // with purchase_delivery "game_server": a purchase to hand over, once; a throw tries again at the player's next join
  onRefund(state, player, room, purchase) {},   // a purchase handed over before was refunded or charged back: take back what you decide
};
```

In the game, all of it is optional:

```js
room.on("connectionStatus", (connectionStatus) => {});        // the socket: "connecting", "open", "reconnecting" or "closed"
room.on("away", ({ awayReason, seatHoldDurationSec }) => {}); // awayReason: "idle" or "hidden" (also room.awayReason); the seat is held that long
room.on("idle", ({ idleStatus }) => {});      // ask "Still there?" your way: "asking", then "answered" or "timed_out"
room.on("back", (back) => back.rejoin());     // back: isSeatHeld true, already in; false, the seat ran out and listening turns off rejoining by itself
room.on("players", (players) => {});          // each player's awayReason: "lost" while their connection dropped, "idle" or "hidden" if onAway kept them, else null
Zaisma.joinRoom({ idleCheckEnabled: false }); // no "Still there?" in this game (where idleCheck is "client", as with the relay, the room follows this)
```

Every number behind this (pings, timeouts, reconnecting, held seats, message limits, close codes) is in [Room connections](docs/DEVELOPER-API.md#room-connections).

Your own clients follow the same protocol: send the text `ping` every 30 seconds or so (the room answers `pong`), `{"type":"idle"}`, `{"type":"hidden"}` and `{"type":"shown"}` as they happen, and `{"type":"back"}` when the player returns. Their hello carries `"protocolVersionNumber":1`. Errors from the room are `{"type":"error","code":"room_full","message":"This room is full."}`, with codes in lowercase snake_case, one of: `rented_share_used`, `room_full`, `room_closed`, `ended`, `too_big`, `too_fast`, `bad_message`, `bad_pass`, `bad_player_token`, `no_hello`, `not_allowed`, `game_unavailable`, `busy`, `kept_out`, `refused`, `room_not_running`, `hosting_paused`, `account_needed`, `game_not_open_to_player`, `blocked_player_here`, `other_version`, `spectators_full`, `spectator_cannot_send`, `already_playing`, `bad_origin`, `send_queue_full`, `chat_not_here`, `chat_not_allowed`, `chat_empty`, `chat_too_long` or `chat_too_fast`. The SDK's types explain each one (`RoomErrorCode`); codes only grow within v1.

#### Requests to your game server

Not everything needs a room. A game's own game server can also answer plain requests from the game, for a leaderboard, a shop or a daily reward, in single-player games too. Give it `onRequest`, and the game calls it with `Zaisma.server.request`:

```js
// zaisma-server/index.js (or zaisma-server.js)
export default {
  async onRequest(player, request, server) {
    await server.database.query("CREATE TABLE IF NOT EXISTS rewards (player_id TEXT PRIMARY KEY, claimed_date TEXT NOT NULL)");
    if (request.type === "claimDailyReward") {
      const today = new Date().toISOString().slice(0, 10);
      const [claimed] = await server.database.query("INSERT INTO rewards VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET claimed_date = excluded.claimed_date WHERE claimed_date < excluded.claimed_date RETURNING player_id", [player.id, today]);
      return { isClaimed: Boolean(claimed) };
    }
    return { error: "unknown request" };
  },
};

// In the game:
const { isClaimed } = await Zaisma.server.request({ type: "claimDailyReward" });
```

- **`onRequest(player, request, server)`** answers what the game gets back: plain JSON, up to 1 MB, within 10 seconds. `player` is who sent it, from their player pass, so a player can't claim someone else's reward. `request` is the game's plain JSON, up to 16 KB, from the player's browser, so check it like any message and say what it's for in its `type`. There's no room and no state: what lasts goes in `server.database`, the same game database the game's rooms use.
- **Rooms or not:** a game server with only `onRequest` needs no `setup()` and runs no rooms; one with both does both. Requests work whatever the game's multiplayer setting, as long as its live version has the game server in its `zaisma-server/` folder or `zaisma-server.js`, run in the same sealed sandbox as its rooms.
- **Errors:** the game gets an `error.code`, one of: `rented_share_used`, `bad_request`, `too_big`, `bad_pass`, `bad_player_token`, `account_needed`, `game_not_open_to_player`, `game_unavailable`, `no_request_handler`, `game_server_error`, `hosting_paused`, `slow_down`, `bad_origin` or `busy`. `no_request_handler` means no `onRequest`; `game_server_error` means it threw, answered something that isn't plain JSON or over 1 MB, or took over 10 seconds (you see why with your game server's errors in the dashboard and `get_stats`, with the file and line); `slow_down` means over about 120 a minute from one address; `hosting_paused` answers HTTP 403. The pass's own are `account_needed` and `bad_pass`; `bad_player_token` is your own server's, for a game played off Zaisma (below). A game server that keeps running on too long (a loop that never ends) is paused for a few minutes.
- **Part of the game's hosting on Zaisma.** Each request, webhook event and schedule run counts on the game's hosting meter, and so does its CPU past the first 10 ms (see "Hosting" above). While the game's hosting is paused, requests answer `hosting_paused`. Your dashboard and `get_stats` show the month's count.
- **On your own server** the Node runner answers the same requests at `POST /v1/requests/<game>` on its port, with `server.database` its local SQLite file: `Zaisma.server.request(request, { serverUrl: "https://play.example.com" })`. Any server can answer them the same way: the body is `{ pass, request }` as JSON (sent as `text/plain`, so browsers need no preflight), and the answer `{ answer }` or `{ error: { code, message } }`.

#### Schedules

A game's own game server can also run by itself, for a daily reset, a weekly leaderboard or a persistent world's turns. List its `schedules`, each a name and a cron, and `onSchedule` runs at each:

```js
// zaisma-server/index.js (or zaisma-server.js)
export default {
  schedules: [
    { name: "daily-reset", cron: "0 0 * * *" },    // every midnight, UTC
    { name: "world-turn", cron: "*/15 * * * *" },  // every 15 minutes
  ],
  async onSchedule(run, server) {
    if (run.name === "daily-reset") {
      // Safe to run twice: it only resets what's older than this run.
      await server.database.query("DELETE FROM daily_scores WHERE scored_at < ?", [run.scheduledAt]);
    }
    if (run.name === "world-turn") await server.database.query("UPDATE crops SET growth = min(growth + 1, 10)");
  },
};
```

- **`cron`** is the usual five fields, minute hour day-of-month month day-of-week, always in UTC: numbers, `*`, ranges (`1-5`), steps (`*/15`) and lists (`1,15`). `"0 4 * * 1"` is Mondays at 04:00. So a schedule runs at most once a minute; anything faster belongs in a room's `onTick`. A cron that doesn't read stops the game server starting, and says why.
- **`onSchedule(run, server)`** gets `run.name`, `run.cron` (the cron with spaces tidied: trimmed, one space between fields) and `run.scheduledAt`, the minute it was due (an ISO time). There's no room, no player and no state: what lasts goes in `server.database`, the same game database the game's rooms and requests use. It has 30 seconds. A run can rarely come late or twice (after a restart), so make it safe to repeat, like a reset that checks `run.scheduledAt`.
- **Up to 10 schedules on Zaisma.** Each run counts as a request on the game's hosting meter, and a paused game's schedules don't run. They run with the live version's game server, whatever the multiplayer setting, within a minute of it going live; a version without them stops them, and so does a game taken down. A game server with only schedules needs no `setup()` and runs no rooms. Your dashboard and `get_stats` show each schedule with its next and last run, the runs per day, and any errors with the schedule's name, file and line.
- **On your own server** the Node runner runs the same schedules at the same minutes while it's up, with `server.database` its local SQLite file, and prints a run's errors. A run due while it's down is missed.

#### Messages between rooms

A game server reaches the game's other live rooms with a room message: `room.sendToRoom(roomCode, message)` tells one room (answering `{ isDelivered }`), `room.sendToEveryRoom(message, { labels })` tells every other room with someone in it, or only those holding every label given (answering `{ roomCount }`), and `room.listRooms({ labels })` lists them, newest first. Outside rooms, `onRequest`, `onSchedule` and `onWebhook` get the same on `server`, plus `server.getRoom(roomCode)` (the room and who's in it), `server.kickFromRoom(roomCode, playerId, { message, keepOut })` and `server.endRoom(roomCode, message)`. The receiving room's `onRoomMessage(state, roomMessage, room)` decides what its players see; without it, every player's game hears the room's `roomMessage` event. `roomMessage.senderKind` says who sent it (`room`, `server` or `developer`), with `fromRoomCode` for a room. A message is plain JSON up to 16 KB; a room sends up to 20 a second and takes up to 100, and the whole game sends to every room up to 10 times a minute.

A party leaving one world for another, the same code in Zaisma's rooms and on your own server with the Node runner:

```js
export default {
  setup: () => ({ partiesComing: [] }),
  async onMessage(state, player, room, message) {
    if (message.kind !== "travel") return;
    const { isDelivered } = await room.sendToRoom(message.toRoomCode, { kind: "party_coming", leaderName: player.name });
    if (isDelivered) room.moveTo(message.toRoomCode, { playerIds: [player.id] });
  },
  onRoomMessage(state, roomMessage, room) {
    if (roomMessage.message.kind !== "party_coming") return;
    room.broadcast({ kind: "notice", text: `${roomMessage.message.leaderName}'s party is on its way from ${roomMessage.fromRoomCode}.` });
    return { ...state, partiesComing: [...state.partiesComing, roomMessage.fromRoomCode] };
  },
};
```

On Zaisma, the developer API and MCP reach the same rooms (`send_room_message`, `send_to_every_room` now or at a set time, `list_rooms`, `get_room`, `kick_player`, `end_room`), for the game's own moderation page or a live event: see "Reaching live rooms" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md). On your own server the Node runner gives these calls among its own rooms, and Zaisma's API doesn't reach them.

#### Calling other servers, with secrets

A game's server can call your own server, a payment provider, Discord, GitHub or any other https API with plain `fetch()`, on the hosts you list for the game, and keep the tokens it needs as secrets:

```js
// zaisma-server/index.js: post each new top score to the game's Discord channel
export default {
  async onRequest(player, request, server) {
    if (request.type !== "score") return null;
    await fetch(server.secrets.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${player.name} scored ${request.score}!` }),
    });
    return { isPosted: true };
  },
};
```

```sh

## Room connections

How a room and each player's game stay in touch, the same in Zaisma rooms and on your own server (the Node runner): how a dead connection is noticed, what happens to a player whose connection drops or who walks away, the limits on what players send, and why a connection closes.

### Staying connected

- **The SDK pings** the room every 25 seconds (the room answers without waking up), and reconnects by itself when a ping goes unanswered for 15 seconds, or in a real-time room (one with `ticksPerSec`) after 8 seconds without a word from the room, which probes every 2 seconds (not while the player is away or the game is hidden).
- **Reconnecting** waits half a second, then doubles each try up to 8 seconds, with no limit, and `room.connectionStatus` is `"reconnecting"` meanwhile. Your game keeps the same room object: the `players` event and your game server's messages carry on once it's back.
- **The room drops** a connection with no ping or message for 75 seconds (a closed laptop, lost signal): Zaisma rooms check when one is due (a connection's 75 seconds, an idle player's time, a held seat), sleeping in between, the Node runner every 5. The SDK says goodbye as the page closes, so most players who leave do so at once.
- **`room.connectionStatus` is the socket only:** `"connecting"`, `"open"`, `"reconnecting"` or `"closed"`. Whether the player is in the match is `room.awayReason` (below), so a player who walked away with the socket still open stays `"open"`.
- **Sends wait while it's down:** reliable `room.send` and `room.sendBytes` calls made while `connectionStatus` isn't `"open"`, or while the player is away, are kept in order and go once the room lets them back in, before any latest-only sends that waited. Up to 60 wait (the room's burst, so the flush never trips `too_fast`); past that the oldest is dropped and the `error` event says `send_queue_full` once per outage. Both calls return `false` only once the room is gone (ended, kicked or left).

### Dropped players

A blip is the most common thing that goes wrong online, so a player whose connection drops stays in the match for a while instead of leaving it:

- **Away, reason `lost`:** the player stays in `room.players` for `reconnectTimeoutSec` (30 by default, 0 to 300). The game server's `onAway(state, player, room, { reason: "lost" })` runs if it has one, `room.awayReason(playerId)` answers `"lost"`, and every player's game sees `awayReason: "lost"` for them in `room.players` and the `players` event. They don't count as playing, nothing is sent to them, and their seat counts toward `maximumPlayerCount`. If they were the host, the next player is host until they're back.
- **Freeze them:** a game that does nothing shows them standing still. A real-time game can freeze their character, skip their turn or pause the match: in `onTick`, skip players whose `room.awayReason(playerId)` is `"lost"`, and in the game, draw them dimmed or "reconnecting" from `awayReason`.
- **Back in time:** the SDK reconnects by itself, `onBack(state, player, room)` runs (not `onJoin`, and `canJoin` isn't asked), and `awayReason` goes back to `null` for everyone. Send them the full state in `onBack`, since they missed what was sent meanwhile.
- **Not back in time:** they leave the match as before: `onLeave` with reason `lost`, and the room holds their seat for `seatHoldDurationSec`, so a later return gets `onJoin` with `joinInfo.isReturning`.
- **`reconnectTimeoutSec: 0`** takes a dropped player out of the match at once (`onLeave`, reason `lost`), as before this option.
- **`onAway` takes over idle and hidden too:** with `onAway`, a player who goes idle or hidden stays in the room until your game decides (below). To freeze dropped players while leaving idle and hidden ones to the room, read `room.awayReason` in `onTick` instead of adding `onAway`; `onBack` alone changes nothing else.

Real-time rooms notice a silent drop within seconds (their probes); turn-based rooms keep the slower 75-second check, so they can sleep between moves.

### Updates

A version you publish (or roll back to) reaches running matches at their next match, or now: `match_update_mode` `"next_match"` (the default) or `"now"` on `publish_version`, on `upload_files` and `POST /games/:slug/versions` with `publish_when_approved`, `zaisma publish --match-update-mode now`, `zaisma upload … --publish-when-approved --match-update-mode now`, or Update running games now on the dashboard.

- **Now, in a match:** every live room of the game hears it within seconds (a room that slept through it finds it within a minute of waking). Players' games get the room's `versionUpdate` event, `{ versionId, appliesAt, isReloading }`, to show a countdown or save. Without `onVersionUpdate`, the match switches 10 seconds later. With `onVersionUpdate(state, versionUpdate, room)`, the room waits for your game server: call `room.applyVersionUpdate()` at a good moment, like the end of a round, or it switches at `versionUpdate.appliesAt`, 5 minutes on.
- **The switch:** the room saves, its connections close with code `4004`, and the new version's game server starts from the saved state: `onRestored(state, restoreInfo, room)` runs with `restoreInfo.savedVersionId`, the version that saved it, so you can bring an older state up to date (or `room.end()` the match if you can't). When only the game server changed, players' games reconnect by themselves in a second or two. When the game's own files changed (`isReloading`), the game page reloads the game in place at the new version, with its save, and `Zaisma.joinRoom()` with no code brings the player back into the same room. Players come back as dropped players do (away, reason `lost`, for `reconnectTimeoutSec`, then a held seat), so a slow reload still finds its place. The game page's bar says Updating meanwhile; nothing covers the game.
- **Now, not in a match** (a single-player game, or a menu): never forced. The game page notices within 2 minutes. A game listening to `Zaisma.versions.on("update", (update) => …)` switches when it says, with `update.apply()` (at a checkpoint, back at its menu), and the page reloads it with its save; otherwise the bar beside the game shows Update, and the player taps it when they're ready, or gets the new version the next time they open the game.
- **Next match:** nothing changes for running matches: a room keeps the version it started on until its match ends.
- **A room on another version:** a player always plays the version their room runs. A Zaisma room whose game server runs another version than the player's game (an open tab from before a publish, or a friend's match still finishing on the version before) turns a newcomer away with `other_version`, and on the game's Zaisma page the game reloads at the room's version, with its save, and joins it; your game never sees it. While the room runs it, the game's address serves that version's files to the room's players, as long as it's one you could roll back to (the live version and the last 5 that passed), and not held or taken down. Players already in the room are never turned away this way, and rooms with a built-in game server have no version of their own. Outside Zaisma, through a tester link, or when that version is no longer kept, the join fails with `other_version`.
- **On your own server** `onVersionUpdate` never runs and `room.applyVersionUpdate()` does nothing: the game page still reloads players' games after a `now` publish when they're not in a match, and you restart your server to switch it (the Node runner brings its matches back, below).

### Restarts

Zaisma restarts its rooms whenever Zaisma itself is updated, and a match carries on:

- **Saved every few seconds:** a real-time room saves its game server's state every `stateSaveIntervalSec` (5 by default, 1 to 60), only when it changed, and once more when everyone walks away or leaves; a turn-based room saves after every change, as always. A state over 32 MB as JSON isn't saved: the game's logs say so once, and a restart starts that room fresh.
- **Back a few seconds behind:** the restarted room starts from the last save instead of `setup`; a real-time room (one with `ticksPerSec`) also runs `onRestored(state, restoreInfo, room)` once, and so does a turn-based room that had players in its match (it loses no moves, only the connections): `restoreInfo.savedAt` (an ISO time) and `restoreInfo.lostDurationSec`, the seconds of play since then that are lost. Use it to resync clocks or tell players.
- **Players come back as dropped players:** everyone who was in the match is away with reason `lost` (`room.awayReason` answers it in `onRestored`), `onAway` runs for each, and they have the whole `reconnectTimeoutSec` from the restart. Their connections drop (the Node runner closes them with code `1012` as it stops), the SDK reconnects to the same room by itself, and `onBack` runs for each one back; anyone who isn't leaves as `lost` (above).
- **A room that empties** keeps its saved state for a day, so players rejoining it find the match as it was (a real-time room's `onRestored` runs then too, with `lostDurationSec` 0: it saved as the last player left). A kept room keeps it until it ends (see Kept rooms below). A match that ends keeps nothing.
- **On your own server** the Node runner saves to its `--room-state-file` (`zaisma-room-states.sqlite`) the same way, and saves every room when it's stopped, so a clean restart loses nothing.

### Walking away

Players who walk away stop holding seats and running matches, with no code:

- **Idle:** after `idleTimeoutSec` without input (600 by default, 30 to 86400), the SDK asks "Still there?" for 30 seconds; no answer, and they walk away (`idleCheck`: `"server"`, the default, `"client"` or `"off"`).
- **Hidden:** in a real-time room, a game hidden for 2 minutes counts as away.
- **What happens:** with `awayMode: "hold"` (the default), they leave the match (`onLeave`, reason `idle` or `hidden`) and the room holds their seat for `seatHoldDurationSec` (300 by default, up to 1800, 0 for none); any input brings them back, and `onJoin` gets `joinInfo.isReturning`. `awayMode: "lobby"` sends them to the room that made this one (`room.reserve`). With `onAway`, they stay in the room and your game decides: kick them, move them or keep them.
- **In the game:** the `idle` event hands `{ idleStatus, answerTimeoutSec }`: `"asking"` when it's time to ask (listening replaces Zaisma's "Still there?" plate), then `"answered"` on input or `"timed_out"` as the room hears they walked away. The `away` event hands `{ awayReason, seatHoldDurationSec }` and `room.awayReason` says `"idle"` or `"hidden"` until they're back. The `back` event hands `{ roomCode, isSeatHeld, rejoin() }`: `isSeatHeld: true` once the room let them back into their held seat; `false` on their first input after the seat ran out, when listening for `back` leaves rejoining to your game (`back.rejoin()`), and without a listener the SDK rejoins by itself.

### Message limits

- **From each player:** up to 16 KB a message (or bytes), and 30 a second with a burst of 60. The SDK throws `too_big` before sending one over 16 KB; past the rate, that message is refused with an `error` event (`too_fast`) and the connection stays open.
- **Who sent it:** a message or bytes the game server passes on from one player carries `fromPlayerId` (its send options' `fromPlayerId`; the relay always sets it), and the game's `message` event hands `(message, fromPlayerId)`, `bytes` hands `(bytes, fromPlayerId)`, with `null` for the game server's own.
- **Join and setup data:** up to 4 KB of JSON (`joinData`, `setupData`).
- **From the room:** what your game server sends isn't capped, but a player who can't keep up is dropped (below).

### Ping and the room's clock

- **Ping:** the game server reads a player's round trip with `room.pingDurationMs(playerId)`, and the player's game reads its own with `room.pingDurationMs`: the same number, in milliseconds, smoothed so one slow packet doesn't make it jump. It's `null` until the first measurement, right after the player joins.
- **Measured by the room:** the room sends each player a small probe right after they join, every 2 seconds while a real-time room ticks (turn-based rooms keep sleeping between moves), and whenever 256 KB has gone out to them; the SDK answers it at once. Answers aren't game messages: they don't count toward a player's 30 a second, your message stats or the idle check. Since the room measures it, a player can only make their ping look worse by answering late, never better, so cap any lag compensation that uses it.
- **One clock:** `room.serverTimeMs()` is the room's clock now, in epoch milliseconds, on the game server (like `Date.now()`) and in every player's game, where the SDK estimates it from the probes. A time the game server sends means the same moment for everyone, like `{ startsAtMs: room.serverTimeMs() + 3000 }` for a countdown.

### Slow connections

A player whose connection can't keep up is dropped before the room has to hold a growing backlog for them: when a probe has gone unanswered for 8 seconds, or 2 MB has gone out to them since the last probe they answered. Their connection closes with code `4003` and they become a dropped player (above): away with reason `lost` for `reconnectTimeoutSec`, while the SDK reconnects by itself, so they come back caught up. Send a returning player the full state in `onBack`, and in `onJoin` when `joinInfo.isReturning`, not just what changed (state sync does it by itself). A room's memory for its players stays bounded, and one bad connection can't stall a match for everyone else.

Before that, a connection can be **backed up**: 64 KB or more sent to it and not through yet. On your own server, that's the socket's `bufferedAmount`; in Zaisma rooms, 64 KB or more sent since the last probe the player answered, while a probe of theirs is 250 ms later than their ping. State sync skips a backed-up player and latest-only messages wait for them (below), so a slow player never builds a queue of stale updates.

### State sync

An optional building block for real-time worlds, the same in Zaisma rooms and on your own server: your game server keeps its state as a plain object, and with `stateSyncEnabled: true` each player's game gets it without your code sending anything.

- **A full copy, then what changed:** a player gets their whole view as they join (and after reconnecting), then, after each tick (or each handler, in a turn-based game), only what changed since their last: `{ type: "state", serverTimeMs, full }`, then `{ type: "state", serverTimeMs, changes }`. Each change is `[path, value]` (set) or `[path]` (remove), with `path` the keys and indexes from the top: objects by key, arrays by index while their length stays the same and whole when it changes. `serverTimeMs` is the room's clock as it was sent. Nothing goes out when nothing a player sees changed.
- **Each player's view:** `stateView(state, viewer, room)` answers what `viewer` sees, like only what's near them in a big world or without the other team's hand; without it, everyone sees the whole state. It runs for every player on every tick, so keep it cheap, and it only answers: a call in it that changes the room or sends (`room.broadcast`, `room.kick`, `room.end`, ...) throws `room_call_unavailable`, which the game's logs show; reading (`room.players`, `room.roomCode`) works. A view over 1 MB as JSON isn't sent, and the game's logs say so once.
- **In the game:** `room.state` is this player's view (null until the first update), the `"state"` event hands `(state, changes)` (`changes` null after a full copy), and `room.smoothedState({ delayMs })` answers the state `delayMs` (100 by default, up to 1000) behind the room's clock, between the two updates around then: numbers blended in a straight line (integers in between come back as fractions, and an angle that wraps blends the long way), anything else as the older one had it. Predicting the player's own moves stays your game's.
- **Backed up:** a player whose connection is backed up gets nothing until they've caught up, then a full copy, so a slow spell costs one copy instead of a growing queue. There are no acknowledgements: over the room's connection a change can't be lost.
- **Where it runs:** where the state is, in your game server's sandbox on Zaisma (its time counts as the game server's CPU) and in the room on your own server. The state goes as JSON, so keep it plain; its updates count as `(state)` in `get_stats`.

### Latest-only messages

`room.broadcast`, `room.send`, `room.broadcastBytes` and `room.sendBytes` on the game server, and `room.send` and `room.sendBytes` in the game, take `{ delivery, latestKey }`:

- **`delivery: "reliable"`** (the default) reaches every player, in order.
- **`delivery: "latest_only"`** may be dropped: while a player's connection is backed up, a newer latest-only message with the same `latestKey` replaces the one waiting, and the newest goes once they catch up (oldest key first, before anything newer). For positions sent every tick, or where a player aims. A player keeps up to 64 waiting, one per key; past it, the least recently replaced is dropped.
- **`latestKey`**, up to 40 characters, says which messages replace each other, like `"position"`, and `latest_only` needs one: without it the send throws: in the game (the SDK) the error's code is `bad_send_option`, and on the game server it is a `GameServerError` with the code `bad_room_call` and the room call (like `room.broadcast`) as its field. Bytes have their own keys.
- **Zaisma rooms carry them over the WebSocket today**, since Cloudflare doesn't yet let Workers take WebTransport or WebRTC data channels; the same `delivery: "latest_only"` moves to real datagrams once it does, with no change to your game. **On your own server, the fast lane carries them as datagrams already** (below). Anything else for `delivery` or `latestKey` throws in your code, naming what to give: the SDK's error has the code `bad_send_option`; the game server's is a `GameServerError` (`bad_room_call`) saying the same.

### The fast lane to your own server

`Zaisma.joinRoom({ serverUrl: "wss://play.example.com", transport: "webtransport" })` joins a room on your own server over WebTransport (HTTP/3 over UDP) instead of the WebSocket. The Node runner serves it with `--webtransport-port`, `--certificate-path` and `--certificate-key-path` (`startServer({ webtransportPort, certificatePath, certificateKeyPath })`, all three or none); any other server can speak it too. `transport` is `"websocket"` (the default) or `"webtransport"`, else the SDK refuses it with `bad_transport`; a `serverUrl` that isn't `wss://` or `https://`, and Zaisma's own rooms, use the WebSocket either way. If WebTransport isn't there, its session is refused, or it isn't up within 3 seconds (`FAST_LANE_CONNECT_TIMEOUT_MS`), the room uses the WebSocket for the rest of its life and logs one console warning; a fast lane that worked and then dropped is tried again first. `room.transport` says what the connection uses now.

The wire:

- **The session** is at `https://<server>/v1/rooms/<game>/<code>`: the `serverUrl`'s host and port, with `wss:` read as `https:`. The browser sends the page's `Origin`; check it as you do for the WebSocket. The certificate must be a real one for that name (browsers check it as for any HTTPS site).
- **One bidirectional stream**, opened by the client first, carries every frame the WebSocket carries, in order: each is `[4-byte big-endian payload length][1-byte kind: 0 text, 1 bytes][payload]`. Text is the same UTF-8: the JSON messages (`hello`, `welcome`, `probe`, `probe_answer`, ...) and `ping`/`pong`. Bytes are the same binary frames: from the room, `[1-byte sender ID length][sender ID][bytes]`; from the client, the bytes alone.
- **A datagram** is `[1-byte kind][payload]`, with the same payloads, and carries only `latest_only` sends, both ways, when it fits the session's `maxDatagramSize`; a bigger one goes on the stream. Take datagrams only from a player you let in.
- **Closing:** the session's close info carries the WebSocket's close codes and reasons (`closeCode` 4000 to 4004, as in [Close codes](#close-codes)).

A server of your own that isn't the Node runner (Rust, C++, a studio's engine) needs to: accept WebTransport sessions at that path and check `Origin`; read the hello from the stream and verify its pass against your game's keys at `https://rooms.zaisma.com/v1/pass-keys/<gameSlug>`; answer each `probe` the room protocol says to send, and every `ping` with `pong`; send the same frames on the stream, and `latest_only` ones as datagrams when they fit.

### Room error codes

A room answers a refusal with `{ type: "error", code, message }`, then closes the connection (`4001`, or `1013` for `busy`); a message it can't take gets the same `error` and the connection stays open. In the SDK they are `error.code` and the `error` event.

| Code | Meaning |
| --- | --- |
| `room_full` | The room has no space for another player. |
| `room_closed` | The room isn't taking new players (`room.setOpen(false)`). |
| `ended` | The match is over. |
| `too_big` | A message over 16 KB, or `joinData` over 4 KB. |
| `too_fast` | More messages than the room takes (30 a second, burst of 60). |
| `bad_message` | A message the room couldn't read or use. |
| `bad_pass` | The player pass wasn't accepted; the SDK gets a new one and tries once more. |
| `bad_player_token` | A game played off Zaisma sent a `playerToken` your own server didn't take (its `identifyPlayer` said no, or it takes no guests); the game gets the player a new one. |
| `no_hello` | The first message wasn't a hello with a player pass (or, to your own server, a `playerToken`). |
| `not_allowed` | Only the game server or the room's host can do that. |
| `game_unavailable` | The game can't be played right now. |
| `busy` | The room couldn't take the player right now; the SDK tries again soon. |
| `kept_out` | The player was removed for the rest of the match. |
| `refused` | The game server's `canJoin` turned the player away. |
| `room_not_running` | The room isn't running, like one with nobody playing to watch. |
| `rented_share_used` | This player is on a rented-server network, and the share of the game's hosting such traffic gets is used; everyone else plays on. Zaisma's page tells them to turn off their VPN or sign in. |
| `hosting_paused` | The game's hosting is paused this month, or Zaisma's free room time ran out; new rooms open again when it resets or its developer adds credit and a budget. |
| `account_needed` | The game needs a Zaisma account for multiplayer, and the player is a guest. |
| `game_not_open_to_player` | The account is younger than the game's minimum age. |
| `blocked_player_here` | Someone the player blocked is in the room; `quickJoin` tries other rooms first. |
| `other_version` | The room runs another version of the game (see Updates above). |
| `spectators_full` | The room takes no more spectators. |
| `spectator_cannot_send` | A spectator tried to send to the room. |
| `already_playing` | A player in the room tried to watch it too. |
| `bad_origin` | The connection didn't come from the game's own page. |
| `send_queue_full` | The SDK's own: more than 60 sends waited while it reconnected, so the oldest were dropped. |
| `chat_not_here` | A chat message reached a room whose server doesn't take chat (an older runner). |
| `chat_not_allowed` | `room.chat` from a guest, or a player whose chat is set to nobody or paused (`room.canChat` is `false`). |
| `chat_empty` | `room.chat` with nothing but spaces. |
| `chat_too_long` | `room.chat` over 2000 characters. |
| `chat_too_fast` | More than 20 chat messages in 10 seconds from one player. |
| `bad_region` | The SDK's own: a `region` that isn't a continent code (`"AF"`, `"AN"`, `"AS"`, `"EU"`, `"NA"`, `"OC"` or `"SA"`). |
| `bad_idle_timeout` | The SDK's own: an `idleTimeoutSec` that isn't from 30 to 86400. |
| `bad_transport` | The SDK's own: a `transport` that isn't `"websocket"` or `"webtransport"`. |
| `zaisma_rooms_not_used` | The SDK's own: the game doesn't use Zaisma rooms, so there are none to join or list. |
| `no_online_play_in_preview` | The SDK's own: the game is a preview of a version players don't have yet, which never plays online, so a test build never reaches live rooms. Test online play with `npx @zaisma/cli play-locally`, or publish the version and play it through a tester link (`add_tester_link`). A draft or private game's own page plays its live version online for its developer. |

### Close codes

| Code | Why | What the SDK does |
| --- | --- | --- |
| `4000` | The match ended (`room.end`, or Zaisma ending it) | Stops: `connectionStatus` `"closed"`, after the `ended` event with its `endReason` |
| `4001` | The room refused the player (an `error` with the code comes first, like `room_full`, `bad_origin` or `game_unavailable`), removed them (`room.kick`), or they joined from another tab | Stops: `connectionStatus` `"closed"` |
| `4002` | The seat held for a player who walked away ran out | `connectionStatus` `"closed"`; waits for the player to come back, then the `back` event with `isSeatHeld: false` |
| `4003` | The connection stopped answering probes or fell too far behind | Reconnects by itself, as a dropped player |
| `4004` | The match switched to a version published `"now"` | Reconnects by itself, or the page reloads the game at the new version (`isReloading`) |
| `1012` | The Node runner is restarting | Reconnects by itself, as a dropped player |
| `1013` | Zaisma rooms are busy (an `error` with `busy` comes first) | Reconnects by itself, waiting longer each try |

Any other close (a network drop) reconnects by itself too.

### Room events

Every event the game's room object has, and what its listener gets. Within v1, events and error codes only grow, so keep a `default` for ones you don't know.

| Event | Listener gets |
| --- | --- |
| `message` | `(message, fromPlayerId)` |
| `bytes` | `(bytes, fromPlayerId)` |
| `state` | `(state, changes)` |
| `players` | `(players)`, each `{ id, name, kind, awayReason }` |
| `connectionStatus` | `(connectionStatus)` |
| `settings` | `{ isListed, isOpen, friendJoinsEnabled, name, labels, spectatorCount }` |
| `ended` | `{ message, endReason }`: `game`, `no_players`, `hosting_paused`, `kept_room_deleted`, `game_unavailable` or `game_server_stopped` |
| `ending` | `{ endsAt }` |
| `endingCancelled` | `()`: the end `ending` announced is off, since the game's hosting started again; `room.endsAt` is `null` |
| `kicked` | `{ message, isKeptOut }` |
| `chat` | `{ fromPlayerId, text, hasSwearing, hasSlur, sentAt }`: another player's chat line (see Chat) |
| `move` | `{ roomCode, follow(), join(joinOptions) }` |
| `moved` | `{ roomCode, fromRoomCode }` |
| `idle` | `{ idleStatus, answerTimeoutSec }` |
| `away` | `{ awayReason, seatHoldDurationSec }` |
| `back` | `{ roomCode, isSeatHeld, rejoin() }` |
| `muted` | `(playerIds)` |
| `error` | `{ code, message }` |
| `versionUpdate` | `{ versionId, appliesAt, isReloading }` |
| `roomMessage` | `{ message, senderKind, fromRoomCode, sentAt }`: a room message for a room whose game server has no `onRoomMessage` (see Reaching live rooms) |

The SDK and rooms say which messages they speak with `protocolVersionNumber` (1 today): the SDK sends it in its hello, and the welcome answers the room's. A room skips a message type it doesn't know, so a newer SDK still plays in an older room.
