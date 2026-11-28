// @zaisma/input: input for every device. A game names its actions ("jump", "attack") and reads, once a frame,
// where the player wants to move, how far they turned the view and which actions are held or were just pressed,
// whether the player holds a keyboard and mouse, a phone or a gamepad. The reference is index.d.ts; how it reads
// each device is written down there and in README.md, so another engine can follow it. MIT licensed.

import { openPiece } from "../piece/index.js";
import statement from "./piece.json.js";

/** The kinds of device a player plays with. */
export const DEVICE_KINDS = ["keyboard_mouse", "touch", "gamepad"];

/**
 * Every gamepad button, by where it sits on the browser's standard layout, never by its letter: face_bottom is A
 * on an Xbox pad, Cross on a PlayStation one and B on a Nintendo one. labelsOf gives the letter.
 */
export const GAMEPAD_BUTTON_NAMES = ["face_bottom", "face_right", "face_left", "face_top", "left_shoulder", "right_shoulder", "left_trigger", "right_trigger", "select", "start", "left_stick_press", "right_stick_press", "dpad_up", "dpad_down", "dpad_left", "dpad_right", "home"];

/** Every mouse button. The wheel's two are pressed for one frame each time it turns a notch. */
export const MOUSE_BUTTON_NAMES = ["left", "middle", "right", "back", "forward", "wheel_up", "wheel_down"];

/** The four actions every game has, whose bindings move the character alongside the touch stick and the move stick. */
export const MOVE_ACTION_NAMES = ["moveForward", "moveBack", "moveLeft", "moveRight"];

/** What the four move actions are bound to until the game or the player changes them: WASD, the arrows and the d-pad. */
export const DEFAULT_MOVE_BINDINGS = {
  moveForward: { keys: ["KeyW", "ArrowUp"], mouseButtons: [], gamepadButtons: ["dpad_up"], touchLabel: null },
  moveBack: { keys: ["KeyS", "ArrowDown"], mouseButtons: [], gamepadButtons: ["dpad_down"], touchLabel: null },
  moveLeft: { keys: ["KeyA", "ArrowLeft"], mouseButtons: [], gamepadButtons: ["dpad_left"], touchLabel: null },
  moveRight: { keys: ["KeyD", "ArrowRight"], mouseButtons: [], gamepadButtons: ["dpad_right"], touchLabel: null },
};

/** The actions a game has when it names none: jump and sprint. A game naming its own can start from these. */
export const DEFAULT_ACTIONS = {
  jump: { keys: ["Space"], mouseButtons: [], gamepadButtons: ["face_bottom"], touchLabel: "Jump" },
  sprint: { keys: ["ShiftLeft", "ShiftRight"], mouseButtons: [], gamepadButtons: ["left_stick_press"], touchLabel: "Run" },
};

/** What each gamepad button is called on each kind of controller, for prompts on screen. */
export const GAMEPAD_LABELS = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Xbox"],
  playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "PS"],
  nintendo: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+", "L stick", "R stick", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Home"],
};

const MOUSE_LABELS = { left: "Left click", middle: "Middle click", right: "Right click", back: "Mouse back", forward: "Mouse forward", wheel_up: "Wheel up", wheel_down: "Wheel down" };
const KEY_LABELS = {
  Space: "Space", Enter: "Enter", Escape: "Esc", Tab: "Tab", Backspace: "Backspace", CapsLock: "Caps Lock",
  ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt", MetaLeft: "Meta", MetaRight: "Meta",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down",
};
const BINDING_FIELDS = ["keys", "mouseButtons", "gamepadButtons", "touchLabel"];
const GIVEN_FIELDS = ["settings", "hooks", "actions", "element", "eventTarget", "readGamepads"];
// event.buttons' bits, in MOUSE_BUTTON_NAMES' order for the five real buttons.
const MOUSE_BUTTON_BITS = { left: 1, right: 2, middle: 4, back: 8, forward: 16 };
// event.button's numbers.
const MOUSE_BUTTON_OF_NUMBER = ["left", "middle", "right", "back", "forward"];
const ACTION_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;
const KEY_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,29}$/;
const MAXIMUM_ACTION_COUNT = 64;
const MAXIMUM_CONTROL_COUNT_PER_DEVICE = 8;
const MAXIMUM_TOUCH_LABEL_CHARACTER_COUNT = 12;
const MAXIMUM_FRAME_DURATION_SEC = 0.1;

/**
 * The label for a key, by its code (KeyboardEvent.code: where the key sits, so WASD stays under the left hand on
 * every layout): "KeyW" is "W", "Digit1" is "1", "ShiftLeft" is "Shift".
 */
export function keyLabel(keyCode) {
  if (KEY_LABELS[keyCode]) return KEY_LABELS[keyCode];
  if (/^Key[A-Z]$/.test(keyCode)) return keyCode.slice(3);
  if (/^Digit[0-9]$/.test(keyCode)) return keyCode.slice(5);
  if (/^Numpad[0-9]$/.test(keyCode)) return `Num ${keyCode.slice(6)}`;
  if (/^F[0-9]{1,2}$/.test(keyCode)) return keyCode;
  return keyCode;
}

/** The kind of controller a gamepad is, from the id its browser gives it. */
export function gamepadStyleOf(gamepadId) {
  if (/054c|playstation|dualsense|dualshock|wireless controller/i.test(gamepadId)) return "playstation";
  if (/057e|nintendo|switch|joy-con|pro controller/i.test(gamepadId)) return "nintendo";
  return "xbox";
}

/** How far a stick or a move is pushed, as a share of all the way: 100 is a full push. */
const pushPctOf = (x, y) => Math.hypot(x, y) * 100;

/** What a stick's push is raised to for fine aim: 1 (even) at 0, up to 4 at 100. */
export const fineAimExponentOf = (fineAimPct) => 1 + (3 * fineAimPct) / 100;

