# A short first press

Open this when the game is more than a few MB, or when `performance_check` on a version says its first frame is slow. A player who presses Play and waits on a black screen leaves; one who sees something move in a second or two stays.

## The rule

Draw a first frame soon, show a loading screen if the rest takes time, and load the rest as it's needed, not all before the first frame.

## By size

- **A one-file or small game (under about 5 MB).** Nothing to do: it loads at once. Keep images and audio compressed, and don't load a big font or library the game doesn't use.
- **A mid-size game (5 to 100 MB).** Load what the first screen needs, show the menu, and load the levels, music and the rest while the player reads it. Show progress on anything that takes more than a second or two.
- **A big 3D build (100 MB and up, PC-grade).** Split it: a small first download that draws a menu or a loading screen within seconds, then the world in pieces, the first level first, the rest in the background or as the player reaches it. Every engine has a way: Unity's Addressables, Godot's PCK files loaded at runtime, glTF scenes streamed one by one in Three.js or Babylon.js.

## Making it smaller

`performance_check` (on `get_version`, `get_game` and in the upload command's output) says how the version started in headless Chrome: `loading_duration_sec` to the first frame, `start_download_size_bytes` before it, and notes with a fix for each. The ones that save the most:

- **Textures as KTX2** (Basis Universal): about a quarter of the size and of the graphics memory of PNG or JPEG for WebGL and WebGPU games.
- **Audio as Ogg Opus** or a compressed format instead of WAV.
- **Models with mesh compression** (meshopt or Draco).
- **A release build,** never a development or debug build: they're bigger and slower.
- **Compressed builds are fine.** Upload Unity's or Godot's `.br` and `.gz` files with `npx @zaisma/cli upload` which unpacks them.

## What not to do

- Don't hold the first frame for the whole game to download.
- Don't hide a long load behind a blank page: show progress, even a simple bar.
- Don't fetch files from other sites at start: the upload command downloads them into the game, so they come from Zaisma's servers.
