# Phones and touch

Open this when the game should play on phones or tablets. Set what it supports with `update_game`: `devices` (`phone`, `tablet`, `computer`), `controls` (`touch`, `keyboard_mouse`, `gamepad`) and `screen_orientation` (`portrait`, `landscape`, `either`). Zaisma's pages tell players what it supports.

## Touch

- **Use pointer events** (`pointerdown`, `pointermove`, `pointerup`) rather than mouse events alone: one code path for mouse, touch and pen.
- **Draw controls on screen** for a touch player: a stick, buttons, or tap and drag. Make each one big enough for a thumb, about 48 CSS pixels at least, and away from the screen's edges, where phones take swipes for themselves.
- **No hover.** Nothing a touch player needs should appear only on hover.
- **Stop the page from moving.** Set `touch-action: none` on the game's canvas, so a drag plays the game instead of scrolling or zooming the page.
- **Multi-touch.** Track each pointer by its `pointerId`, so a thumb on the stick and a thumb on fire both work.

## Screen sizes

- **From 320 by 667 up.** A small phone in portrait is 320 CSS pixels wide; the game should fit and stay usable there, and up to a 4K monitor.
- **Size to the space, not the screen.** The game runs in a frame on its Zaisma page, so size the canvas to `window.innerWidth` and `window.innerHeight` and redraw on `resize`.
- **Sharp on dense screens.** Size the canvas's drawing buffer by `devicePixelRatio`, capped at 2 or 3 for big 3D games, where a full-density buffer costs too much.
- **Text that reads.** At least about 14 CSS pixels for anything the player must read.

## Orientation

Pick the one the game plays best in, and set `screen_orientation`. A landscape game on a phone held upright should say "Turn your phone" rather than draw tiny: check `window.innerWidth > window.innerHeight` on `resize`.

## Hidden and covered

- **Pause when hidden.** A player who switches apps or tabs comes back to the same moment: pause on `visibilitychange` when `document.hidden`, and mute the audio. In a real-time room, a game hidden for 2 minutes counts as away.
- **Covered by Zaisma.** `Zaisma.page.coveredBy` (and its `coveredBy` event) says when the buy sheet or a card covers the game; pause input then.
- **Audio after a tap.** Phones start audio only after the player touches the screen: start it on the first `pointerdown`.

## Performance

A mid-range phone has a fraction of a PC's graphics power and memory. Offer lower settings, or pick them from the screen's size; keep textures compressed (`loading.md`); and test on a real phone, or at least the browser's phone emulation at 320 by 667.
