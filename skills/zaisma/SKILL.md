---
name: zaisma
description: Make, upload, publish, update or fix a browser game on Zaisma (zaisma.com), from a one-file .io game to a PC-grade 3D build. Use when the developer wants a game playable from one link in any browser, asks to put a game on Zaisma, add online play, rooms, saves, accounts or selling to a Zaisma game, or hits a Zaisma error, hold or rejection.
---

# Zaisma

Zaisma hosts browser games: any web game, from any engine, plays from one link (`zaisma.com/g/<slug>`) in any browser, as a guest, with no install. It takes no cut of sales and charges no fee to list; each game gets free hosting every month, and only a game that grows past it pays for hosting, a few cents a player. Zaisma's developer tools are open source, so a game is never locked in: every building block it runs (rooms, player passes, saves) also works on the developer's own server.

This skill is the workflow. The references beside it hold the details; open one only when the game needs it (the table at the end says when).

## Connect

Every step goes through Zaisma's MCP at `https://zaisma.com/mcp`: connect it in the AI tool and sign in, or send an API key (made on zaisma.com/account) as `Authorization: Bearer <key>`. The same calls are a REST API at `https://zaisma.com/api/dev` (`references/developer-api.md`). Bigger builds go through the upload command, `npx @zaisma/cli`, with `ZAISMA_KEY` set to an API key.

`get_access` says what the key can do and what the account has earned. Until the beta, only accounts Zaisma adds can make, upload and publish games: the others get `publishing_not_open`.

The MCP also serves this skill and its references as resources (`zaisma://skill`, `zaisma://sdk`, `zaisma://errors` and the rest), and three prompts: `make_game`, `publish_game` and `fix_problem`.

## The workflow

1. **Make the game.** `create_game` with a title (and a slug, or one is made from the title). It starts as a draft only its developer can see.
2. **Try it first, on this computer.** `npx @zaisma/cli play-locally` in the game's folder runs the game and its game server with no key or internet; the bench's Add a player opens a second player. Run it with `--no-open --json` in the background to test it yourself through the bench's API at `http://localhost:4800/bench/api` (`references/game-server.md`). This is where multiplayer is tested while building: it runs the same game server, SDK and game page as Zaisma, and costs no review. A preview link doesn't join rooms, so never publish just to test rooms.
3. **Check, then upload a version.**
   - Under 5 MB (a single-file HTML game and the like): `check_game`, then `upload_files` with the file contents.
   - Bigger: `npx @zaisma/cli upload <folder> --game <slug>`. It runs the same check first (`npx @zaisma/cli check <folder>` runs it alone, with no key), downloads files the game loads from other sites, unpacks pre-compressed builds and sends only changed files.
   - The folder needs an `index.html` at the top.
