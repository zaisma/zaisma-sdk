/**
 * @zaisma/input: input for every device.
 *
 * A game names its actions ("jump", "attack") and reads, once a frame, where the player wants to move, how far
 * they turned the view, and which actions are held or were just pressed, whether the player holds a keyboard
 * and mouse, a phone or a gamepad. The game never handles a device itself.
 *
 *   import { createInput } from "./pieces/@zaisma/input/index.js";
 *
 *   const input = createInput({
 *     actions: {
 *       jump: { keys: ["Space"], gamepadButtons: ["face_bottom"], touchLabel: "Jump" },
 *       attack: { mouseButtons: ["left"], gamepadButtons: ["right_trigger"], touchLabel: "Hit" },
 *     },
 *     hooks: { deviceChanged: (deviceKind) => showPrompts(deviceKind) },
 *   });
 *
 *   function frame(nowMs) {
 *     input.update(nowMs);                                  // once, first thing each frame
 *     camera.yawRad -= input.lookRad.x;                     // radians this frame, any device
 *     camera.pitchRad += input.lookRad.y;
 *     character.walk(input.move.x, input.move.y);           // -1 to 1 each, length 1 at most
 *     if (input.wasPressed("jump")) character.jump();
 *     requestAnimationFrame(frame);
 *   }
 *
 *   hint.textContent = `${input.labelsOf("jump")[0]} to jump`;   // "Space", "A", "✕" or "Jump"
 *
 * How it reads each device, so another engine can do the same:
 *
 * - Keyboard: by KeyboardEvent.code (where a key sits, so WASD stays under the left hand on any layout). A key a
 *   game binds doesn't scroll the page; with Ctrl or Cmd the browser's shortcuts still work. Held keys are let go
 *   when the page loses focus or is hidden, and when Cmd is let go on a Mac, so no key ever sticks.
 * - Mouse: through pointer events, so the mouse events a phone copies from a touch never count as a mouse. With
 *   mouse_look_mode pointer_lock, the first click locks the pointer (raw, without acceleration, where the browser
 *   allows it) and presses nothing; Escape lets it go. A single move of more than half the screen is dropped as a
 *   browser's glitch. The wheel presses wheel_up or wheel_down for one frame a notch.
 * - Touch: a touch in the left touch_stick_zone_pct of the screen starts a stick where the thumb lands, past a
 *   small dead zone, sliding after a thumb that goes past its edge; a touch anywhere else drags the view. One
 *   button for each action with a touchLabel: the first in the bottom-right corner, the rest in an arc around it.
 * - Gamepads: every connected pad is read each update, the browser's standard layout. The left stick moves and
 *   the right one turns (swapped with gamepad_sticks_swapped_enabled), each with a radial dead zone that starts
 *   from nothing past its edge; the look stick's push is raised to 1 + 3 × gamepad_fine_aim_pct ÷ 100 for fine aim.
 * - Each frame: an action is held while any control bound to it is; a tap that came and went between two updates
 *   still counts as held for one frame, so no press is lost at a low frame rate. The move actions, the touch stick
 *   and the move stick add up, and the total is kept to length 1. The device is whichever the player used last.
 *
 * Errors are PieceError, from @zaisma/piece: code is stable, field names the argument at fault
 * or is null, fix says what to do. MIT licensed.
 */

import type { GivenToPiece, Hooks, Kept, Settings } from "../piece/index.js";

/** The kinds of device a player plays with. */
export type DeviceKind = "keyboard_mouse" | "touch" | "gamepad";

/**
 * A gamepad button, by where it sits on the browser's standard layout, never by its letter: face_bottom is A on
 * an Xbox pad, ✕ on a PlayStation one and B on a Nintendo one. select is View, Create or −; home is the logo.
 */
export type GamepadButtonName =
  | "face_bottom" | "face_right" | "face_left" | "face_top"
  | "left_shoulder" | "right_shoulder" | "left_trigger" | "right_trigger"
  | "select" | "start" | "left_stick_press" | "right_stick_press"
  | "dpad_up" | "dpad_down" | "dpad_left" | "dpad_right" | "home";

/** A mouse button. wheel_up and wheel_down are pressed for one frame each time the wheel turns a notch. */
export type MouseButtonName = "left" | "middle" | "right" | "back" | "forward" | "wheel_up" | "wheel_down";

