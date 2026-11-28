// @zaisma/lighting-effects: camera effects that plug into @zaisma/lighting. Bloom on bright things, colour grading
// with named moods, sun rays and soft shade in corners, each off until a game turns it on, each with its own level
// per device, stepping down with the lighting's quality. With every effect off it draws the scene exactly as
// renderer.render would, at no cost. The reference is index.d.ts; the moods are in moods.js with no engine. MIT licensed.

import * as THREE from "three";
import { PieceError, openPiece } from "../piece/index.js";
import { isTouchDevice, sunAt } from "../lighting/index.js";
import statement from "./piece.json.js";
import { GRADE_COLOR_FIELDS, GRADE_NUMBER_FIELDS, MOODS, NEUTRAL_GRADE, gradeColor } from "./moods.js";

export { GRADE_COLOR_FIELDS, GRADE_NUMBER_FIELDS, MOODS, NEUTRAL_GRADE, gradeColor };

/**
 * What each effect draws at each level: how big its pictures are against the screen, and how many samples each
 * pixel takes. auto picks the lighting's quality level in use; none at low, and corner shade only at high.
 */
export const EFFECT_LEVELS = {
  bloom: { low: { resolutionPct: 25, mipCount: 3 }, medium: { resolutionPct: 25, mipCount: 4 }, high: { resolutionPct: 50, mipCount: 5 } },
  sunRays: { low: { resolutionPct: 25, sampleCount: 16 }, medium: { resolutionPct: 25, sampleCount: 28 }, high: { resolutionPct: 50, sampleCount: 48 } },
  cornerShade: { low: { resolutionPct: 50, sampleCount: 8 }, medium: { resolutionPct: 50, sampleCount: 12 }, high: { resolutionPct: 50, sampleCount: 16 } },
};

const EFFECT_NAMES = ["bloom", "sunRays", "cornerShade"];
const GIVEN_FIELDS = ["settings", "hooks", "lighting", "scene", "renderer"];
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
// The picture the scene is drawn into is smoothed this many times a pixel at high, as a renderer's antialias does.
const HIGH_SAMPLE_COUNT = 4;
// The bloom's strength once its pictures are summed, at bloom_strength_pct 100.
const BLOOM_STRENGTH_NUMBER = 0.6;
// How strong the rays are against the sun's colour, at sun_rays_strength_pct 100.
const SUN_RAYS_STRENGTH_NUMBER = 0.6;
// How far round the sun, as a share of the screen's height, the sky feeds its rays.
const SUN_RAYS_REACH_NUMBER = 0.55;

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// The bloom's first step: what's brighter than the threshold, easing in over a knee so nothing pops, shrunk from the
// scene with four bilinear taps a texel out, so each covers four texels and nothing shimmers.
const BLOOM_BRIGHT_FRAGMENT = `
uniform sampler2D source;
uniform vec2 sourceTexel;
uniform float threshold;
varying vec2 vUv;
vec3 tap(vec2 offset) {
  return min(texture2D(source, vUv + offset * sourceTexel).rgb, vec3(40.0));
}
void main() {
  vec3 color = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float brightness = max(color.r, max(color.g, color.b));
  float knee = threshold * 0.25 + 1e-4;
  float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  gl_FragColor = vec4(color * max(soft, brightness - threshold) / max(brightness, 1e-4), 1.0);
}`;

const BLOOM_DOWN_FRAGMENT = `
uniform sampler2D source;
uniform vec2 sourceTexel;
varying vec2 vUv;
void main() {
  vec3 color = texture2D(source, vUv + vec2(-1.0, -1.0) * sourceTexel).rgb + texture2D(source, vUv + vec2(1.0, -1.0) * sourceTexel).rgb
    + texture2D(source, vUv + vec2(-1.0, 1.0) * sourceTexel).rgb + texture2D(source, vUv + vec2(1.0, 1.0) * sourceTexel).rgb;
  gl_FragColor = vec4(color * 0.25, 1.0);
}`;

