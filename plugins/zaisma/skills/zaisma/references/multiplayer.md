# Online play that holds up

Open this when the game has online play. It covers what Zaisma's rooms already do for a player whose connection is weak, and what the game itself has to add so it doesn't feel broken. The calls and options here are in `sdk.md` and `game-server.md`.

## Starting from the online core

For a game whose players move characters, share things, send events or take turns, start from the piece `@zaisma/net` (`npx @zaisma/cli pieces add @zaisma/net`, reference in its `index.d.ts`) instead of writing the netcode: the game declares what each thing shares and how a character moves in one step, and the piece does prediction, smoothing, the server's input buffer, late joiners, leavers and turns, the same on the relay and with a game server. What follows still applies to everything else the game sends.

## What the rooms already do

- **Reconnecting.** The SDK pings the room and reconnects by itself when the connection goes quiet, with no limit on tries. The game keeps the same room object, and `room.connectionStatus` is `"reconnecting"` meanwhile (`"connecting"`, `"open"`, `"reconnecting"` or `"closed"`).
- **Sends wait while it's down.** Reliable `room.send` calls made while the connection is down are kept in order and go once it's back, up to 60; past that the oldest is dropped and the room's `error` event says `send_queue_full` once.
- **A dropped player keeps their seat.** A player whose connection drops is away with reason `lost` for `reconnectTimeoutSec` (30 seconds unless the game server says otherwise, 0 to 300). They stay in `room.players` with `awayReason: "lost"`, nothing is sent to them, and their seat stays theirs. Back in time, the game server's `onBack(state, player, room)` runs; not back in time, `onLeave` with reason `lost`, and the room holds their seat for `seatHoldDurationSec`.
- **Slow connections are dropped early.** A player whose connection can't keep up (a probe unanswered for 8 seconds, or 2 MB sent since their last answer) is closed with code `4003` and becomes a dropped player, so one bad connection never stalls the match for everyone.
- **One clock and the ping.** `room.serverTimeMs()` is the room's clock on the game server and in every player's game. `room.pingDurationMs` is the player's round trip in milliseconds, measured by the room, so a player can only make it look worse, never better.
- **State sync.** With `stateSyncEnabled: true` on the game server, each player gets a full copy of their view as they join or reconnect, then only what changed. `stateView(state, viewer, room)` cuts what each one sees. A backed-up player gets nothing until they've caught up, then one full copy.
- **Restarts.** Zaisma restarts its rooms when Zaisma is updated: a real-time room saves its state every `stateSaveIntervalSec`, comes back from the save, and runs `onRestored(state, restoreInfo, room)`; every player comes back as a dropped player would.

## What the game must do

1. **Keep the game server in charge.** The game sends input ("move left", "fire at x, y"), never results ("I hit them", "I have 500 coins"). The game server checks every move against its own state and decides what happened. A game that trusts a player's results is a game anyone can cheat in.
2. **Show a dropped player as dropped.** Read `awayReason` from `room.players` (and the `players` event). Draw a `lost` player frozen, dimmed or marked "reconnecting", never running on in place. On the game server, skip `lost` players in `onTick` (`room.awayReason(playerId)`), or pause the match or skip their turn.
3. **Send the whole state to a player who comes back.** They missed what was sent meanwhile. Send it in `onBack`, and in `onJoin` when `joinInfo.isReturning`, not just what changed. State sync does this by itself.
4. **Show the player their own connection.** Listen for the room's `connectionStatus` event and show a small "Reconnecting…" while it's not `"open"`. Don't cover the game or end the match for a blip.
5. **Send less while it's down.** Movement and aim replace each other, so send them with `{ delivery: "latest_only", latestKey: "move" }`: only the newest waits, and a stale queue never builds. Keep reliable sends for things that must all arrive, like a purchase or a turn.
6. **Handle the end of the room.** Listen for `ended` and `kicked`, and give the player a way back to a menu or a new match.

## Turn-based games

A card game, a board game or a word game needs only the first four: the server checks each move, a dropped player's turn waits or is skipped by the game's own rule, a returning player gets the whole board, and the game shows the connection. Turn-based rooms sleep between moves and notice a silent drop within about 75 seconds, which is fine for turns.

## Real-time games

A shooter is the measure: if a shooter feels fair on a 150 ms connection with a little loss, every other real-time game will too.

- **Tick rate.** `ticksPerSec` on the game server runs `onTick(state, tickDurationSec, room)` that many times a second. 20 to 30 suits most action games; 60 only when the game truly needs it, since every tick is CPU on the game's hosting meter. Players' input reaches `onMessage` just before the next tick, in order.
- **Sending.** Send input when it changes, not every frame, and positions and aim with `{ delivery: "latest_only", latestKey }`. The SDK combines what the game sends at once into one message, keeps sends under the room's 30 a second by combining instead of failing, and skips a latest-only send that didn't change; leave both on unless the game server needs every send alone (`joinRoom({ sendCombiningEnabled: false, unchangedSkippingEnabled: false })`). Each message a room gets is billed.
- **Interpolation.** Draw other players from `room.smoothedState()` (or `room.smoothedState({ delayMs: 150 })`), the state a moment behind, blended between updates, so they move evenly however packets arrive. Blend angles that wrap around yourself.
- **Prediction.** Move the player's own character at once on their input, from the game's own copy of the rules, then correct it gently toward what the server says when its update arrives. Without prediction, every move waits a round trip and the game feels heavy. The SDK leaves prediction to the game.
- **Lag compensation.** For hits, the game server checks a shot against where targets were when the shooter saw them: keep a short history of positions (a few hundred milliseconds), and rewind by the shooter's `room.pingDurationMs(playerId)`. Cap the rewind (about 200 ms), since a slower connection should never be an advantage.
- **Times on one clock.** Send times as `room.serverTimeMs()` values, like `{ startsAtMs: room.serverTimeMs() + 3000 }` for a countdown, so they mean the same moment for every player.
- **Test it on a bad connection.** Run `npx @zaisma/cli play-locally`, add a second player, and throttle one tab's network in the browser's developer tools (a slow 4G preset, or offline for a few seconds): the other player should see them freeze, then catch up, and they should see "Reconnecting…", then the whole match back.
