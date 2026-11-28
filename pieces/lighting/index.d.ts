/**
 * @zaisma/lighting: lighting and sky for three.js. One call gives a scene a sky with a sun, a moon, stars and
 * clouds, sunlight whose shadows follow the player, fill light, reflections and fog that all match the sky, set by
 * the time of day, and fits what it draws to the device.
 *
 * @example
 * import { createLighting } from "./pieces/@zaisma/lighting/index.js";
 * const lighting = createLighting({ scene, renderer, followTarget: player, settings: { timeOfDayHours: 17 } });
 * lighting.giveShadows(level);                       // the ground, buildings and characters cast and take shadows
 * // each frame, before rendering:
 * lighting.update(camera);
 * renderer.render(scene, camera);
 * // while playing:
 * lighting.settings.set({ dayLengthMin: 20 });       // a 20-minute day
 * lighting.hooks.on("nightStarted", () => lightTheTorches());
 */
import type { Camera, DirectionalLight, Fog, HemisphereLight, Mesh, Object3D, Scene, Vector3, WebGLRenderer } from "three";
import type { GivenToPiece, Hooks, Settings } from "../piece/index.js";

export type QualityLevel = "low" | "medium" | "high";

/** Every setting, in JavaScript's names; piece.json states each with its range and default. All change while playing. */
export interface LightingSettings {
  [name: string]: number | boolean | string;
  /** The time of day, 0 to 24: the sun rises at 6, is highest at 12, sets at 18. Moves on its own while dayLengthMin is above 0. Default 13. */
  timeOfDayHours: number;
  /** Real minutes a whole day takes; 0 keeps the time where it's set. Default 0. */
  dayLengthMin: number;
  /** How high the sun climbs at noon, in degrees, 5 to 90. Default 62. */
  sunPeakElevationDeg: number;
  /** Turns the sun's path round the up axis, 0 to 360 degrees, counterclockwise from above: which way shadows fall. At 0 it rises toward +x and is highest toward +z. Default 0. */
  sunPathTurnDeg: number;
  /** "auto" starts at medium on phones and tablets and high elsewhere, and steps down while frames run under 25 a second. Default "auto". */
  qualityLevel: QualityLevel | "auto";
  /** Whether the sun casts shadows at medium and high. Default true. */
  shadowsEnabled: boolean;
  /** How far shadows reach round what they follow, in metres, 4 to 400. Smaller is sharper. Default 30. */
  shadowDistanceM: number;
  /** The sun's (or the moon's) strength against the time of day's own, 0 to 400. Default 100. */
  lightStrengthPct: number;
  /** The fill light's strength against the time of day's own, 0 to 400. Default 100. */
  fillStrengthPct: number;
  /** Whether standard and physical materials reflect the sky, at medium and high. Default true. */
  reflectionsEnabled: boolean;
  /** The picture's brightness as a camera's exposure, 10 to 400. Default 100. */
  exposurePct: number;
  /** How bright light fits the screen: "neutral" keeps a game's colours, "aces" filmic, "agx" soft, "none" three's own. Default "neutral". */
  toneMapping: "neutral" | "aces" | "agx" | "none";
  /** Whether far things fade into the sky. Default true. */
  fogEnabled: boolean;
  /** Where the fog starts and where it hides everything, in metres. Defaults 60 and 320. */
  fogStartM: number;
  fogEndM: number;
  /** How much of the sky clouds cover, 0 to 100. Not drawn at low. Default 35. */
  cloudsPct: number;
  /** Whether stars and the moon show at night. Default true. */
  starsEnabled: boolean;
}

/** What the sky and its light look like: before_look gets one and may answer one with any fields changed. Colours are "#rrggbb". */
export interface Look {
  zenithColor: string;
  horizonColor: string;
  /** The fog's colour, which is also the sky below the horizon. */
  fogColor: string;
  /** The sun's colour by day, the moon's by night. */
  lightColor: string;
  /** The sun's or the moon's strength, 0 to 20, before lightStrengthPct. */
  lightLux: number;
  fillSkyColor: string;
  fillGroundColor: string;
  /** The fill light's strength, 0 to 20, before fillStrengthPct. */
  fillLux: number;
  cloudColor: string;
  /** How bright the stars are, 0 to 100. */
  starsPct: number;
}

export interface LightingHooks {
  [name: string]: (...given: any[]) => unknown;
  /** Asked whenever the time or a setting changes the look; answer a look with fields changed (a storm, an alien sky), or nothing. An answer that isn't a look is skipped with a logged error. */
  beforeLook: (look: Look, moment: { timeOfDayHours: number; isNight: boolean }) => Partial<Look> | void;
  /** Told when the sun comes up and lights the scene again. */
  dayStarted: (timeOfDayHours: number) => void;
  /** Told when the moon takes over from the sun. */
  nightStarted: (timeOfDayHours: number) => void;
  /** Told when the quality level in use changes, and why. */
  qualityChanged: (change: { qualityLevel: QualityLevel; reason: "setting" | "slow_frames" }) => void;
}