/** The four actions every game has; their bindings move the character, alongside the touch stick and the move stick. */
export type MoveActionName = "moveForward" | "moveBack" | "moveLeft" | "moveRight";

/** Which controller's names labelsOf gives. */
export type GamepadStyle = "xbox" | "playstation" | "nintendo";

/**
 * What one action is bound to. Every field is optional when giving one; each list holds up to 8.
 */
export interface Binding {
  /** KeyboardEvent.code values, where the key sits: "KeyW", "Space", "ShiftLeft", "Digit1", "ArrowUp". */
  keys: string[];
  mouseButtons: MouseButtonName[];
  gamepadButtons: GamepadButtonName[];
  /** The word on its touch button, up to 12 characters, or null for no touch button. Always null for a move action. */
  touchLabel: string | null;
}

/** The input's settings, as input.settings gets and sets them. Each is explained in its piece.json. */
export interface InputSettingValues {
  [name: string]: number | boolean | string;
  /** Whether the player's input is read. Off (a menu or chat box is open): no moving or turning, every action let go. Default true. */
  inputEnabled: boolean;
  /** How the mouse turns the view. Default "pointer_lock". */
  mouseLookMode: "pointer_lock" | "hold_button" | "off";
  /** The button held to turn the view in hold_button. Default "right". */
  mouseLookButton: "left" | "right" | "middle";
  /** Radians the view turns for each pixel the mouse moves: the mouse sensitivity. 0.0001 to 0.05, default 0.0022. */
  mouseLookRadPerPx: number;
  /** Whether a locked mouse is read without the computer's pointer acceleration, where the browser allows it. Default true. */
  rawMouseEnabled: boolean;
  /** Whether pushing up looks down, on every device. Default false. */
  invertLookYEnabled: boolean;
  /** Whether the piece draws its touch controls. Off, touches still move and turn; the game draws its own and calls setTouchHeld. Default true. */
  touchControlsEnabled: boolean;
  /** How far a thumb moves from where it landed to push the stick all the way, CSS pixels. 24 to 160, default 56. */
  touchStickRadiusPx: number;
  /** How much of the stick's radius a thumb moves before the character moves. 0 to 60, default 10. */
  touchStickDeadZonePct: number;
  /** Whether the stick slides after a thumb that goes past its edge. Default true. */
  touchStickFollowsEnabled: boolean;
  /** How much of the screen's width, from the left, starts the stick; anywhere else turns the view. 10 to 90, default 50. */
  touchStickZonePct: number;
  /** Radians the view turns for each pixel a finger drags. 0.0005 to 0.05, default 0.006. */
  touchLookRadPerPx: number;
  /** How wide the first touch button is, CSS pixels; the rest are a little smaller. 40 to 140, default 72. */
  touchButtonSizePx: number;
  /** How far the move stick is pushed before the character moves. 0 to 60, default 15. */
  gamepadMoveDeadZonePct: number;
  /** How far the look stick is pushed before the view turns. 0 to 60, default 12. */
  gamepadLookDeadZonePct: number;
  /** Radians a second the view turns with the look stick pushed all the way. 0.1 to 20, default 3.2. */
  gamepadLookRadPerSec: number;
  /** How much finer small pushes of the look stick are, for aiming: 0 is even, higher is finer. 0 to 100, default 20. */
  gamepadFineAimPct: number;
  /** How far a trigger is pulled before an action bound to it is held. 5 to 95, default 40. */
  gamepadTriggerPressPct: number;
  /** Whether the right stick moves and the left one turns. Default false. */
  gamepadSticksSwappedEnabled: boolean;
  /** Which controller's names labelsOf gives; auto names the one in the player's hands. Default "auto". */
  gamepadLabelStyle: "auto" | GamepadStyle;
  /** Whether rumble shakes a gamepad or a phone. Default true. */
  rumbleEnabled: boolean;
}

/** What action_pressed and action_released are told. */
export interface ActionChange {
  actionName: string;
  /** The device the player was using when it happened. */
  deviceKind: DeviceKind;
}

/** A direction or a turn: x to the right, y forward (move) or up (look). */
export interface Vector2 {
  x: number;
  y: number;
}