// Each picture of the bloom, from the smallest up: its own light plus the smaller one's, spread with a tent.
const BLOOM_UP_FRAGMENT = `
uniform sampler2D source;
uniform sampler2D smaller;
uniform vec2 smallerTexel;
uniform float spread;
varying vec2 vUv;
void main() {
  vec3 wide = texture2D(smaller, vUv + vec2(-1.0, -1.0) * smallerTexel).rgb + texture2D(smaller, vUv + vec2(1.0, -1.0) * smallerTexel).rgb
    + texture2D(smaller, vUv + vec2(-1.0, 1.0) * smallerTexel).rgb + texture2D(smaller, vUv + vec2(1.0, 1.0) * smallerTexel).rgb;
  gl_FragColor = vec4(texture2D(source, vUv).rgb + wide * 0.25 * spread, 1.0);
}`;

// The rays' first step: the open sky near the sun, as bright as it's drawn, so clouds and everything in front of the
// sky block it.
const SUN_RAYS_MASK_FRAGMENT = `
uniform sampler2D source;
uniform sampler2D depth;
uniform vec2 sunPoint;
uniform float aspect;
uniform float reach;
varying vec2 vUv;
void main() {
  float isSky = step(0.99999, texture2D(depth, vUv).x);
  vec2 fromSun = (vUv - sunPoint) * vec2(aspect, 1.0);
  float near = max(1.0 - length(fromSun) / reach, 0.0);
  vec3 color = min(texture2D(source, vUv).rgb, vec3(8.0));
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(vec3(isSky * near * near * max(brightness - 0.25, 0.0)), 1.0);
}`;

// The rays themselves: each pixel gathers the lit sky between it and the sun, fading with distance.
const SUN_RAYS_BLUR_FRAGMENT = `
uniform sampler2D source;
uniform vec2 sunPoint;
varying vec2 vUv;
void main() {
  vec2 step = (sunPoint - vUv) / float(SAMPLE_COUNT) * 0.9;
  vec2 spot = vUv;
  float weight = 1.0;
  float total = 0.0;
  for (int index = 0; index < SAMPLE_COUNT; index++) {
    total += texture2D(source, spot).r * weight;
    weight *= 0.965;
    spot += step;
  }
  gl_FragColor = vec4(vec3(total / float(SAMPLE_COUNT) * 2.0), 1.0);
}`;

// Shade in corners: how much of the space just above each surface is taken by other surfaces, read from depth alone,
// sampled on a spiral turned at each pixel. 1 is open, 0 is closed in.
const CORNER_SHADE_FRAGMENT = `
uniform sampler2D depth;
uniform mat4 cameraProjection;
uniform mat4 cameraProjectionInverse;
uniform float radiusM;
varying vec2 vUv;
vec3 viewPositionAt(vec2 uv) {
  vec4 placed = cameraProjectionInverse * vec4(uv * 2.0 - 1.0, texture2D(depth, uv).x * 2.0 - 1.0, 1.0);
  return placed.xyz / placed.w;
}
void main() {
  // The surface's facingNumber from its neighbours, worked out before any pixel leaves, so every neighbour has one.
  vec3 centre = viewPositionAt(vUv);
  vec3 normal = normalize(cross(dFdx(centre), dFdy(centre)));
  if (texture2D(depth, vUv).x >= 0.99999) {
    gl_FragColor = vec4(1.0);
    return;
  }
  float distanceM = max(-centre.z, 0.05);
  vec2 radiusUv = radiusM * 0.5 * vec2(cameraProjection[0][0], cameraProjection[1][1]) / distanceM;
  float turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float closed = 0.0;
  for (int index = 0; index < SAMPLE_COUNT; index++) {
    float along = (float(index) + 0.5) / float(SAMPLE_COUNT);
    float angle = turn + float(index) * 2.3999632;
    vec3 offset = viewPositionAt(vUv + vec2(cos(angle), sin(angle)) * radiusUv * along) - centre;
    float offsetM = length(offset);
    float rise = dot(normal, offset) / max(offsetM, 1e-4);
    closed += max(rise - 0.1, 0.0) * (1.0 - smoothstep(radiusM * 0.6, radiusM * 1.6, offsetM));
  }
  gl_FragColor = vec4(vec3(pow(clamp(1.0 - closed / float(SAMPLE_COUNT) * 3.0, 0.0, 1.0), 1.5)), 1.0);
}`;