4. **The scan.** Every version is scanned, usually in under a minute: malware, known images and Zaisma's own file checks. `get_version` shows the result, and `performance_check` on it says how the game started in Chrome, with notes on what would make it much smaller. A held version waits for a person, usually within a day.
5. **Show the developer the preview link.** A passed version gets a private preview link that opens only for its developer. Always show it before publishing.
6. **The AI review.** A version others can reach gets an AI review against the content rules before it goes live. `is_ai_review_needed_to_publish` and `usual_ai_review_duration_min` on the version say so first: tell the developer how long it usually takes, never as a promise. `ai_review_speed` says whether it runs at once (a small fix of 1 MB or less of new code to a game that passed) or in a batch. Start it ahead of a launch with `start_ai_review`. Reviews count on the game's hosting meter. When a live game breaks, roll back first (publish the last version that passed: free and instant, no review), then publish the fix. A developer who has earned it (`get_access`, `standing.publish_before_ai_review_enabled`) can go live at once with the review pending. A game only its developer can reach never gets one.
7. **Publish.** `publish_version` makes a passed version live, now or at `scheduled_publish_at`, and rolls back to an older one the same way. A publish is a quiet patch unless `is_big_update` is true (with `patch_notes`): only that shows players the Updated tag. `match_update_mode: "now"` switches running matches within seconds instead of at their next match.
8. **Choose who plays.** `update_game` with `visibility`: `listed` (everyone, in Zaisma's lists from the first day), `unlisted` (anyone with the link), `private` or `draft`. To let testers play first, keep it private and make tester links with `add_tester_link`. Before a multiplayer game goes public, test it once on Zaisma's rooms through a tester link on the live version (`version_choice: "live"`): that's where the game server's CPU limits, real networks and the chat filter show.

**Ask the developer first** before making a game players can play private or a draft again (they lose access), and before ending a live room; those calls need `"confirm": true`. Anything that spends money (top-ups, budgets, Stripe) or deletes a game others played waits for the developer's passkey on zaisma.com: show them `confirm_url` from the `confirmation_needed` answer.

**Show it well.** A listed game needs a cover and at least one gallery picture (`add_image`); the cover guide is at zaisma.com/developers/covers and the background guide at zaisma.com/developers/backgrounds. `preview_game_page` pictures every place players meet the game before anything is sent.

## Pick the path by the game

Zaisma hosts everything from a one-file .io game to a PC-grade 3D build. Use only the pieces the game needs, and never assume a game is small or big.

| The game | What it needs |
| --- | --- |
| A one-file or small single-player game | Nothing more: `check_game`, `upload_files`, publish. Progress in localStorage or IndexedDB becomes a cloud save by itself. |
| A turn-based or casual online game | Rooms (`Zaisma.joinRoom()`), a game server for its rules, room links to invite friends. |
| A real-time online game (a shooter, a racer, a brawler) | Rooms, an authoritative game server with `ticksPerSec`, state sync, and the multiplayer guide's real-time part. |
| A big 3D build (Unity, Godot, Bevy, Three.js) | The upload command, loading in pieces, compressed textures and audio, and the loading guide. |
| A game that sells | Items (`set_item`) and the buy sheet, paid to the developer's own Stripe with no cut; or sell the whole game once (`full_game_item_name`). |

The building blocks, each optional:

- **Rooms and a game server:** `Zaisma.joinRoom()` puts players in a room run by the game's server, which holds the official state and checks every move. It runs on Zaisma or on the developer's own server (`npx @zaisma/game-server@1`). Reference: `references/game-server.md`; how to make it hold up on a weak connection: `references/multiplayer.md`.
- **Player accounts and passes:** guests play at once; `Zaisma.player.getPass()` gives a signed pass any server can check; a game can ask a guest to sign in with `Zaisma.player.signIn()`. Reference: `references/sdk.md`.
- **Cloud saves:** a signed-in player's localStorage and IndexedDB follow them to every device with no code. `references/saves.md` says when and what to save.
- **A database** for the game, from its game server: `query_database`, `batch_database`.
- **Items and the buy sheet:** `set_item`, `Zaisma.items.buy()`, purchases delivered to the game or its server.
- **Backgrounds:** an image or a shader behind Zaisma's glass on the game's page (`set_background`, `check_shader`).
- **Webhooks, secrets, sign in with Zaisma, logs and stats:** `references/developer-api.md`.

The SDK is the script `_zaisma/v1.js` (`<script src="_zaisma/v1.js"></script>` in the game's index.html), with its types beside it as `_zaisma/v1.d.ts`; `references/sdk.md` is the same reference.

## Guests, chat and preset phrases

Guests never type or speak to other players: Zaisma allows no free text chat and no free voice chat for guests, so nobody can use chat to reach younger players or move them to another app. That limit is on free text and free voice, not on talking. Give guests preset phrases and emotes the game picks, and they can be funny, rude and edgy ("you're trash", "you suck" and the like are fine): send the phrase's ID with `room.send`, and draw it in the game. `room.canChat` says whether this player may use `room.chat`; hide the chat box when it's `false`.

## Errors, holds and findings

Every error answers `{ "error": { code, message, field, fix, message_for_people, retry_after_sec, help_url } }`:

- Do what `fix` says. Never guess beyond it.
- `field` is the input at fault; `retry_after_sec` is how long to wait when waiting helps.
- `message_for_people` is what Zaisma's pages would show: show it to the developer as it is.
- `help_url` is the code's page (zaisma.com/developers/errors/<code>): what it means and the general fix. `references/errors.md` lists every code.

Every hold, rejection and takedown says why, as `review_reason` (on a game, version or image, and in `get_history`) and as a version's findings: a code, a plain message, the `content_rule` it's about and a fix. Tell the developer the message and the fix, and do what the fix says.

## The forum

Zaisma's developer forum is where developers and their AI talk with the people who build Zaisma. For any question about Zaisma itself, `search_forum` first: it's faster and more current than a web search. On a Zaisma bug, a limit that blocks the developer, a confusing error or a missing feature: `search_forum` with the code or a short search; if it's there, vote, reply, or send the developer's own case privately with `message_zaisma`; otherwise `post_topic` with what you did, what you expected, what happened, the exact error and the call. Topics are public: anything private goes in `message_zaisma`. Never post API keys, passwords or players' details.

## Names

Every name in the API, MCP, SDK and game server says what it holds, its kind and its unit: `file_count` is a number, `play_duration_min` minutes, `size_bytes` bytes, `*_at` an ISO time in UTC, an ID says its kind (`version_…`, `topic_…`), and a plural is always a list. `references/naming.md` has the rules and the glossary.

## When to open a reference

| Open | When |
| --- | --- |
| `references/multiplayer.md` (`zaisma://multiplayer`) | The game has online play: rooms, a game server, or players on a weak connection. |
| `references/loading.md` (`zaisma://loading`) | The game is more than a few MB, or `performance_check` says its first frame is slow. |
| `references/phones.md` (`zaisma://phones`) | The game should play on phones or tablets. |
| `references/saves.md` (`zaisma://saves`) | The game keeps progress. |
| `references/sdk.md` (`zaisma://sdk`) | Writing code that calls `Zaisma.*` in the game. |
| `references/game-server.md` (`zaisma://game-server`) | Writing the game server, running it on the developer's own server, or testing with play-locally. |
| `references/errors.md` (`zaisma://errors`) | An error code isn't clear from its answer. |
| `references/naming.md` (`zaisma://naming`) | Naming fields, options or code that talks to Zaisma. |
| `references/developer-api.md` (`zaisma://developer-api`) | Any call's fields and answers, the REST API, webhooks, the upload command. |