/** The input's hooks, as input.hooks.on takes them. Every hook is called during update, except pointerLockChanged. */
export interface InputHookHandlers {
  [name: string]: (...given: any[]) => unknown;
  /** The player started using another kind of device: change the prompts on screen. */
  deviceChanged: (deviceKind: DeviceKind) => void;
  /** An action was pressed, in the order the game named its actions. */
  actionPressed: (change: ActionChange) => void;
  /** An action was let go. */
  actionReleased: (change: ActionChange) => void;
  /** The pointer was locked to the game, or let go (the player pressed Escape): show a click-to-play prompt. */
  pointerLockChanged: (isPointerLocked: boolean) => void;
  /** Where the player wants to move this frame: answer another { x, y } to change it, or nothing to leave it. Kept to length 1. */
  beforeMove: (move: Vector2) => Vector2 | void;
  /** How far the player turned the view this frame, radians: answer another { x, y } (a slower turn while aiming), or nothing. */
  beforeLook: (look: Vector2) => Vector2 | void;
}

/** What createInput takes. */
export interface InputArguments extends GivenToPiece<InputSettingValues, InputHookHandlers> {
  /**
   * The game's actions by name (camelCase, up to 40 characters, up to 64 of them), each with what it's bound to
   * until the player changes it. Leave it out for DEFAULT_ACTIONS (jump and sprint). The four move actions are
   * always there, bound to WASD, the arrows and the d-pad unless given here.
   */
  actions?: Record<string, Partial<Binding>>;
  /** Where mouse buttons, touches and the wheel are read: the game's canvas, or the page's body (the default). */
  element?: HTMLElement;
  /** Where keys and moves that leave the element are read: the window (the default). */
  eventTarget?: EventTarget;
  /** Answers the connected gamepads; the browser's navigator.getGamepads by default. For tests and other runtimes. */
  readGamepads?: () => ArrayLike<Gamepad | null>;
}

/** What captureBinding answers once the player presses something. */
export interface CapturedBinding {
  actionName: string;
  controlKind: "key" | "mouse_button" | "gamepad_button";
  /** The key's code or the button's name, now the action's only control of that kind. */
  controlName: string;
}

/** A frame's input as plain data, for sending to a game server or recording a replay. */
export interface InputSnapshot {
  moveX: number;
  moveY: number;
  lookXRad: number;
  lookYRad: number;
  /** The actions held this frame, in the order the game named them. */
  heldActionNames: string[];
}

/** The input a game reads. */
export interface Input {
  settings: Settings<InputSettingValues>;
  hooks: Hooks<InputHookHandlers>;
  /** Where the player wants to go this frame: x to the right, y forward, each -1 to 1, its length 1 at most. A stick pushed halfway is 0.5: walk slower. */
  readonly move: Vector2;
  /** How far the player turned the view since the last update, in radians: x to the right, y up. Add it to the camera's angles. */
  readonly lookRad: Vector2;
  /** The device the player used last. Before any input, touch on a touch screen, else keyboard_mouse. */
  readonly deviceKind: DeviceKind;
  readonly isPointerLocked: boolean;
  /** The game's actions, the four move actions included, in the order named. */
  readonly actionNames: string[];
  /**
   * What the piece keeps between plays, for any save to keep beside the game's progress (the save piece's
   * keptPieces): the player's own choices among its settings (KEPT_SETTING_NAMES: how fast the view turns on each
   * device, inverted look, swapped sticks, button names, rumble, touch button size) and the actions they rebound.
   * Each is kept only once it differs from what the game made the piece with, so a game that changes its own
   * defaults later still reaches every player who never changed them.
   */
  readonly kept: Kept;
  /** Every action's binding now: a copy, plain data the game can save with the player's settings. */
  readonly bindings: Record<string, Binding>;
  /** Which controller's names labelsOf gives now. */
  readonly gamepadStyle: GamepadStyle;

  /**
   * Reads every device and works out this frame's input. Call it once, first thing every frame, then read the rest.
   * nowMs is the frame's time (requestAnimationFrame's); it times the look stick's turn.
   */
  update(nowMs?: number): void;
  /** Whether an action is held this frame. Throws PieceError "unknown_action". */
  isHeld(actionName: string): boolean;
  /** Whether an action went down this frame. Throws PieceError "unknown_action". */
  wasPressed(actionName: string): boolean;
  /** Whether an action was let go this frame. Throws PieceError "unknown_action". */
  wasReleased(actionName: string): boolean;
  /** How far an action is pressed, 0 to 100: a trigger pulled halfway is 50, a key 0 or 100. Throws PieceError "unknown_action". */
  pressedPctOf(actionName: string): number;

