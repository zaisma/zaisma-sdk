/**
 * @zaisma/lighting-effects: camera effects that plug into @zaisma/lighting. Bloom on bright things, colour grading
 * with named moods, sun rays and soft shade in corners. Each is off until the game turns it on, each has its own level
 * per device, and auto levels step down with the lighting's quality when frames run slow, so a phone keeps its frame
 * rate. With every effect off, render draws the scene exactly as renderer.render would.
 *
 * @example
 * import { createLighting } from "./pieces/@zaisma/lighting/index.js";
 * import { createLightingEffects } from "./pieces/@zaisma/lighting-effects/index.js";
 * const lighting = createLighting({ scene, renderer, followTarget: player });
 * const effects = createLightingEffects({ lighting, scene, renderer, settings: { bloomLevel: "auto", sunRaysLevel: "auto", cornerShadeLevel: "auto", gradingMood: "warm" } });
 * // each frame:
 * lighting.update(camera);
 * effects.render(camera);                              // in place of renderer.render(scene, camera)
 * // while playing:
 * effects.settings.set({ gradingMood: "noir" });     // a flashback
 * effects.hooks.on("beforeGrade", (grade) => (isPoisoned ? { warmthPct: -60, saturationPct: 60 } : undefined));
 */
import type { Camera, Scene, WebGLRenderer } from "three";
import type { Lighting } from "../lighting/index.js";
import type { GivenToPiece, Hooks, Settings } from "../piece/index.js";

/** What a game chooses for an effect: auto follows the lighting's quality in use. */
export type EffectChoice = "off" | "auto" | "low" | "medium" | "high";
/** What an effect draws at now. */
export type EffectLevel = "off" | "low" | "medium" | "high";
export type Mood = "vivid" | "warm" | "cool" | "faded" | "moody" | "noir" | "dreamy";

/** Every setting, in JavaScript's names; piece.json states each with its range and default. All change while playing. */
export interface LightingEffectsSettings {
  [name: string]: number | boolean | string;
  /** Bloom: a soft glow round bright things. auto: medium or high as the lighting's quality in use, none at low. Default "off". */
  bloomLevel: EffectChoice;
  /** How strong the bloom is, 0 to 400. Default 100. */
  bloomStrengthPct: number;
  /** How bright something must be to bloom against white lit by the sun, 0 to 2000: at 150 the sun, lamps and emissive colours past white bloom, sunlit walls don't; lower makes more things bloom. Default 150. */
  bloomThresholdPct: number;
  /** How far the bloom spreads, 0 to 100. Default 60. */
  bloomSpreadPct: number;
  /** The colour grading's mood; "none" grades nothing. Default "none". */
  gradingMood: Mood | "none";
  /** How much of the mood shows, 0 to 100. Default 100. */
  gradingStrengthPct: number;
  /** Rays from the sun while it's up and in view. auto: as the lighting's quality in use, none at low. Default "off". */
  sunRaysLevel: EffectChoice;
  /** How strong the rays are, 0 to 400. Default 100. */
  sunRaysStrengthPct: number;
  /** Soft shade where surfaces meet, on PCs only: never drawn on phones and tablets. auto: only while the lighting's quality in use is high. Default "off". */
  cornerShadeLevel: EffectChoice;
  /** How dark the shade is, 0 to 300. Default 100. */
  cornerShadeStrengthPct: number;
  /** How far it reaches out of a corner, in metres, 0.05 to 10. Default 0.8. */
  cornerShadeRadiusM: number;
}

/** A colour grade, applied to the picture as shown on screen: before_grade gets one and may answer one with any fields changed. */
export interface Grade {
  /** 0 is grey, 100 as it is, 200 doubles colour. */
  saturationPct: number;
  /** Round middle grey, 50 to 200. */
  contrastPct: number;
  /** From black, 50 to 200. */
  brightnessPct: number;
  /** Toward orange (up to 100) or blue (down to -100). */
  warmthPct: number;
  /** How much shadowColor and highlightColor tint the dark and bright parts, 0 to 100. */
  tintPct: number;
  /** How much the corners darken, 0 to 100. */
  vignettePct: number;
  /** "#rrggbb"; "#808080" tints nothing. */
  shadowColor: string;
  highlightColor: string;
}

export interface LightingEffectsHooks {
  [name: string]: (...given: any[]) => unknown;
  /** Asked when the mood changes; answer a grade with fields changed, or nothing. An answer that isn't a grade is skipped with a logged error. */
  beforeGrade: (grade: Grade, moment: { gradingMood: Mood }) => Partial<Grade> | void;
  /** Told when an effect's level in use changes, and why. */
  levelsChanged: (change: { bloomLevel: EffectLevel; sunRaysLevel: EffectLevel; cornerShadeLevel: EffectLevel; reason: "setting" | "lighting_quality" }) => void;
}

export interface LightingEffectsGiven extends GivenToPiece<LightingEffectsSettings, LightingEffectsHooks> {
  /** The lighting the effects plug into, from @zaisma/lighting's createLighting. */
  lighting: Lighting;
  /** The scene the lighting lights. */
  scene: Scene;
  /** The renderer that draws it. */
  renderer: WebGLRenderer;
}

export interface LightingEffects {
  settings: Settings<LightingEffectsSettings>;
  hooks: Hooks<LightingEffectsHooks>;
  /** The level each effect draws at now, with auto worked out. A copy. */
  readonly levels: { bloomLevel: EffectLevel; sunRaysLevel: EffectLevel; cornerShadeLevel: EffectLevel };
  /** The grade in use after before_grade, or null with gradingMood "none". A copy. */
  readonly grade: Grade | null;
  /** Every frame, after lighting.update(camera), in place of renderer.render(scene, camera). Draws into the renderer's render target at the time (the screen by default). Throws PieceError "camera_needed". */
  render(camera: Camera): void;
  /** Takes the effects away and frees what they hold. */
  dispose(): void;
}

/** Adds camera effects to a lit scene. Throws PieceError "unknown_argument", "lighting_needed", "scene_needed", "renderer_needed", or the frame's "unknown_setting", "bad_setting", "unknown_hook". */
export declare function createLightingEffects(given: LightingEffectsGiven): LightingEffects;

/** What each effect draws at each level. */
export declare const EFFECT_LEVELS: {
  bloom: Record<"low" | "medium" | "high", { resolutionPct: number; mipCount: number }>;
  sunRays: Record<"low" | "medium" | "high", { resolutionPct: number; sampleCount: number }>;
  cornerShade: Record<"low" | "medium" | "high", { resolutionPct: number; sampleCount: number }>;
};

// The moods as plain numbers, with no engine (moods.js), for another engine to grade the same way.

/** Each named mood's grade. */
export declare const MOODS: Record<Mood, Grade>;
/** A grade that changes nothing. */
export declare const NEUTRAL_GRADE: Grade;
/** Each number field of a grade with its range, and the colour fields. */
export declare const GRADE_NUMBER_FIELDS: Record<"saturationPct" | "contrastPct" | "brightnessPct" | "warmthPct" | "tintPct" | "vignettePct", { minimumNumber: number; maximumNumber: number }>;
export declare const GRADE_COLOR_FIELDS: readonly ("shadowColor" | "highlightColor")[];
/** One colour graded as the shader grades it: [red, green, blue] from 0 to 1 as shown on screen, at a place on the screen (0 to 1 each way), mixed in by strengthPct. */
export declare function gradeColor(rgb: [number, number, number], grade: Grade, place?: { screenX?: number; screenY?: number; strengthPct?: number }): [number, number, number];