// The picture put together: the scene, shaded in corners (a depth-aware blur), with its bloom and rays added, then
// tone mapped as the renderer would, and graded as moods.js grades.
const COMPOSITE_FRAGMENT = `
uniform sampler2D source;
uniform sampler2D depth;
uniform sampler2D bloom;
uniform sampler2D sunRays;
uniform sampler2D cornerShade;
uniform vec2 cornerShadeTexel;
uniform mat4 cameraProjectionInverse;
uniform float bloomStrengthNumber;
uniform vec3 sunRaysColor;
uniform float cornerShadeShare;
uniform float gradingShare;
uniform float saturation;
uniform float contrast;
uniform float brightness;
uniform float warmth;
uniform float tint;
uniform float vignette;
uniform vec3 shadowColor;
uniform vec3 highlightColor;
varying vec2 vUv;

float viewDistanceAt(vec2 uv) {
  vec4 placed = cameraProjectionInverse * vec4(uv * 2.0 - 1.0, texture2D(depth, uv).x * 2.0 - 1.0, 1.0);
  return -placed.z / placed.w;
}
float overlayChannel(float base, float blend) {
  return base < 0.5 ? 2.0 * base * blend : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

void main() {
  vec3 color = texture2D(source, vUv).rgb;
  #ifdef HAS_CORNER_SHADE
  float centreM = viewDistanceAt(vUv);
  float shadeTotal = 0.0;
  float weightTotal = 0.0;
  for (int index = 0; index < 4; index++) {
    vec2 offset = vec2(index == 0 || index == 2 ? -1.0 : 1.0, index < 2 ? -1.0 : 1.0) * cornerShadeTexel * 0.75;
    float weight = exp(-abs(viewDistanceAt(vUv + offset) - centreM) / max(centreM, 0.1) * 30.0);
    shadeTotal += texture2D(cornerShade, vUv + offset).r * weight;
    weightTotal += weight;
  }
  float open = weightTotal > 1e-4 ? shadeTotal / weightTotal : 1.0;
  color *= 1.0 - (1.0 - open) * cornerShadeShare;
  #endif
  #ifdef HAS_BLOOM
  color += texture2D(bloom, vUv).rgb * bloomStrengthNumber;
  #endif
  #ifdef HAS_SUN_RAYS
  color += texture2D(sunRays, vUv).r * sunRaysColor;
  #endif
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef HAS_GRADING
  vec3 shown = clamp(gl_FragColor.rgb, 0.0, 1.0);
  vec3 graded = shown * brightness;
  float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  graded = vec3(luma) + (graded - vec3(luma)) * saturation;
  graded = (graded - 0.5) * contrast + 0.5;
  graded += vec3(warmth, warmth * 0.25, -warmth);
  float tone = smoothstep(0.0, 1.0, clamp(luma, 0.0, 1.0));
  vec3 tintColor = mix(shadowColor, highlightColor, tone);
  vec3 base = clamp(graded, 0.0, 1.0);
  vec3 tinted = vec3(overlayChannel(base.r, tintColor.r), overlayChannel(base.g, tintColor.g), overlayChannel(base.b, tintColor.b));
  graded = base + (tinted - base) * tint;
  float edge = clamp((length(vUv - 0.5) * 1.42 - 0.45) / 0.65, 0.0, 1.0);
  graded = clamp(graded * (1.0 - vignette * 0.6 * edge * edge * (3.0 - 2.0 * edge)), 0.0, 1.0);
  gl_FragColor.rgb = shown + (graded - shown) * gradingShare;
  #endif
}`;

const hexToLinear = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
// Colours a grade gives are as shown on screen; the shader grades after the screen's colour space, so it takes them
// as they are, never converted to linear.
const hexToShown = (hex, vector) => vector.set(...[1, 3, 5].map((startIndex) => parseInt(hex.slice(startIndex, startIndex + 2), 16) / 255));