  /** Changes what an action is bound to, as a controls screen does: only the fields given change. Throws "unknown_action", "bad_binding", "unknown_control". */
  setBinding(actionName: string, binding: Partial<Binding>): void;
  /** Sets every binding from what bindings answered earlier (the player's saved controls). An action the game no longer has is skipped. */
  setBindings(bindings: Record<string, Partial<Binding>>): void;
  /** Puts bindings back to the game's own: the actions named, or every one. */
  resetBindings(actionNames?: string[]): void;
  /**
   * Waits for the player's next key, mouse button or gamepad button and binds it to the action, in place of its
   * others of that kind: for a controls screen's "press a key". deviceKind limits it to one device; null takes
   * either. Answers null when cancelled (Escape, cancelCapture, another capture, dispose). While it waits, the
   * press binds instead of playing.
   */
  captureBinding(actionName: string, deviceKind?: "keyboard_mouse" | "gamepad" | null): Promise<CapturedBinding | null>;
  cancelCapture(): void;
  /**
   * What to show for an action on a device (the one in use by default): keys as their key ("Space", "W", "↑"),
   * mouse buttons ("Left click"), gamepad buttons as the controller names them ("A", "✕", "RT"), or the touch
   * button's word. Empty when nothing on that device is bound to it.
   */
  labelsOf(actionName: string, deviceKind?: DeviceKind): string[];
  /** Presses or lets go of an action from the game's own controls, like a button it draws itself. */
  setTouchHeld(actionName: string, isHeld: boolean): void;
  /**
   * Shakes the gamepad in use, or a phone that can vibrate (its strength isn't set). strongPct and weakPct are the
   * two motors, 0 to 100; durationMs up to 5000. Answers whether anything shook. Does nothing with rumble_enabled off.
   */
  rumble(rumble?: { strongPct?: number; weakPct?: number; durationMs?: number }): boolean;
  /** Locks the pointer to the game, as a click does in pointer_lock mode. A browser may need a click first. */
  lockPointer(): void;
  unlockPointer(): void;
  /** This frame's input as plain data. */
  snapshot(): InputSnapshot;
  /** Stops reading, takes its touch controls off the page and lets the pointer go. */
  dispose(): void;
}

/**
 * Starts reading input. Throws PieceError "unknown_argument", "bad_argument", "bad_binding", "unknown_control",
 * "no_page", and the settings' "unknown_setting" and "bad_setting".
 */
export declare function createInput(given?: InputArguments): Input;

export declare const DEVICE_KINDS: readonly DeviceKind[];
export declare const GAMEPAD_BUTTON_NAMES: readonly GamepadButtonName[];
export declare const MOUSE_BUTTON_NAMES: readonly MouseButtonName[];
export declare const MOVE_ACTION_NAMES: readonly MoveActionName[];
/** What the move actions are bound to by default: WASD, the arrows and the d-pad. */
export declare const DEFAULT_MOVE_BINDINGS: Readonly<Record<MoveActionName, Binding>>;
/** The actions a game has when it names none: jump (Space, face_bottom, "Jump") and sprint (Shift, left_stick_press, "Run"). */
export declare const DEFAULT_ACTIONS: Readonly<Record<string, Binding>>;
/** The settings that are the player's own choices, which input.kept keeps between plays; the rest are the game's to tune. */
export declare const KEPT_SETTING_NAMES: readonly (keyof InputSettingValues)[];
/** Each controller's name for each gamepad button, in GAMEPAD_BUTTON_NAMES' order. */
export declare const GAMEPAD_LABELS: Readonly<Record<GamepadStyle, readonly string[]>>;

/** A key's label from its code: "KeyW" is "W", "ShiftLeft" is "Shift", "ArrowUp" is "↑". */
export declare function keyLabel(keyCode: string): string;
/** The kind of controller a gamepad is, from its id. */
export declare function gamepadStyleOf(gamepadId: string): GamepadStyle;
/** A stick's reading past a radial dead zone, from nothing at its edge to 1; fineAimPct keeps small pushes finer. */
export declare function shapeStick(x: number, y: number, deadZonePct: number, fineAimPct?: number): Vector2;
/** What a stick's push is raised to for fine aim: 1 at 0, 4 at 100. */
export declare function fineAimExponentOf(fineAimPct: number): number;
/** A move kept to length 1 at most, its direction unchanged. */
export declare function clampMove(x: number, y: number): Vector2;