export interface LightingGiven extends GivenToPiece<LightingSettings, LightingHooks> {
  /** The scene to light. */
  scene: Scene;
  /** The renderer that draws it: the piece sets its shadows, tone mapping, exposure and colour space. */
  renderer: WebGLRenderer;
  /** What the shadows stay with: the player's character. Null follows the camera. Default null. */
  followTarget?: Object3D | null;
}

export interface Lighting {
  settings: Settings<LightingSettings>;
  hooks: Hooks<LightingHooks>;
  /** three's own objects, for anything the settings and hooks don't reach. */
  sky: Mesh;
  sun: DirectionalLight;
  fill: HemisphereLight;
  fog: Fog;
  /** A unit vector toward the light that's shining: the sun, or the moon at night. */
  readonly lightDirection: Vector3;
  /** The quality level in use, with auto worked out. */
  readonly qualityLevel: QualityLevel;
  /** Whether the moon lights the scene now. */
  readonly isNight: boolean;
  /** The look in use, after before_look: a copy. */
  readonly look: Look;
  /** Every frame, before rendering: moves the time of day, keeps shadows round the followed target, watches the frame rate. nowMs defaults to performance.now(). Throws PieceError "camera_needed". */
  update(camera: Camera, nowMs?: number): void;
  /** Shadows follow another object, or the camera with null. Throws PieceError "bad_follow_target". */
  follow(target: Object3D | null): void;
  /** Lets every mesh in an object cast and take shadows. Answers how many meshes. Throws PieceError "bad_object". */
  giveShadows(object: Object3D, options?: { isCasting?: boolean; isReceiving?: boolean }): number;
  /** Takes the lighting out of the scene and frees what it holds. */
  dispose(): void;
}

/** Lights a scene. Throws PieceError "unknown_argument", "scene_needed", "renderer_needed", "bad_follow_target", or the frame's "unknown_setting", "bad_setting", "unknown_hook". */
export declare function createLighting(given: LightingGiven): Lighting;

/** What each quality level draws. */
export declare const QUALITY_LEVELS: Record<QualityLevel, { shadowMapSizePx: number; hasSoftShadows: boolean; hasReflections: boolean; hasClouds: boolean }>;
/** The colour fields of a look, and each number field's maximum. */
export declare const LOOK_COLOR_FIELDS: readonly (keyof Look)[];
export declare const LOOK_NUMBER_FIELDS: { lightLux: number; fillLux: number; starsPct: number };
/** Whether this device is a phone or a tablet (a touch screen with no mouse), and the level auto starts at on it. */
export declare function isTouchDevice(): boolean;
export declare function startingQualityLevel(): "medium" | "high";

// The sky as plain numbers, with no engine (sky.js), for another engine to draw the same sky.

/** Named times of day, each a settings change: lighting.settings.set(TIME_PRESETS.golden_hour). */
export declare const TIME_PRESETS: Record<"dawn" | "morning" | "day" | "golden_hour" | "dusk" | "night", { timeOfDayHours: number }>;
/** Below this the moon lights the scene. */
export declare const NIGHT_ELEVATION_DEG: number;
/** The lowest the sun's and the moon's light shine from, however low they're drawn. */
export declare const MINIMUM_SUN_LIGHT_ELEVATION_DEG: number;
export declare const MINIMUM_MOON_LIGHT_ELEVATION_DEG: number;
/** A time of day brought into 0 to 24. */
export declare function wrapHours(timeOfDayHours: number): number;

type Direction = [number, number, number];
/** [red, green, blue] from 0 to 1, as shown on screen. */
type Rgb = [number, number, number];
export interface SunPath {
  peakElevationDeg?: number;
  pathTurnDeg?: number;
}
/** The sun's height in degrees and a unit vector toward it (+y up). */
export declare function sunAt(timeOfDayHours: number, sunPath?: SunPath): { elevationDeg: number; direction: Direction };
/** Every colour and strength of the sky and its light at a time of day. */
export declare function skyAt(
  timeOfDayHours: number,
  sunPath?: SunPath,
): {
  sunElevationDeg: number;
  sunDirection: Direction;
  moonDirection: Direction;
  /** Toward the light that's shining, kept above its minimum elevation. */
  lightDirection: Direction;
  isNight: boolean;
  zenithColor: Rgb;
  horizonColor: Rgb;
  fogColor: Rgb;
  lightColor: Rgb;
  lightLux: number;
  fillSkyColor: Rgb;
  fillGroundColor: Rgb;
  fillLux: number;
  cloudColor: Rgb;
  starsPct: number;
};
