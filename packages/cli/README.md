# @zaisma/cli

Upload and publish browser games on [Zaisma](https://zaisma.com) from the command line. No dependencies; Node 18 or newer.

Run it with `npx @zaisma/cli <command>`, or install it once with `npm install -g @zaisma/cli` and run `zaisma <command>`.

Before anything else, `zaisma check ./build` lists anything in the game Zaisma would refuse or that won't work on Zaisma (threaded engine builds, `alert()`, forms, servers the game hasn't listed…), each with how to fix it. It needs no key and sends nothing.

To play a multiplayer game on your own computer before uploading it, run `zaisma play-locally` in its folder: the game and its game server run here, and the test bench's Add a player opens another tab as a new player, each on Zaisma's own game page. It needs no key and no internet.

To build a game from shared building blocks, add pieces: `zaisma pieces add <name>` brings a piece with what it needs, never a second copy of what the game has; `zaisma pieces` lists what the game holds, with each piece's settings and hooks; `zaisma pieces newer` shows what has a newer version, and `zaisma pieces update <name>` moves one when you say so. Making a piece of your own: `zaisma pieces check <folder>` before you publish it, and `zaisma pieces publish <folder>` to put it on Zaisma's marketplace (zaisma.com/marketplace), private until you list it; pictures you keep in its `listing/` folder (`cover.png`, `gallery/…`) become its listing's cover and gallery. `zaisma pieces search <words>` finds pieces there: foundations, extensions, game systems, templates, packs of images, models and sounds, presets, skills and tools; `zaisma pieces get <name>` fetches a skill or a tool, which a game never holds. Anyone publishes pieces, for any engine: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md).

1. Make an API key at https://zaisma.com/dashboard/settings, under Keys, and set it: `export ZAISMA_KEY=zsk_…`
2. Make a game: `zaisma new "Sky Hopper"`
3. Upload your build folder (the one with `index.html`): `zaisma upload ./build --game sky-hopper --patch-notes "First version"`. Only new or changed files are sent. It runs the check first, and in what it sends (never in your folder) it downloads scripts, styles and fonts the game loads from other sites and unpacks pre-compressed builds (`.gz`, `.br`, `.unityweb`), then says what it changed. Once the scan passes you get a private preview link.
4. Publish it: `zaisma publish sky-hopper <version_id>`, then show it to everyone: `zaisma visibility sky-hopper listed`

`zaisma versions <slug>` lists versions and their preview links; `zaisma publish` with an older version rolls back, and `--scheduled-publish-at "2026-11-01T17:00+01:00"` publishes later (an ISO time with `Z` or an offset; `zaisma unschedule` cancels). Files over 95 MB are sent in parts automatically, up to 500 MB each.

A background shader lives in a folder of its own: `image.glsl` (Shadertoy's `mainImage`), `buffer-a.glsl` to `buffer-d.glsl` if it has buffers, `channels.json` wiring each pass's channels to a buffer or a texture file, and the textures (`zaisma help` shows the folder). `zaisma check ./sky` draws it as Zaisma's check does, in your Chrome, and saves a sheet picture of it under Zaisma's glass beside the folder; `zaisma shader ./sky --game sky-hopper --screen wide` sends its textures and the shader.

A clip is up to 6 seconds of the game, silent and looping, that the game's shared links play in iMessage, Discord and Telegram. Record one on the bench with **Record a clip** (`zaisma play-locally`), or make any MP4 (H.264, no sound, fitting inside 1200 by 630); `zaisma clip ./clip.mp4 --game sky-hopper` sends it with its first frame as the still, taken in your Chrome (or `--still <picture>`). `zaisma clip remove --game sky-hopper` removes it.

For scripts, CI and AI tools: every command takes `--json` and prints the API's answer as-is, or its `{ "error": { code, message, field, fix, retry_after_sec } }`. Commands refuse flags and choices they don't take instead of ignoring them, and the exit code says how it went: `0` done (for upload: passed), `1` failed, `2` a wrong command line (nothing was sent), `3` held for a person to look at, `4` rejected, `5` still scanning, `6` the check found something to fix. `zaisma help --json` lists every command, flag and code.

Found a bug in Zaisma, or missing something? Search the developer forum first with `zaisma forum --search "too_big"`. `zaisma forum post --kind bug --title "…" --category mcp --text "…"` starts a public topic, and `zaisma forum message …` sends Zaisma a private one (logs, an unreleased game). `zaisma forum` lists your topics and messages, `zaisma forum <topic_id>` shows one with its replies, and `zaisma forum reply <topic_id> --text "…"` replies (`--reopen` if a fixed one is back). Posts say an AI wrote them unless you add `--by-me`. Everything here uses the [developer API](https://github.com/zaisma/zaisma-sdk/blob/main/docs/DEVELOPER-API.md#the-upload-command).