/**
 * A stick's reading past its dead zone: nothing inside it, and from nothing to full across the rest, so a small
 * push past the edge is a small move, never a jump. Radial, so diagonals reach full length. fineAimPct above 0
 * keeps small pushes finer: the push is raised to fineAimExponentOf(fineAimPct).
 */
export function shapeStick(x, y, deadZonePct, fineAimPct = 0) {
  const pushPct = pushPctOf(x, y);
  if (!(pushPct > deadZonePct) || !Number.isFinite(pushPct)) return { x: 0, y: 0 };
  const shapedPct = 100 * Math.pow(Math.min(1, (pushPct - deadZonePct) / (100 - deadZonePct || 100)), fineAimExponentOf(fineAimPct));
  return { x: (x * shapedPct) / pushPct, y: (y * shapedPct) / pushPct };
}

/** A move kept to length 1 at most, its direction unchanged. */
export function clampMove(x, y) {
  const pushPct = pushPctOf(x, y);
  return pushPct > 100 ? { x: (x * 100) / pushPct, y: (y * 100) / pushPct } : { x, y };
}

/**
 * Starts reading input. Call input.update() once at the start of every frame, then read input.move, input.lookRad
 * and the actions. The reference, with every argument, setting, hook and error, is index.d.ts.
 */