/**
 * Adds camera effects to a scene the lighting piece lights. Call effects.render(camera) every frame in place of
 * renderer.render(scene, camera), after lighting.update(camera).
 */
export function createLightingEffects(given = {}) {
  const { settings, hooks, tell, ask, refuse } = openPiece(statement, { settings: given.settings, hooks: given.hooks });
  for (const field of Object.keys(given)) {
    if (!GIVEN_FIELDS.includes(field)) refuse("unknown_argument", { message: `createLightingEffects has no argument "${field}".`, field, fix: `Give only: ${GIVEN_FIELDS.join(", ")}. A setting goes inside settings.` });
  }
  const { lighting, scene, renderer } = given;
  if (!lighting || !lighting.settings || !(lighting.sun instanceof THREE.DirectionalLight) || typeof lighting.qualityLevel !== "string") refuse("lighting_needed", { message: "createLightingEffects needs the lighting it plugs into.", field: "lighting", fix: "Make the lighting first with @zaisma/lighting's createLighting({ scene, renderer }), and give it as lighting." });
  if (!(scene instanceof THREE.Scene)) refuse("scene_needed", { message: "createLightingEffects needs the scene the lighting lights.", field: "scene", fix: "Give createLightingEffects({ lighting, scene, renderer }), with scene the THREE.Scene given to createLighting." });
  if (!renderer || typeof renderer.render !== "function" || typeof renderer.setRenderTarget !== "function") refuse("renderer_needed", { message: "createLightingEffects needs the three.js renderer that draws the scene.", field: "renderer", fix: "Give createLightingEffects({ lighting, scene, renderer }), with renderer the THREE.WebGLRenderer given to createLighting." });

  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const passMaterial = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const materials = {
    bloomBright: passMaterial(BLOOM_BRIGHT_FRAGMENT, { source: { value: null }, sourceTexel: { value: new THREE.Vector2() }, threshold: { value: 1 } }),
    bloomDown: passMaterial(BLOOM_DOWN_FRAGMENT, { source: { value: null }, sourceTexel: { value: new THREE.Vector2() } }),
    bloomUp: passMaterial(BLOOM_UP_FRAGMENT, { source: { value: null }, smaller: { value: null }, smallerTexel: { value: new THREE.Vector2() }, spread: { value: 0.6 } }),
    sunRaysMask: passMaterial(SUN_RAYS_MASK_FRAGMENT, { source: { value: null }, depth: { value: null }, sunPoint: { value: new THREE.Vector2() }, aspect: { value: 1 }, reach: { value: SUN_RAYS_REACH_NUMBER } }),
    sunRaysBlur: passMaterial(SUN_RAYS_BLUR_FRAGMENT, { source: { value: null }, sunPoint: { value: new THREE.Vector2() } }),
    cornerShade: passMaterial(CORNER_SHADE_FRAGMENT, { depth: { value: null }, cameraProjection: { value: new THREE.Matrix4() }, cameraProjectionInverse: { value: new THREE.Matrix4() }, radiusM: { value: 0.8 } }),
    composite: passMaterial(
      COMPOSITE_FRAGMENT,
      {
        source: { value: null },
        depth: { value: null },
        bloom: { value: null },
        sunRays: { value: null },
        cornerShade: { value: null },
        cornerShadeTexel: { value: new THREE.Vector2() },
        cameraProjectionInverse: { value: new THREE.Matrix4() },
        bloomStrengthNumber: { value: 0 },
        sunRaysColor: { value: new THREE.Color(0, 0, 0) },
        cornerShadeShare: { value: 0 },
        gradingShare: { value: 0 },
        saturation: { value: 1 },
        contrast: { value: 1 },
        brightness: { value: 1 },
        warmth: { value: 0 },
        tint: { value: 0 },
        vignette: { value: 0 },
        shadowColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        highlightColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      },
      // The last step is tone mapped and put in the screen's colour space, as the renderer does for the scene.
      { toneMapped: true },
    ),
  };

  // HDR, so the bloom knows the sun from a white wall; a device that can't draw into one gets the screen's range.
  const canDrawHighRange = Boolean(renderer.extensions?.has?.("EXT_color_buffer_float") || renderer.extensions?.has?.("EXT_color_buffer_half_float"));
  const pictureTypeNumber = canDrawHighRange ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const makeTarget = (widthPx, heightPx, extra = {}) => new THREE.WebGLRenderTarget(widthPx, heightPx, { type: pictureTypeNumber, depthBuffer: false, ...extra });

  let targets = null;
  let targetsKey = "";
  let levels = { bloomLevel: "off", sunRaysLevel: "off", cornerShadeLevel: "off" };
  let lastLightingQuality = lighting.qualityLevel;
  let grade = null;
  const drawingSize = new THREE.Vector2();
  const sunWorld = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();

  // What's wrong with a grade before_grade answered, as a PieceError, or null when it's a grade.
  function gradeProblem(answered) {
    const problem = (message, fix) => new PieceError(statement.name, "bad_grade", { message, field: "beforeGrade", fix });
    if (!answered || typeof answered !== "object") return problem("before_grade answered something that isn't a grade.", "Answer the grade it was given with any fields changed, or nothing.");
    for (const field of Object.keys(answered)) {
      if (GRADE_COLOR_FIELDS.includes(field)) {
        if (typeof answered[field] !== "string" || !HEX_COLOR_PATTERN.test(answered[field].toLowerCase())) return problem(`before_grade answered ${field} as ${JSON.stringify(answered[field])}, which isn't a colour.`, `Answer ${field} as six hex digits, like "#3fa9f5".`);
      } else if (field in GRADE_NUMBER_FIELDS) {
        const { minimumNumber, maximumNumber } = GRADE_NUMBER_FIELDS[field];
        if (typeof answered[field] !== "number" || !(answered[field] >= minimumNumber && answered[field] <= maximumNumber)) return problem(`before_grade answered ${field} as ${JSON.stringify(answered[field])}.`, `Answer ${field} as a number from ${minimumNumber} to ${maximumNumber}.`);
      } else {
        return problem(`A grade has no "${field}".`, `A grade has: ${[...Object.keys(GRADE_NUMBER_FIELDS), ...GRADE_COLOR_FIELDS].join(", ")}.`);
      }
    }
    return null;
  }

  // Works out the mood's grade, lets the game change it, and puts it on the last step.
  function applyGrade() {
    const mood = settings.get("gradingMood");
    if (mood === "none") {
      grade = null;
      return;
    }
    const proposed = { ...MOODS[mood] };
    const answered = ask("beforeGrade", { ...proposed }, { gradingMood: mood });
    // A grade that isn't one is skipped with a logged error, like a handler that throws: the game never stops over it.
    const problem = gradeProblem(answered);
    if (problem) console.error(`${statement.name}: before_grade's answer was skipped.`, problem);
    grade = problem ? proposed : { ...proposed, ...answered };
    for (const field of GRADE_COLOR_FIELDS) grade[field] = grade[field].toLowerCase();
    const uniforms = materials.composite.uniforms;
    uniforms.saturation.value = grade.saturationPct / 100;
    uniforms.contrast.value = grade.contrastPct / 100;
    uniforms.brightness.value = grade.brightnessPct / 100;
    uniforms.warmth.value = (grade.warmthPct / 100) * 0.08;
    uniforms.tint.value = grade.tintPct / 100;
    uniforms.vignette.value = grade.vignettePct / 100;
    hexToShown(grade.shadowColor, uniforms.shadowColor.value);
    hexToShown(grade.highlightColor, uniforms.highlightColor.value);
  }

  settings.onChange((change) => {
    if (change.name === "gradingMood") applyGrade();
  });

  // The level each effect draws at now: what the game chose, with auto worked out from the lighting's quality in use.
  function levelInUse(effectName) {
    const chosen = settings.get(`${effectName}Level`);
    if (chosen === "off") return "off";
    if (effectName === "cornerShade" && isTouchDevice()) return "off";
    if (chosen !== "auto") return chosen;
    const lightingQuality = lighting.qualityLevel;
    if (lightingQuality === "low") return "off";
    if (effectName === "cornerShade") return lightingQuality === "high" ? "high" : "off";
    return lightingQuality;
  }

  function updateLevels() {
    const next = { bloomLevel: levelInUse("bloom"), sunRaysLevel: levelInUse("sunRays"), cornerShadeLevel: levelInUse("cornerShade") };
    const lightingQuality = lighting.qualityLevel;
    const isMoved = EFFECT_NAMES.some((effectName) => next[`${effectName}Level`] !== levels[`${effectName}Level`]);
    // A move of the lighting's quality explains it first: a setting changed with it still follows the lighting.
    const reason = lightingQuality !== lastLightingQuality ? "lighting_quality" : "setting";
    lastLightingQuality = lightingQuality;
    if (!isMoved) return;
    levels = next;
    tell("levelsChanged", { ...levels, reason });
  }

  function disposeTargets() {
    if (!targets) return;
    targets.scene.depthTexture?.dispose();
    for (const target of [targets.scene, ...targets.bloomDown, ...targets.bloomUp, targets.sunRaysMask, targets.sunRays, targets.cornerShade]) target?.dispose();
    targets = null;
    targetsKey = "";
  }

  // The pictures each effect draws into, made again when the screen's size or a level changes.
  function ensureTargets(widthPx, heightPx, isDepthNeeded) {
    const key = `${widthPx}x${heightPx}|${levels.bloomLevel}|${levels.sunRaysLevel}|${levels.cornerShadeLevel}|${isDepthNeeded}`;
    if (key === targetsKey) return;
    disposeTargets();
    const isHigh = [levels.bloomLevel, levels.sunRaysLevel, levels.cornerShadeLevel].includes("high") || lighting.qualityLevel === "high";
    const sceneTarget = makeTarget(widthPx, heightPx, { depthBuffer: true, samples: isHigh ? HIGH_SAMPLE_COUNT : 0 });
    // Depth as floats: 24 bits step in bands far off, and shade in corners reads surfaces from depth alone.
    if (isDepthNeeded) sceneTarget.depthTexture = new THREE.DepthTexture(widthPx, heightPx, THREE.FloatType);
    const scaled = (resolutionPct, divisorNumber = 1) => [Math.max(1, Math.round((widthPx * resolutionPct) / 100 / divisorNumber)), Math.max(1, Math.round((heightPx * resolutionPct) / 100 / divisorNumber))];
    const made = { scene: sceneTarget, bloomDown: [], bloomUp: [], sunRaysMask: null, sunRays: null, cornerShade: null };
    if (levels.bloomLevel !== "off") {
      const { resolutionPct, mipCount } = EFFECT_LEVELS.bloom[levels.bloomLevel];
      for (let mipIndex = 0; mipIndex < mipCount; mipIndex += 1) {
        made.bloomDown.push(makeTarget(...scaled(resolutionPct, 2 ** mipIndex)));
        made.bloomUp.push(makeTarget(...scaled(resolutionPct, 2 ** mipIndex)));
      }
    }
    if (levels.sunRaysLevel !== "off") {
      const { resolutionPct, sampleCount } = EFFECT_LEVELS.sunRays[levels.sunRaysLevel];
      made.sunRaysMask = makeTarget(...scaled(resolutionPct));
      made.sunRays = makeTarget(...scaled(resolutionPct));
      materials.sunRaysBlur.defines = { SAMPLE_COUNT: sampleCount };
      materials.sunRaysBlur.needsUpdate = true;
    }
    if (levels.cornerShadeLevel !== "off") {
      const { resolutionPct, sampleCount } = EFFECT_LEVELS.cornerShade[levels.cornerShadeLevel];
      made.cornerShade = makeTarget(...scaled(resolutionPct), { type: THREE.UnsignedByteType });
      materials.cornerShade.defines = { SAMPLE_COUNT: sampleCount };
      materials.cornerShade.needsUpdate = true;
    }
    targets = made;
    targetsKey = key;
  }

  function drawPass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  function drawBloom() {
    const values = settings.values;
    const bright = materials.bloomBright.uniforms;
    bright.source.value = targets.scene.texture;
    bright.sourceTexel.value.set(1 / targets.scene.width, 1 / targets.scene.height);
    bright.threshold.value = values.bloomThresholdPct / 100;
    drawPass(materials.bloomBright, targets.bloomDown[0]);
    const down = materials.bloomDown.uniforms;
    for (let mipIndex = 1; mipIndex < targets.bloomDown.length; mipIndex += 1) {
      const larger = targets.bloomDown[mipIndex - 1];
      down.source.value = larger.texture;
      down.sourceTexel.value.set(1 / larger.width, 1 / larger.height);
      drawPass(materials.bloomDown, targets.bloomDown[mipIndex]);
    }
    const up = materials.bloomUp.uniforms;
    up.spread.value = 0.25 + (values.bloomSpreadPct / 100) * 1.25;
    const lastIndex = targets.bloomDown.length - 1;
    let smaller = targets.bloomDown[lastIndex];
    for (let mipIndex = lastIndex - 1; mipIndex >= 0; mipIndex -= 1) {
      up.source.value = targets.bloomDown[mipIndex].texture;
      up.smaller.value = smaller.texture;
      up.smallerTexel.value.set(0.5 / smaller.width, 0.5 / smaller.height);
      drawPass(materials.bloomUp, targets.bloomUp[mipIndex]);
      smaller = targets.bloomUp[mipIndex];
    }
    // The summed pictures grow with each one added; this keeps a level's bloom as strong as another's.
    return (BLOOM_STRENGTH_NUMBER * (values.bloomStrengthPct / 100)) / (1 + (targets.bloomDown.length - 1) * up.spread.value * 0.5);
  }

  // Where the sun is on the screen, and how much its rays show: none behind the camera, below the horizon or at night.
  function sunRaysStrength(camera) {
    const values = lighting.settings.values;
    const sun = sunAt(values.timeOfDayHours, { peakElevationDeg: values.sunPeakElevationDeg, pathTurnDeg: values.sunPathTurnDeg });
    camera.getWorldDirection(cameraForward);
    sunWorld.fromArray(sun.direction);
    const facingNumber = cameraForward.dot(sunWorld);
    sunWorld.multiplyScalar(1000).add(camera.getWorldPosition(new THREE.Vector3()));
    sunWorld.project(camera);
    const risenNumber = Math.min(Math.max((sun.elevationDeg + 2) / 6, 0), 1);
    const facingShareNumber = Math.min(Math.max(facingNumber / 0.35, 0), 1);
    const sunPoint = [(sunWorld.x + 1) / 2, (sunWorld.y + 1) / 2];
    return { sunPoint, strengthNumber: risenNumber * facingShareNumber * (settings.get("sunRaysStrengthPct") / 100) };
  }

  function drawSunRays(camera) {
    const { sunPoint, strengthNumber } = sunRaysStrength(camera);
    if (strengthNumber <= 0) return 0;
    const mask = materials.sunRaysMask.uniforms;
    mask.source.value = targets.scene.texture;
    mask.depth.value = targets.scene.depthTexture;
    mask.sunPoint.value.set(...sunPoint);
    mask.aspect.value = targets.scene.width / targets.scene.height;
    drawPass(materials.sunRaysMask, targets.sunRaysMask);
    const blur = materials.sunRaysBlur.uniforms;
    blur.source.value = targets.sunRaysMask.texture;
    blur.sunPoint.value.set(...sunPoint);
    drawPass(materials.sunRaysBlur, targets.sunRays);
    return strengthNumber;
  }

  function drawCornerShade(camera) {
    const shade = materials.cornerShade.uniforms;
    shade.depth.value = targets.scene.depthTexture;
    shade.cameraProjection.value.copy(camera.projectionMatrix);
    shade.cameraProjectionInverse.value.copy(camera.projectionMatrixInverse);
    shade.radiusM.value = settings.get("cornerShadeRadiusM");
    drawPass(materials.cornerShade, targets.cornerShade);
  }

  const effects = {
    settings,
    hooks,
    /** The level each effect draws at now, with auto worked out: off, low, medium or high. A copy. */
    get levels() {
      return { ...levels };
    },
    /** The grade in use, after before_grade, or null with grading_mood none. A copy. */
    get grade() {
      return grade ? { ...grade } : null;
    },
    /** Every frame, in place of renderer.render(scene, camera), after lighting.update(camera). */
    render(camera) {
      if (!(camera instanceof THREE.Camera)) refuse("camera_needed", { message: "render needs the camera the scene is drawn from.", field: "camera", fix: "Call effects.render(camera) every frame, after lighting.update(camera), in place of renderer.render(scene, camera)." });
      updateLevels();
      const values = settings.values;
      const hasBloom = levels.bloomLevel !== "off" && values.bloomStrengthPct > 0;
      const hasSunRays = levels.sunRaysLevel !== "off" && values.sunRaysStrengthPct > 0;
      const hasCornerShade = levels.cornerShadeLevel !== "off" && values.cornerShadeStrengthPct > 0;
      const hasGrading = grade !== null && values.gradingStrengthPct > 0;
      const outputTarget = renderer.getRenderTarget();
      // With every effect off, the scene is drawn as it would be with no effects at all.
      if (!hasBloom && !hasSunRays && !hasCornerShade && !hasGrading) {
        disposeTargets();
        renderer.render(scene, camera);
        return;
      }
      renderer.getDrawingBufferSize(drawingSize);
      ensureTargets(drawingSize.x, drawingSize.y, hasSunRays || hasCornerShade);
      renderer.setRenderTarget(targets.scene);
      renderer.render(scene, camera);
      const composite = materials.composite.uniforms;
      const bloomStrengthNumber = hasBloom ? drawBloom() : 0;
      const sunRaysStrengthNumber = hasSunRays ? drawSunRays(camera) : 0;
      if (hasCornerShade) drawCornerShade(camera);
      composite.source.value = targets.scene.texture;
      composite.depth.value = targets.scene.depthTexture ?? null;
      composite.bloom.value = hasBloom ? targets.bloomUp[0]?.texture ?? targets.bloomDown[0].texture : null;
      composite.bloomStrengthNumber.value = bloomStrengthNumber;
      composite.sunRays.value = sunRaysStrengthNumber > 0 ? targets.sunRays.texture : null;
      composite.sunRaysColor.value.copy(hexToLinear(lighting.look.lightColor)).multiplyScalar(sunRaysStrengthNumber * SUN_RAYS_STRENGTH_NUMBER);
      composite.cornerShade.value = hasCornerShade ? targets.cornerShade.texture : null;
      if (hasCornerShade) composite.cornerShadeTexel.value.set(1 / targets.cornerShade.width, 1 / targets.cornerShade.height);
      composite.cameraProjectionInverse.value.copy(camera.projectionMatrixInverse);
      composite.cornerShadeShare.value = Math.min((values.cornerShadeStrengthPct / 100) * 0.9, 1);
      composite.gradingShare.value = hasGrading ? values.gradingStrengthPct / 100 : 0;
      const defines = {};
      if (hasBloom && targets.bloomDown.length) defines.HAS_BLOOM = "";
      if (sunRaysStrengthNumber > 0) defines.HAS_SUN_RAYS = "";
      if (hasCornerShade) defines.HAS_CORNER_SHADE = "";
      if (hasGrading) defines.HAS_GRADING = "";
      const definesKey = Object.keys(defines).join(",");
      if (definesKey !== Object.keys(materials.composite.defines).join(",")) {
        materials.composite.defines = defines;
        materials.composite.needsUpdate = true;
      }
      drawPass(materials.composite, outputTarget);
    },
    /** Takes the effects away and frees what they hold; renderer.render(scene, camera) draws the scene again. */
    dispose() {
      disposeTargets();
      quad.geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };

  applyGrade();
  updateLevels();
  return effects;
}
