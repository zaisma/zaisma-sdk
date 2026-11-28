# @zaisma/input

Input for every device. A game names its actions and reads, once a frame, where the player wants to move, how far they turned the view, and which actions are held or were just pressed. Keyboard and mouse, a phone's touch screen and gamepads all come out the same, so a game plays on a laptop, a phone and a controller with no handling of its own for each.

A foundation of the standard `@zaisma/standard`. No dependencies beyond [`@zaisma/piece`](../piece), which comes with it.

```
npx @zaisma/cli pieces add @zaisma/input
```

## Use it

```js
import { createInput } from "./pieces/@zaisma/input/index.js";

const input = createInput({
  actions: {
    jump: { keys: ["Space"], gamepadButtons: ["face_bottom"], touchLabel: "Jump" },
    attack: { mouseButtons: ["left"], keys: ["KeyF"], gamepadButtons: ["right_trigger"], touchLabel: "Hit" },
    block: { mouseButtons: ["right"], gamepadButtons: ["left_trigger"], touchLabel: "Block" },
  },
  settings: { mouseLookMode: "pointer_lock" },
  hooks: { deviceChanged: (deviceKind) => showPrompts(deviceKind) },
});

function frame(nowMs) {
  input.update(nowMs); // once, first thing each frame
  camera.yawRad -= input.lookRad.x; // radians this frame, whatever the device
  camera.pitchRad += input.lookRad.y;
  character.walk(input.move.x, input.move.y); // -1 to 1 each, length 1 at most
  if (input.wasPressed("jump")) character.jump();
  if (input.isHeld("block")) character.block();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- **`input.move`** is where the player wants to go: x to the right, y forward. WASD, the arrows, the d-pad, the touch stick and the left stick all add up, kept to length 1. A stick pushed halfway gives 0.5, so a character can walk slower.
- **`input.lookRad`** is how far the view turned since the last frame, in radians: x to the right, y up. The mouse, a finger dragging on the right of the screen and the right stick all give radians, so the camera adds it as it is.
- **Actions** are held, pressed or let go: `isHeld`, `wasPressed`, `wasReleased`, and `pressedPctOf` for how far (a trigger pulled halfway is 50). A tap too quick for one frame still presses. The four move actions (`moveForward`, `moveBack`, `moveLeft`, `moveRight`) are always there.

## On each device

| Device | Moves | Turns the view | Actions |
| --- | --- | --- | --- |
| Keyboard and mouse | WASD and the arrows | The mouse: the first click locks the pointer, Escape lets it go | Keys by where they sit (`KeyboardEvent.code`), mouse buttons and the wheel |
| Touch | A stick where the left thumb lands | A finger dragging anywhere else | A button for each action with a `touchLabel`, in an arc in the bottom-right corner |
| Gamepad | The left stick and the d-pad | The right stick | Buttons by where they sit: `face_bottom` is A, ✕ or B |

The player switches whenever they like: `input.deviceKind` is the one used last, and the `deviceChanged` hook says when it changes.

## Prompts on screen

`labelsOf` says what to show for an action on the device in use, as that device names it:

```js
hint.textContent = `${input.labelsOf("jump")[0]} to jump`; // "Space", "A", "✕", "B" or "Jump"
```

A gamepad's buttons are named after the pad in the player's hands (Xbox, PlayStation or Nintendo), or the one `gamepadLabelStyle` sets.

## A controls screen

```js
const pressed = await input.captureBinding("jump"); // the next key, mouse button or gamepad button binds it
saveSettings({ controls: input.bindings }); // plain data, saved with the player's settings
input.setBindings(saved.controls); // next time
input.resetBindings(); // back to the game's own
input.settings.list(); // every setting with its range, to draw sliders from: sensitivity, invert, dead zones
input.settings.set({ mouseLookRadPerPx: 0.003, invertLookYEnabled: true });
```

## Changing it while playing

Every setting can be changed while playing; the hooks change what's read:

```js
input.settings.set({ inputEnabled: false }); // a menu is open: no moving, every action let go
input.hooks.on("beforeLook", (look) => (isAiming ? { x: look.x * 0.4, y: look.y * 0.4 } : look));
input.hooks.on("beforeMove", (move) => (isConfused ? { x: -move.x, y: -move.y } : move));
input.rumble({ strongPct: 80, weakPct: 30, durationMs: 150 }); // a hit
```

The touch controls are plain elements with class names (`zaisma-input-touch`, `zaisma-input-stick`, `zaisma-input-stick-knob`, `zaisma-input-stick-rest`, `zaisma-input-button`, with `data-action-name` and `data-is-held`) for a game to restyle with its own CSS, or turn off with `touchControlsEnabled: false` and draw its own, pressing actions with `input.setTouchHeld(actionName, isHeld)`.

## Online

`input.snapshot()` is the frame's input as plain data (`moveX`, `moveY`, `lookXRad`, `lookYRad`, `heldActionNames`), to send to a game server or record for a replay.

`index.d.ts` is the reference, with every call, setting, hook and error, and how each device is read, written down exactly so another engine can do the same. How pieces work: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md). MIT licensed.