export function createInput(given = {}) {
  const { settings, hooks, tell, ask, refuse } = openPiece(statement, given);
  for (const field of Object.keys(given)) {
    if (!GIVEN_FIELDS.includes(field)) refuse("unknown_argument", { message: `createInput has no argument "${field}".`, field, fix: `Give only: ${GIVEN_FIELDS.join(", ")}. A setting goes inside settings.` });
  }
  const hasPage = typeof document === "object" && document !== null;
  const element = given.element ?? (hasPage ? document.body : null);
  const eventTarget = given.eventTarget ?? (typeof window === "object" && window !== null ? window : element);
  if (!element || !eventTarget || typeof element.addEventListener !== "function" || typeof eventTarget.addEventListener !== "function") {
    refuse("no_page", { message: "There's no page here to read input from.", field: "element", fix: "Make the input in a browser page, or give element and eventTarget (each with addEventListener)." });
  }
  const pageDocument = element.ownerDocument ?? (hasPage ? document : null);
  const pageWindow = pageDocument?.defaultView ?? (typeof window === "object" ? window : null);
  if (given.readGamepads !== undefined && typeof given.readGamepads !== "function") refuse("bad_argument", { message: "readGamepads isn't a function.", field: "readGamepads", fix: "Give a function that answers a list of gamepads, or leave it out to read the browser's." });
  const readGamepads = given.readGamepads ?? (() => (typeof navigator === "object" && typeof navigator.getGamepads === "function" ? [...navigator.getGamepads()] : []));

  // ---- The game's actions and what each is bound to ----

  function checkBinding(actionName, binding, field) {
    if (binding === null || typeof binding !== "object" || Array.isArray(binding)) refuse("bad_binding", { message: `The binding of "${actionName}" isn't an object.`, field, fix: `Give { ${BINDING_FIELDS.join(", ")} }.` });
    for (const bindingField of Object.keys(binding)) {
      if (!BINDING_FIELDS.includes(bindingField)) refuse("bad_binding", { message: `A binding has no "${bindingField}" (in "${actionName}").`, field: `${field}.${bindingField}`, fix: `A binding takes: ${BINDING_FIELDS.join(", ")}.` });
    }
    const listOf = (bindingField, isKnown, known) => {
      const list = binding[bindingField] ?? [];
      if (!Array.isArray(list) || list.length > MAXIMUM_CONTROL_COUNT_PER_DEVICE) refuse("bad_binding", { message: `${bindingField} of "${actionName}" isn't a list of up to ${MAXIMUM_CONTROL_COUNT_PER_DEVICE}.`, field: `${field}.${bindingField}`, fix: `Give a list, like ${bindingField === "keys" ? '["Space"]' : `["${known[0]}"]`}.` });
      for (const controlName of list) {
        if (!isKnown(controlName)) refuse("unknown_control", { message: `"${controlName}" isn't one of ${bindingField} (in "${actionName}").`, field: `${field}.${bindingField}`, fix: bindingField === "keys" ? 'Keys are KeyboardEvent.code values, where the key sits: "KeyW", "Space", "ShiftLeft", "Digit1", "ArrowUp".' : `Use: ${known.join(", ")}.` });
      }
      return [...new Set(list)];
    };
    const touchLabel = binding.touchLabel ?? null;
    if (touchLabel !== null && (typeof touchLabel !== "string" || !touchLabel.trim() || touchLabel.length > MAXIMUM_TOUCH_LABEL_CHARACTER_COUNT)) {
      refuse("bad_binding", { message: `touchLabel of "${actionName}" isn't text of 1 to ${MAXIMUM_TOUCH_LABEL_CHARACTER_COUNT} characters.`, field: `${field}.touchLabel`, fix: 'Give a short word for its touch button, like "Jump", or null for no button.' });
    }
    if (touchLabel !== null && MOVE_ACTION_NAMES.includes(actionName)) refuse("bad_binding", { message: `"${actionName}" moves with the touch stick, so it has no touch button.`, field: `${field}.touchLabel`, fix: "Leave touchLabel null for the four move actions." });
    return {
      keys: listOf("keys", (code) => typeof code === "string" && KEY_CODE_PATTERN.test(code), []),
      mouseButtons: listOf("mouseButtons", (name) => MOUSE_BUTTON_NAMES.includes(name), MOUSE_BUTTON_NAMES),
      gamepadButtons: listOf("gamepadButtons", (name) => GAMEPAD_BUTTON_NAMES.includes(name), GAMEPAD_BUTTON_NAMES),
      touchLabel,
    };
  }

  const givenActions = given.actions ?? DEFAULT_ACTIONS;
  if (givenActions === null || typeof givenActions !== "object" || Array.isArray(givenActions)) refuse("bad_argument", { message: "actions isn't an object.", field: "actions", fix: 'Give each action by name with its binding: { jump: { keys: ["Space"], gamepadButtons: ["face_bottom"], touchLabel: "Jump" } }.' });
  const defaultBindings = {};
  for (const [actionName, binding] of Object.entries(givenActions)) {
    if (!ACTION_NAME_PATTERN.test(actionName)) refuse("bad_argument", { message: `"${actionName}" isn't an action name.`, field: "actions", fix: 'Name an action in camelCase, starting with a lowercase letter, up to 40 characters: "jump", "lightAttack".' });
    defaultBindings[actionName] = checkBinding(actionName, binding, `actions.${actionName}`);
  }
  for (const moveActionName of MOVE_ACTION_NAMES) defaultBindings[moveActionName] ??= checkBinding(moveActionName, DEFAULT_MOVE_BINDINGS[moveActionName], `actions.${moveActionName}`);
  if (Object.keys(defaultBindings).length > MAXIMUM_ACTION_COUNT) refuse("bad_argument", { message: `A game has up to ${MAXIMUM_ACTION_COUNT} actions.`, field: "actions", fix: "Name fewer actions." });
  const actionNames = Object.keys(defaultBindings);
  const copyBinding = (binding) => ({ keys: [...binding.keys], mouseButtons: [...binding.mouseButtons], gamepadButtons: [...binding.gamepadButtons], touchLabel: binding.touchLabel });
  let bindings = Object.fromEntries(actionNames.map((actionName) => [actionName, copyBinding(defaultBindings[actionName])]));

  function known(actionName) {
    if (!actionNames.includes(actionName)) refuse("unknown_action", { message: `There's no action "${actionName}".`, field: "actionName", fix: `This game's actions: ${actionNames.join(", ")}. Name others in createInput's actions.` });
    return actionName;
  }

  // ---- What's held on each device, as the page reports it between frames ----

  const heldKeys = new Set();
  const heldMouseButtons = new Set();
  const heldTouchActions = new Set();
  // Controls pressed since the last update, held or not by now: a tap between two frames still presses.
  const tappedKeys = new Set();
  const tappedMouseButtons = new Set();
  const tappedTouchActions = new Set();
  let heldGamepadButtons = new Map(); // button name -> how far it's pressed, 0 to 100
  let gamepadMove = { x: 0, y: 0 };
  let gamepadLook = { x: 0, y: 0 };
  let activeGamepad = null;
  let pendingLookXRad = 0;
  let pendingLookYRad = 0;
  let touchStick = null; // { pointerId, originX, originY, x, y }
  let touchLook = null; // { pointerId, lastX, lastY }
  let deviceKind = pageWindow && typeof pageWindow.matchMedia === "function" && pageWindow.matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard_mouse";
  let reportedDeviceKind = deviceKind;
  let isPointerLocked = false;
  let lastUpdateMs = null;
  let heldNow = new Set();
  let pressedPctsNow = new Map();
  let pressedNow = new Set();
  let releasedNow = new Set();
  let capture = null; // { actionName, deviceKind, resolve }
  const cleanups = [];
  let isDisposed = false;

  const input = {
    settings,
    hooks,
    /** Where the player wants to go this frame: x to the right, y forward, each -1 to 1, its length 1 at most. */
    move: { x: 0, y: 0 },
    /** How far the player turned the view since the last update, in radians: x to the right, y up. */
    lookRad: { x: 0, y: 0 },
    get deviceKind() {
      return deviceKind;
    },
    get isPointerLocked() {
      return isPointerLocked;
    },
    get actionNames() {
      return [...actionNames];
    },
    get bindings() {
      return Object.fromEntries(actionNames.map((actionName) => [actionName, copyBinding(bindings[actionName])]));
    },
    get gamepadStyle() {
      const style = settings.get("gamepadLabelStyle");
      return style === "auto" ? gamepadStyleOf(activeGamepad?.id ?? "") : style;
    },
    isHeld: (actionName) => heldNow.has(known(actionName)),
    wasPressed: (actionName) => pressedNow.has(known(actionName)),
    wasReleased: (actionName) => releasedNow.has(known(actionName)),
    pressedPctOf: (actionName) => pressedPctsNow.get(known(actionName)) ?? 0,
    setBinding(actionName, binding) {
      const changed = checkBinding(known(actionName), { ...bindings[actionName], ...binding }, "binding");
      bindings = { ...bindings, [actionName]: changed };
      drawTouchButtons();
    },
    setBindings(savedBindings) {
      if (savedBindings === null || typeof savedBindings !== "object" || Array.isArray(savedBindings)) refuse("bad_binding", { message: "setBindings takes an object of bindings by action.", field: "bindings", fix: "Give what input.bindings answered, as the game saved it." });
      const next = { ...bindings };
      for (const [actionName, binding] of Object.entries(savedBindings)) {
        // A saved action the game no longer has is skipped, so an older save never stops a newer game.
        if (!actionNames.includes(actionName)) continue;
        next[actionName] = checkBinding(actionName, { ...bindings[actionName], ...binding }, `bindings.${actionName}`);
      }
      bindings = next;
      drawTouchButtons();
    },
    resetBindings(names = actionNames) {
      if (!Array.isArray(names)) refuse("bad_argument", { message: "resetBindings takes a list of action names.", field: "names", fix: "Give a list, or nothing to reset every action." });
      for (const actionName of names) known(actionName);
      bindings = { ...bindings, ...Object.fromEntries(names.map((actionName) => [actionName, copyBinding(defaultBindings[actionName])])) };
      drawTouchButtons();
    },
    captureBinding(actionName, captureDeviceKind = null) {
      known(actionName);
      if (captureDeviceKind !== null && captureDeviceKind !== "keyboard_mouse" && captureDeviceKind !== "gamepad") refuse("bad_argument", { message: `captureBinding listens to "keyboard_mouse" or "gamepad", not "${captureDeviceKind}".`, field: "deviceKind", fix: "Give keyboard_mouse, gamepad, or null for whichever the player presses first. Touch buttons are labelled with setBinding's touchLabel." });
      capture?.resolve(null);
      return new Promise((resolve) => {
        capture = { actionName, deviceKind: captureDeviceKind, resolve, startedAtButtons: new Set(heldGamepadButtons.keys()) };
      });
    },
    cancelCapture() {
      capture?.resolve(null);
      capture = null;
    },
    labelsOf(actionName, labelDeviceKind = deviceKind) {
      const binding = bindings[known(actionName)];
      if (!DEVICE_KINDS.includes(labelDeviceKind)) refuse("bad_argument", { message: `"${labelDeviceKind}" isn't a kind of device.`, field: "deviceKind", fix: `Use: ${DEVICE_KINDS.join(", ")}.` });
      if (labelDeviceKind === "keyboard_mouse") return [...binding.keys.map(keyLabel), ...binding.mouseButtons.map((buttonName) => MOUSE_LABELS[buttonName])];
      if (labelDeviceKind === "gamepad") return binding.gamepadButtons.map((buttonName) => GAMEPAD_LABELS[input.gamepadStyle][GAMEPAD_BUTTON_NAMES.indexOf(buttonName)]);
      return binding.touchLabel ? [binding.touchLabel] : [];
    },
    setTouchHeld(actionName, isHeld) {
      known(actionName);
      if (isHeld) {
        heldTouchActions.add(actionName);
        tappedTouchActions.add(actionName);
        noteDevice("touch");
      } else heldTouchActions.delete(actionName);
    },
    rumble({ strongPct = 100, weakPct = 100, durationMs = 200 } = {}) {
      for (const [field, givenNumber, maximumNumber] of [["strongPct", strongPct, 100], ["weakPct", weakPct, 100], ["durationMs", durationMs, 5000]]) {
        if (typeof givenNumber !== "number" || !(givenNumber >= 0 && givenNumber <= maximumNumber)) refuse("bad_argument", { message: `rumble's ${field} isn't a number from 0 to ${maximumNumber}.`, field, fix: `Give ${field} from 0 to ${maximumNumber}.` });
      }
      if (!settings.get("rumbleEnabled") || !durationMs || (!strongPct && !weakPct)) return false;
      if (deviceKind === "gamepad" && activeGamepad?.vibrationActuator?.playEffect) {
        activeGamepad.vibrationActuator.playEffect("dual-rumble", { duration: durationMs, strongMagnitude: strongPct / 100, weakMagnitude: weakPct / 100 }).catch(() => {});
        return true;
      }
      if (deviceKind === "touch" && typeof navigator === "object" && typeof navigator.vibrate === "function") return navigator.vibrate(Math.round(durationMs)) === true;
      return false;
    },
    lockPointer,
    unlockPointer() {
      if (pageDocument?.pointerLockElement === element) pageDocument.exitPointerLock?.();
    },
    snapshot() {
      return { moveX: input.move.x, moveY: input.move.y, lookXRad: input.lookRad.x, lookYRad: input.lookRad.y, heldActionNames: actionNames.filter((actionName) => heldNow.has(actionName)) };
    },
    update(nowMs = typeof performance === "object" ? performance.now() : Date.now()) {
      if (isDisposed) return;
      const deltaSec = lastUpdateMs === null ? 0 : Math.max(0, Math.min(MAXIMUM_FRAME_DURATION_SEC, (nowMs - lastUpdateMs) / 1000));
      lastUpdateMs = nowMs;
      readGamepads_();
      const isEnabled = settings.get("inputEnabled");

      // The actions: held while any control bound to them is, and for one frame after a tap that came and went.
      const heldBefore = heldNow;
      heldNow = new Set();
      pressedPctsNow = new Map();
      if (isEnabled) {
        const triggerPressPct = settings.get("gamepadTriggerPressPct");
        for (const actionName of actionNames) {
          const binding = bindings[actionName];
          let pressedPct = 0;
          for (const code of binding.keys) if (heldKeys.has(code) || tappedKeys.has(code)) pressedPct = 100;
          for (const buttonName of binding.mouseButtons) if (heldMouseButtons.has(buttonName) || tappedMouseButtons.has(buttonName)) pressedPct = 100;
          if (heldTouchActions.has(actionName) || tappedTouchActions.has(actionName)) pressedPct = 100;
          let isGamepadHeld = false;
          for (const buttonName of binding.gamepadButtons) {
            const buttonPressedPct = heldGamepadButtons.get(buttonName) ?? 0;
            pressedPct = Math.max(pressedPct, buttonPressedPct);
            if (buttonPressedPct >= (buttonName === "left_trigger" || buttonName === "right_trigger" ? triggerPressPct : 50)) isGamepadHeld = true;
          }
          if (pressedPct >= 100 || isGamepadHeld) heldNow.add(actionName);
          if (pressedPct > 0) pressedPctsNow.set(actionName, pressedPct);
        }
      }
      tappedKeys.clear();
      tappedMouseButtons.clear();
      tappedTouchActions.clear();
      pressedNow = new Set(actionNames.filter((actionName) => heldNow.has(actionName) && !heldBefore.has(actionName)));
      releasedNow = new Set(actionNames.filter((actionName) => !heldNow.has(actionName) && heldBefore.has(actionName)));

      // Where to move: the move actions, the touch stick and the move stick together, kept to length 1.
      let moveX = 0;
      let moveY = 0;
      let lookXRad = 0;
      let lookYRad = 0;
      if (isEnabled) {
        const keyPushOf = (actionName) => (pressedPctsNow.get(actionName) ?? 0) / 100;
        moveX = keyPushOf("moveRight") - keyPushOf("moveLeft") + (touchStick?.x ?? 0) + gamepadMove.x;
        moveY = keyPushOf("moveForward") - keyPushOf("moveBack") + (touchStick?.y ?? 0) + gamepadMove.y;
        lookXRad = pendingLookXRad + gamepadLook.x * settings.get("gamepadLookRadPerSec") * deltaSec;
        lookYRad = pendingLookYRad + gamepadLook.y * settings.get("gamepadLookRadPerSec") * deltaSec;
        if (settings.get("invertLookYEnabled")) lookYRad = -lookYRad;
      }
      pendingLookXRad = 0;
      pendingLookYRad = 0;
      const move = clampMove(moveX, moveY);
      const askedMove = checkedAnswer("beforeMove", ask("beforeMove", { x: move.x, y: move.y }), move);
      const finalMove = clampMove(askedMove.x, askedMove.y);
      input.move.x = finalMove.x;
      input.move.y = finalMove.y;
      const askedLook = checkedAnswer("beforeLook", ask("beforeLook", { x: lookXRad, y: lookYRad }), { x: lookXRad, y: lookYRad });
      input.lookRad.x = askedLook.x;
      input.lookRad.y = askedLook.y;

      // What the game hears, in order: the device first, so prompts change before the presses that changed it.
      if (deviceKind !== reportedDeviceKind) {
        reportedDeviceKind = deviceKind;
        tell("deviceChanged", deviceKind);
      }
      for (const actionName of actionNames) if (pressedNow.has(actionName)) tell("actionPressed", { actionName, deviceKind });
      for (const actionName of actionNames) if (releasedNow.has(actionName)) tell("actionReleased", { actionName, deviceKind });
    },
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      for (const cleanup of cleanups) cleanup();
      capture?.resolve(null);
      capture = null;
      touchLayer?.remove();
      touchLayer = null;
      input.unlockPointer();
    },
  };

  function checkedAnswer(hookName, answer, fallback) {
    if (answer !== null && typeof answer === "object" && Number.isFinite(answer.x) && Number.isFinite(answer.y)) return answer;
    console.error(`@zaisma/input: a handler of ${hookName} answered something that isn't { x, y } with two numbers, so it was skipped.`, answer);
    return fallback;
  }

  function noteDevice(nextDeviceKind) {
    deviceKind = nextDeviceKind;
    if (touchLayer) touchLayer.style.display = deviceKind === "touch" && settings.get("touchControlsEnabled") ? "" : "none";
  }

  function listen(target, eventName, handler, listenOptions) {
    target.addEventListener(eventName, handler, listenOptions);
    cleanups.push(() => target.removeEventListener(eventName, handler, listenOptions));
  }

  function letGoOfEverything() {
    heldKeys.clear();
    heldMouseButtons.clear();
    heldTouchActions.clear();
    touchStick = null;
    touchLook = null;
    drawTouchStick();
  }

  function finishCapture(controlKind, controlName) {
    const { actionName, resolve } = capture;
    capture = null;
    const field = controlKind === "key" ? "keys" : controlKind === "mouse_button" ? "mouseButtons" : "gamepadButtons";
    input.setBinding(actionName, { [field]: [controlName] });
    resolve({ actionName, controlKind, controlName });
  }

  // ---- Keyboard ----

  const isTyping = (event) => {
    const target = event.target;
    const tagName = target?.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable === true;
  };
  const isBoundKey = (code) => actionNames.some((actionName) => bindings[actionName].keys.includes(code));

  listen(eventTarget, "keydown", (event) => {
    if (isTyping(event)) return;
    noteDevice("keyboard_mouse");
    if (capture && (capture.deviceKind === null || capture.deviceKind === "keyboard_mouse")) {
      event.preventDefault?.();
      if (event.code === "Escape") input.cancelCapture();
      else if (KEY_CODE_PATTERN.test(event.code)) finishCapture("key", event.code);
      return;
    }
    if (event.repeat || !settings.get("inputEnabled")) return;
    heldKeys.add(event.code);
    tappedKeys.add(event.code);
    // A game's keys don't also scroll the page; the browser's own shortcuts (with Ctrl or Cmd) still work.
    if (isBoundKey(event.code) && !event.ctrlKey && !event.metaKey) event.preventDefault?.();
  });
  listen(eventTarget, "keyup", (event) => {
    heldKeys.delete(event.code);
    // On a Mac, a key let go while Cmd is held never says so: letting go of Cmd lets go of them all.
    if (event.code === "MetaLeft" || event.code === "MetaRight") heldKeys.clear();
  });
  listen(eventTarget, "blur", letGoOfEverything);
  if (pageDocument) {
    listen(pageDocument, "visibilitychange", () => {
      if (pageDocument.visibilityState === "hidden") letGoOfEverything();
    });
  }

  // ---- Mouse, through pointer events, so a touch's copied mouse events never count as a mouse ----

  // The click that locks the pointer only locks it: it presses nothing until it's let go.
  let lockingButtonName = null;
  function readMouseButtons(event) {
    for (const [buttonName, bitNumber] of Object.entries(MOUSE_BUTTON_BITS)) {
      const isDown = (event.buttons & bitNumber) !== 0;
      if (buttonName === lockingButtonName) {
        if (!isDown) lockingButtonName = null;
        continue;
      }
      if (isDown && !heldMouseButtons.has(buttonName)) tappedMouseButtons.add(buttonName);
      if (isDown) heldMouseButtons.add(buttonName);
      else heldMouseButtons.delete(buttonName);
    }
  }
  const isBoundMouseButton = (buttonName) => actionNames.some((actionName) => bindings[actionName].mouseButtons.includes(buttonName));

  listen(element, "pointerdown", (event) => {
    if (event.pointerType !== "mouse") return;
    noteDevice("keyboard_mouse");
    if (capture && (capture.deviceKind === null || capture.deviceKind === "keyboard_mouse")) {
      const buttonName = MOUSE_BUTTON_OF_NUMBER[event.button];
      if (buttonName) {
        event.preventDefault?.();
        finishCapture("mouse_button", buttonName);
      }
      return;
    }
    if (!settings.get("inputEnabled")) return;
    if (MOUSE_BUTTON_OF_NUMBER[event.button] === "back" || MOUSE_BUTTON_OF_NUMBER[event.button] === "forward") event.preventDefault?.();
    if (settings.get("mouseLookMode") === "pointer_lock" && !isPointerLocked && typeof element.requestPointerLock === "function") {
      lockingButtonName = MOUSE_BUTTON_OF_NUMBER[event.button] ?? null;
      lockPointer();
    }
    readMouseButtons(event);
  });
  listen(eventTarget, "pointerup", (event) => {
    if (event.pointerType === "mouse") readMouseButtons(event);
  });
  listen(eventTarget, "pointermove", (event) => {
    if (event.pointerType === "mouse") {
      readMouseButtons(event);
      if (!settings.get("inputEnabled")) return;
      const mode = settings.get("mouseLookMode");
      const isTurning = mode === "pointer_lock" ? isPointerLocked : mode === "hold_button" && heldMouseButtons.has(settings.get("mouseLookButton"));
      if (!isTurning) return;
      const movementXPx = event.movementX ?? 0;
      const movementYPx = event.movementY ?? 0;
      // Some browsers report a jump of half the screen as the pointer locks or crosses a window's edge: never a hand's.
      const spikePx = Math.max(400, (pageWindow?.innerWidth ?? 800) / 2);
      if (Math.abs(movementXPx) > spikePx || Math.abs(movementYPx) > spikePx) return;
      const radPerPx = settings.get("mouseLookRadPerPx");
      pendingLookXRad += movementXPx * radPerPx;
      pendingLookYRad -= movementYPx * radPerPx;
      if (Math.abs(movementXPx) + Math.abs(movementYPx) > 2) noteDevice("keyboard_mouse");
    } else if (event.pointerType === "touch") moveTouch(event);
  });
  // The right button turns the view or does an action, never opens the page's menu over the game.
  listen(element, "contextmenu", (event) => {
    if (settings.get("inputEnabled") && (settings.get("mouseLookMode") !== "off" || isBoundMouseButton("right"))) event.preventDefault?.();
  });
  listen(
    element,
    "wheel",
    (event) => {
      if (!settings.get("inputEnabled") || !event.deltaY) return;
      const buttonName = event.deltaY < 0 ? "wheel_up" : "wheel_down";
      if (capture && (capture.deviceKind === null || capture.deviceKind === "keyboard_mouse")) {
        event.preventDefault?.();
        finishCapture("mouse_button", buttonName);
        return;
      }
      tappedMouseButtons.add(buttonName);
      noteDevice("keyboard_mouse");
      if (isBoundMouseButton(buttonName)) event.preventDefault?.();
    },
    { passive: false },
  );

  function lockPointer() {
    if (!pageDocument || typeof element.requestPointerLock !== "function" || pageDocument.pointerLockElement === element) return;
    const settle = (request) => (request && typeof request.catch === "function" ? request.catch(() => {}) : undefined);
    try {
      if (settings.get("rawMouseEnabled")) {
        const request = element.requestPointerLock({ unadjustedMovement: true });
        // A browser without raw mouse refuses the option: lock without it.
        if (request && typeof request.catch === "function") request.catch(() => settle(element.requestPointerLock()));
      } else settle(element.requestPointerLock());
    } catch {
      // A page that may not lock the pointer (a frame without allow-pointer-lock) keeps working: hold_button still turns.
    }
  }
  if (pageDocument) {
    listen(pageDocument, "pointerlockchange", () => {
      const isLockedNow = pageDocument.pointerLockElement === element;
      if (isLockedNow === isPointerLocked) return;
      isPointerLocked = isLockedNow;
      if (!isLockedNow) heldMouseButtons.clear();
      tell("pointerLockChanged", isLockedNow);
    });
    // A lock the browser refused (too soon after Escape, or a frame that may not lock) turns the click back into a press.
    listen(pageDocument, "pointerlockerror", () => {
      if (lockingButtonName) tappedMouseButtons.add(lockingButtonName);
      lockingButtonName = null;
    });
  }

  // ---- Touch: a stick where the left thumb lands, a drag anywhere else turns the view, and buttons ----

  function startTouch(event) {
    if (event.pointerType !== "touch") return;
    noteDevice("touch");
    if (!settings.get("inputEnabled")) return;
    const bounds = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : { left: 0, width: pageWindow?.innerWidth ?? 1 };
    const isStickZone = event.clientX - bounds.left < (bounds.width * settings.get("touchStickZonePct")) / 100;
    if (isStickZone && !touchStick) touchStick = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, x: 0, y: 0 };
    else if (!touchLook && !(isStickZone && touchStick)) touchLook = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    event.preventDefault?.();
    drawTouchStick();
  }
  function moveTouch(event) {
    if (touchStick && event.pointerId === touchStick.pointerId) {
      const radiusPx = settings.get("touchStickRadiusPx");
      let offsetXPx = event.clientX - touchStick.originX;
      let offsetYPx = event.clientY - touchStick.originY;
      const offsetPx = Math.hypot(offsetXPx, offsetYPx);
      if (offsetPx > radiusPx && settings.get("touchStickFollowsEnabled")) {
        // The stick slides after the thumb, so it's always at its edge, never far behind it.
        const pastEdgePx = offsetPx - radiusPx;
        touchStick.originX += (offsetXPx / offsetPx) * pastEdgePx;
        touchStick.originY += (offsetYPx / offsetPx) * pastEdgePx;
        offsetXPx = event.clientX - touchStick.originX;
        offsetYPx = event.clientY - touchStick.originY;
      }
      const push = shapeStick(offsetXPx / radiusPx, -offsetYPx / radiusPx, settings.get("touchStickDeadZonePct"));
      touchStick.x = push.x;
      touchStick.y = push.y;
      touchStick.thumbXPx = Math.max(-radiusPx, Math.min(radiusPx, offsetXPx));
      touchStick.thumbYPx = Math.max(-radiusPx, Math.min(radiusPx, offsetYPx));
      drawTouchStick();
    } else if (touchLook && event.pointerId === touchLook.pointerId) {
      const radPerPx = settings.get("touchLookRadPerPx");
      pendingLookXRad += (event.clientX - touchLook.lastX) * radPerPx;
      pendingLookYRad -= (event.clientY - touchLook.lastY) * radPerPx;
      touchLook.lastX = event.clientX;
      touchLook.lastY = event.clientY;
    }
  }
  function endTouch(event) {
    if (touchStick && event.pointerId === touchStick.pointerId) {
      touchStick = null;
      drawTouchStick();
    } else if (touchLook && event.pointerId === touchLook.pointerId) touchLook = null;
  }
  listen(element, "pointerdown", startTouch);
  listen(eventTarget, "pointerup", endTouch);
  listen(eventTarget, "pointercancel", endTouch);
  // Touches on the game never scroll or zoom the page.
  if (element.style) element.style.touchAction = "none";

  // The controls it draws: plain elements with class names a game restyles, or turns off to draw its own.
  let touchLayer = null;
  let stickBase = null;
  let stickKnob = null;
  let stickRest = null;
  let buttonLayer = null;

  function drawTouchControls() {
    if (!pageDocument?.body || touchLayer) return;
    touchLayer = pageDocument.createElement("div");
    touchLayer.className = "zaisma-input-touch";
    touchLayer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:10;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";
    stickRest = pageDocument.createElement("div");
    stickRest.className = "zaisma-input-stick-rest";
    stickBase = pageDocument.createElement("div");
    stickBase.className = "zaisma-input-stick";
    stickKnob = pageDocument.createElement("div");
    stickKnob.className = "zaisma-input-stick-knob";
    stickBase.append(stickKnob);
    buttonLayer = pageDocument.createElement("div");
    buttonLayer.className = "zaisma-input-buttons";
    buttonLayer.style.cssText = "position:absolute;inset:0;";
    touchLayer.append(stickRest, stickBase, buttonLayer);
    pageDocument.body.append(touchLayer);
    drawTouchStick();
    drawTouchButtons();
    noteDevice(deviceKind);
  }

  function drawTouchStick() {
    if (!stickBase) return;
    const radiusPx = settings.get("touchStickRadiusPx");
    const ring = `position:absolute;width:${radiusPx * 2}px;height:${radiusPx * 2}px;margin:-${radiusPx}px 0 0 -${radiusPx}px;border-radius:50%;box-sizing:border-box;`;
    // At rest, a faint ring where a thumb usually lands, so a player knows the left side moves.
    stickRest.style.cssText = `position:absolute;left:max(32px, env(safe-area-inset-left));bottom:max(32px, env(safe-area-inset-bottom));width:${radiusPx * 2}px;height:${radiusPx * 2}px;border-radius:50%;box-sizing:border-box;border:2px solid rgba(255,255,255,.25);display:${touchStick ? "none" : "block"};`;
    stickBase.style.cssText = `${ring}background:rgba(0,0,0,.18);border:2px solid rgba(255,255,255,.45);display:${touchStick ? "block" : "none"};left:${touchStick?.originX ?? 0}px;top:${touchStick?.originY ?? 0}px;`;
    const knobPx = radiusPx * 0.9;
    stickKnob.style.cssText = `position:absolute;left:50%;top:50%;width:${knobPx}px;height:${knobPx}px;margin:-${knobPx / 2}px 0 0 -${knobPx / 2}px;border-radius:50%;background:rgba(255,255,255,.6);transform:translate(${touchStick?.thumbXPx ?? 0}px,${touchStick?.thumbYPx ?? 0}px);`;
  }

  /** Where each touch button sits: the first in the corner, the rest in an arc around it, the thumb's reach. */
  function touchButtonPlaces(buttonCount, sizePx) {
    const places = [{ rightPx: 0, bottomPx: 0, sizePx }];
    const smallPx = Math.round(sizePx * 0.74);
    // Angles from the first button's centre: 180 is to its left, 90 above it. Three close, then five further out.
    const rings = [{ distanceSizes: 1.25, anglesDeg: [180, 135, 90] }];
    while (rings.reduce((placedCount, ring) => placedCount + ring.anglesDeg.length, 1) < buttonCount) rings.push({ distanceSizes: 1.25 + rings.length * 1.05, anglesDeg: [180, 157.5, 135, 112.5, 90] });
    for (const ring of rings) {
      for (const angleDeg of ring.anglesDeg) {
        if (places.length >= buttonCount) break;
        const angleRad = (angleDeg * Math.PI) / 180;
        const centreRightPx = sizePx / 2 - Math.cos(angleRad) * ring.distanceSizes * sizePx;
        const centreBottomPx = sizePx / 2 + Math.sin(angleRad) * ring.distanceSizes * sizePx;
        places.push({ rightPx: Math.round(centreRightPx - smallPx / 2), bottomPx: Math.round(centreBottomPx - smallPx / 2), sizePx: smallPx });
      }
    }
    return places;
  }

  function drawTouchButtons() {
    if (!buttonLayer) return;
    const withButtons = actionNames.filter((actionName) => bindings[actionName].touchLabel);
    const places = touchButtonPlaces(withButtons.length, settings.get("touchButtonSizePx"));
    buttonLayer.replaceChildren();
    withButtons.forEach((actionName, index) => {
      const place = places[index];
      const button = pageDocument.createElement("button");
      button.type = "button";
      button.className = "zaisma-input-button";
      button.dataset.actionName = actionName;
      button.textContent = bindings[actionName].touchLabel;
      button.setAttribute("aria-label", bindings[actionName].touchLabel);
      const fontPx = Math.round(place.sizePx * 0.2);
      button.style.cssText = `position:absolute;right:calc(max(20px, env(safe-area-inset-right)) + ${place.rightPx}px);bottom:calc(max(24px, env(safe-area-inset-bottom)) + ${place.bottomPx}px);width:${place.sizePx}px;height:${place.sizePx}px;border-radius:50%;border:2px solid rgba(255,255,255,.5);background:rgba(0,0,0,.22);color:#fff;font:600 ${fontPx}px/1 system-ui,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:auto;touch-action:none;padding:0;margin:0;-webkit-tap-highlight-color:transparent;`;
      const press = (isHeld) => (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.dataset.isHeld = String(isHeld);
        button.style.background = isHeld ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.22)";
        input.setTouchHeld(actionName, isHeld);
        // The button keeps its finger while it slides, so a held button is let go only when the finger lifts.
        try {
          if (isHeld) button.setPointerCapture?.(event.pointerId);
        } catch {
          // A pointer the browser no longer knows: the press still counts.
        }
      };
      button.addEventListener("pointerdown", press(true));
      button.addEventListener("pointerup", press(false));
      button.addEventListener("pointercancel", press(false));
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      buttonLayer.append(button);
    });
  }

  const drawIfWanted = () => {
    if (settings.get("touchControlsEnabled")) drawTouchControls();
    noteDevice(deviceKind);
    drawTouchStick();
    drawTouchButtons();
  };
  cleanups.push(settings.onChange(drawIfWanted));
  cleanups.push(
    settings.onChange(({ name, newValue }) => {
      if (name === "inputEnabled" && !newValue) {
        letGoOfEverything();
        input.unlockPointer();
      }
    }),
  );
  drawIfWanted();

  // ---- Gamepads: read each update, every connected pad together, so whichever the player picks up works ----

  function readGamepads_() {
    let pads = [];
    try {
      pads = [...(readGamepads() ?? [])].filter((pad) => pad && pad.connected !== false && pad.buttons?.length);
    } catch {
      pads = [];
    }
    const swapped = settings.get("gamepadSticksSwappedEnabled");
    const buttons = new Map();
    let bestMove = { x: 0, y: 0 };
    let bestLook = { x: 0, y: 0 };
    let isAnyActive = false;
    for (const pad of pads) {
      let isActive = false;
      const padButtons = [...pad.buttons];
      padButtons.forEach((button, buttonIndex) => {
        const buttonName = GAMEPAD_BUTTON_NAMES[buttonIndex];
        if (!buttonName) return;
        const pressedPct = 100 * Math.min(1, typeof button === "number" ? button : Math.max(Number(button?.value) || 0, button?.pressed ? 1 : 0));
        if (pressedPct > 0) {
          buttons.set(buttonName, Math.max(buttons.get(buttonName) ?? 0, pressedPct));
          if (pressedPct >= 10) isActive = true;
        }
      });
      const axes = pad.axes ?? [];
      // Axes run -1 to 1 with y down; here y is up (forward).
      const leftStick = { x: Number(axes[0]) || 0, y: -(Number(axes[1]) || 0) };
      const rightStick = { x: Number(axes[2]) || 0, y: -(Number(axes[3]) || 0) };
      const [moveStick, lookStick] = swapped ? [rightStick, leftStick] : [leftStick, rightStick];
      const move = shapeStick(moveStick.x, moveStick.y, settings.get("gamepadMoveDeadZonePct"));
      const look = shapeStick(lookStick.x, lookStick.y, settings.get("gamepadLookDeadZonePct"), settings.get("gamepadFineAimPct"));
      if (move.x || move.y || look.x || look.y) isActive = true;
      if (pushPctOf(move.x, move.y) > pushPctOf(bestMove.x, bestMove.y)) bestMove = move;
      if (pushPctOf(look.x, look.y) > pushPctOf(bestLook.x, bestLook.y)) bestLook = look;
      if (isActive) {
        activeGamepad = pad;
        isAnyActive = true;
      }
    }
    // The pad named in prompts and shaken by rumble: the last one used, while it's still connected.
    if (!isAnyActive) activeGamepad = pads.find((pad) => pad.index === activeGamepad?.index && pad.id === activeGamepad?.id) ?? pads[0] ?? null;
    // A button already held when capturing began is never the answer: the player's press to start it.
    if (capture && (capture.deviceKind === null || capture.deviceKind === "gamepad")) {
      for (const buttonName of capture.startedAtButtons) if (!buttons.has(buttonName)) capture.startedAtButtons.delete(buttonName);
      const pressedName = GAMEPAD_BUTTON_NAMES.find((buttonName) => (buttons.get(buttonName) ?? 0) >= 50 && !capture.startedAtButtons.has(buttonName));
      if (pressedName) {
        noteDevice("gamepad");
        finishCapture("gamepad_button", pressedName);
      }
      heldGamepadButtons = new Map();
      gamepadMove = { x: 0, y: 0 };
      gamepadLook = { x: 0, y: 0 };
      return;
    }
    heldGamepadButtons = buttons;
    gamepadMove = bestMove;
    gamepadLook = bestLook;
    if (isAnyActive) noteDevice("gamepad");
  }

  return input;
}
