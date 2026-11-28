// @zaisma/lighting: lighting and sky for three.js. One call gives a scene a sky with a sun, a moon, stars and
// clouds, sunlight whose shadows follow the player, fill light, reflections and fog that all match the sky, set by
// the time of day, and fits what it draws to the device. The reference is index.d.ts; the sky's numbers are in
// sky.js with no engine, so another engine can draw the same sky. MIT licensed.

import * as THREE from "three";
import { PieceError, openPiece } from "../piece/index.js";
import statement from "./piece.json.js";
import { MINIMUM_MOON_LIGHT_ELEVATION_DEG, MINIMUM_SUN_LIGHT_ELEVATION_DEG, NIGHT_ELEVATION_DEG, TIME_PRESETS, skyAt, sunAt, wrapHours } from "./sky.js";

export { MINIMUM_MOON_LIGHT_ELEVATION_DEG, MINIMUM_SUN_LIGHT_ELEVATION_DEG, NIGHT_ELEVATION_DEG, TIME_PRESETS, skyAt, sunAt, wrapHours };

/** What each quality level draws. */
export const QUALITY_LEVELS = {
  low: { shadowMapSizePx: 0, hasSoftShadows: false, hasReflections: false, hasClouds: false },
  medium: { shadowMapSizePx: 1024, hasSoftShadows: false, hasReflections: true, hasClouds: true },
  high: { shadowMapSizePx: 2048, hasSoftShadows: true, hasReflections: true, hasClouds: true },
};

/** The fields of a look, as before_look gets and answers it. */
export const LOOK_COLOR_FIELDS = ["zenithColor", "horizonColor", "fogColor", "lightColor", "fillSkyColor", "fillGroundColor", "cloudColor"];
export const LOOK_NUMBER_FIELDS = { lightLux: 20, fillLux: 20, starsPct: 100 };

const QUALITY_ORDER = ["low", "medium", "high"];
const GIVEN_FIELDS = ["settings", "hooks", "scene", "renderer", "followTarget"];
const TONE_MAPPINGS = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, none: THREE.NoToneMapping };
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
// auto steps down a level when frames average slower than this for SLOW_FRAME_WINDOW_COUNT frames: under 25 a
// second is slow on any device, and a game that caps itself at 30 stays above it.
const SLOW_FRAME_DURATION_MS = 40;
const SLOW_FRAME_WINDOW_COUNT = 90;
// A gap longer than this is a hidden tab or a pause, not a slow frame.
const MAXIMUM_COUNTED_FRAME_DURATION_MS = 250;
// Reflections are made again once the look moves this far, so a turning day costs one small render now and then.
const REFLECTION_REMAKE_HOURS = 0.2;
const MS_PER_MIN = 60_000;
// How strong the fill is in the hemisphere light (every material) and in the sky's reflections (standard and physical
// materials only) when reflections are on: the hemisphere stays whole so Lambert and toon materials look the same with
// reflections on or off, and the reflections add a little, mostly seen on shiny and metal surfaces.
const FILL_SHARE_WITH_REFLECTIONS = { hemispherePct: 100, reflectionPct: 30 };
// Ground fog's thickness at its floor at ground_fog_pct 100, per metre of view: 50 m across the floor is nearly white.
const GROUND_FOG_DENSITY_PER_M = 0.08;
// The fog's glow toward the sun: how much of the light's colour it adds, looking straight at a low sun.
const FOG_SUN_GLOW_NUMBER = 0.55;

// Fog that glows toward a low sun and pools low. three's own fog code is widened once, when this file is imported
// (before a game's first material is built), so every material that takes fog takes both, shader materials too.
// Its three values are shared by every material: each lighting writes its own into them as its sky is drawn.
// With both at zero the fog is exactly three's own.
const FOG_GLOW_COLOR = new Float32Array(3);
const FOG_GLOW_DIRECTION = new Float32Array([0, 1, 0]);
// [density per metre, 1 / height in metres, floor height in metres]; density 0 is no ground fog.
const GROUND_FOG = new Float32Array([0, 1, 0]);
const FOG_UNIFORMS = { fogGlowColor: { value: FOG_GLOW_COLOR }, fogGlowDirection: { value: FOG_GLOW_DIRECTION }, groundFog: { value: GROUND_FOG } };

// Where the view meets the ground fog: how much of it lies between the camera and a point, as a share hidden. The
// same in the fog code and the sky: thickest at the floor, thinning by e each height up, summed along the ray.
const GROUND_FOG_GLSL = `
float zaismaGroundFogAmount(vec3 rayDirection, float rayLengthM) {
  if (groundFog.x <= 0.0) return 0.0;
  float aboveFloor = clamp((cameraPosition.y - groundFog.z) * groundFog.y, -20.0, 80.0);
  float climbPerM = rayDirection.y * groundFog.y;
  float climb = clamp(climbPerM * rayLengthM, -60.0, 60.0);
  float alongM = abs(climb) < 1e-4 ? rayLengthM : (1.0 - exp(-climb)) / climbPerM;
  return 1.0 - exp(-groundFog.x * exp(-aboveFloor) * alongM);
}
vec3 zaismaFogShade(vec3 baseColor, vec3 rayDirection) {
  return baseColor + fogGlowColor * pow(max(dot(rayDirection, fogGlowDirection), 0.0), 8.0);
}`;

function widenFog() {
  if (THREE.ShaderChunk.fog_fragment.includes("zaismaFogShade")) return;
  THREE.ShaderChunk.fog_pars_vertex = THREE.ShaderChunk.fog_pars_vertex.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying vec3 vFogOffset;");
  // From the camera to the point, in world space: the view's turn undone (a rotation's inverse is its transpose).
  THREE.ShaderChunk.fog_vertex = THREE.ShaderChunk.fog_vertex.replace("vFogDepth = - mvPosition.z;", "vFogDepth = - mvPosition.z;\n\tvFogOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;");
  THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace("varying float vFogDepth;", `varying float vFogDepth;\n\tvarying vec3 vFogOffset;\n\tuniform vec3 fogGlowColor;\n\tuniform vec3 fogGlowDirection;\n\tuniform vec3 groundFog;\n${GROUND_FOG_GLSL}`);
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
    "gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );",
    "vec3 fogRayDirection = normalize( vFogOffset );\n\tfogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - zaismaGroundFogAmount( fogRayDirection, length( vFogOffset ) ) );\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, zaismaFogShade( fogColor, fogRayDirection ), fogFactor );",
  );
  // Built-in materials copy their uniforms from three's lists when built, keeping these arrays themselves (only
  // three's own objects are cloned), so one write reaches every material.
  for (const shader of Object.values(THREE.ShaderLib)) if (shader.uniforms?.fogColor) Object.assign(shader.uniforms, FOG_UNIFORMS);
  Object.assign(THREE.UniformsLib.fog, FOG_UNIFORMS);
}
widenFog();

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  // Only the camera's turn moves the sky, never its place, and it's drawn at the far end of the depth range: it sits
  // behind everything at any distance, whatever the camera's near and far.
  vec4 placed = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = placed.xyww;
  gl_Position.z = placed.w * 0.99999;
}`;

const SKY_FRAGMENT = `
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 fogColor;
uniform vec3 lightColor;
uniform vec3 cloudColor;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform float sunDiscPct;
uniform float starsPct;
uniform float cloudsPct;
uniform float cloudDriftM;
uniform vec3 fogGlowColor;
uniform vec3 fogGlowDirection;
uniform vec3 groundFog;
varying vec3 vDirection;
${GROUND_FOG_GLSL}

float hash3(vec3 cell) {
  cell = fract(cell * 0.3183099 + 0.1);
  cell *= 17.0;
  return fract(cell.x * cell.y * cell.z * (cell.x + cell.y + cell.z));
}
float hash2(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 spot) {
  vec2 cell = floor(spot);
  vec2 part = fract(spot);
  vec2 ease = part * part * (3.0 - 2.0 * part);
  return mix(mix(hash2(cell), hash2(cell + vec2(1.0, 0.0)), ease.x), mix(hash2(cell + vec2(0.0, 1.0)), hash2(cell + vec2(1.0, 1.0)), ease.x), ease.y);
}

void main() {
  vec3 direction = normalize(vDirection);
  float height = direction.y;
  float up = clamp(height, 0.0, 1.0);
  vec3 color = mix(horizonColor, zenithColor, pow(up, 0.45));

  // The glow round the sun, wide and low, warming the horizon on its side.
  float toSun = max(dot(direction, sunDirection), 0.0);
  float sunUp = smoothstep(-0.12, 0.05, sunDirection.y);
  color += lightColor * (pow(toSun, 6.0) * 0.22 + pow(toSun, 48.0) * 0.35) * sunUp;

  #ifdef HAS_STARS
  if (starsPct > 0.0) {
    vec3 spot = direction * 260.0;
    vec3 cell = floor(spot);
    float chance = hash3(cell);
    if (chance > 0.985) {
      vec3 centre = cell + 0.5 + (vec3(hash3(cell + 7.1), hash3(cell + 3.7), hash3(cell + 9.3)) - 0.5) * 0.6;
      float star = smoothstep(0.32, 0.0, length(spot - centre)) * (chance - 0.985) / 0.015;
      color += vec3(0.85, 0.9, 1.0) * star * 1.6 * starsPct * smoothstep(0.0, 0.25, height);
    }
    float toMoon = max(dot(direction, moonDirection), 0.0);
    float moonUp = smoothstep(-0.05, 0.05, moonDirection.y) * starsPct;
    color += vec3(0.85, 0.88, 0.95) * (smoothstep(0.99955, 0.9997, toMoon) * 1.3 + pow(toMoon, 220.0) * 0.12) * moonUp;
  }
  #endif

  // The sun's disc, hidden behind thick clouds below.
  float disc = smoothstep(0.99965, 0.9998, toSun) * sunDiscPct * smoothstep(-0.02, 0.02, height);

  #ifdef HAS_CLOUDS
  if (cloudsPct > 0.0 && height > 0.0) {
    // Clouds on a flat layer far overhead, read where the view meets it, thinning toward the horizon.
    vec2 layer = direction.xz / (height + 0.08) * 1.6 + vec2(cloudDriftM, cloudDriftM * 0.37);
    float shape = noise2(layer) * 0.5 + noise2(layer * 2.03 + 11.0) * 0.25 + noise2(layer * 4.01 + 23.0) * 0.125 + noise2(layer * 8.05 + 37.0) * 0.0625;
    float cover = cloudsPct * 0.01;
    float cloud = smoothstep(1.0 - cover * 0.95 - 0.12, 1.0 - cover * 0.95 + 0.2, shape / 0.9375) * smoothstep(0.0, 0.18, height);
    float thick = smoothstep(0.4, 1.0, shape);
    vec3 lit = cloudColor * (0.82 + 0.35 * pow(toSun, 4.0) * sunUp);
    vec3 shade = mix(lit, mix(horizonColor, zenithColor, 0.5) * 0.85, thick * 0.55);
    color = mix(color, shade, cloud * 0.92);
    disc *= 1.0 - cloud * 0.9;
  }
  #endif

  color += lightColor * disc * 6.0;
  // Under the horizon the sky is the fog's colour, glowing toward a low sun as the fog does, so the world's edge
  // melts into it; ground fog thickens toward the horizon as it does over the ground.
  vec3 edgeFog = zaismaFogShade(fogColor, direction);
  color = mix(color, edgeFog, smoothstep(0.02, -0.06, height));
  color = mix(color, edgeFog, zaismaGroundFogAmount(direction, 100000.0));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const shadowMapKindOf = (quality) => (quality.hasSoftShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap);
// How wide one texel of the shadow map is on the ground, in metres.
const texelSizeM = (reachM, shadowMapSizePx) => (reachM * 2) / shadowMapSizePx;
const rgbToHex = (rgb) => `#${rgb.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0")).join("")}`;

/**
 * Whether this device is a phone or a tablet, from what the browser says of its pointer: a touch screen with no
 * mouse. Answers false where there is no window (a test, a server).
 */
export function isTouchDevice() {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

/** The quality level auto starts at on this device: medium on phones and tablets, high elsewhere. */
export function startingQualityLevel() {
  return isTouchDevice() ? "medium" : "high";
}

/**
 * Lights a scene. Give it the scene and the renderer; call lighting.update(camera) every frame before rendering.
 */
export function createLighting(given = {}) {
  const { settings, hooks, tell, ask, refuse } = openPiece(statement, { settings: given.settings, hooks: given.hooks });
  for (const field of Object.keys(given)) {
    if (!GIVEN_FIELDS.includes(field)) refuse("unknown_argument", { message: `createLighting has no argument "${field}".`, field, fix: `Give only: ${GIVEN_FIELDS.join(", ")}. A setting goes inside settings.` });
  }
  const { scene, renderer } = given;
  if (!(scene instanceof THREE.Scene)) refuse("scene_needed", { message: "createLighting needs the three.js scene to light.", field: "scene", fix: "Give createLighting({ scene, renderer }), with scene a THREE.Scene." });
  if (!renderer || typeof renderer.render !== "function" || !renderer.shadowMap) refuse("renderer_needed", { message: "createLighting needs the three.js renderer that draws the scene.", field: "renderer", fix: "Give createLighting({ scene, renderer }), with renderer a THREE.WebGLRenderer." });
  checkFollowTarget(given.followTarget ?? null);

  const skyUniforms = {
    zenithColor: { value: new THREE.Color() },
    horizonColor: { value: new THREE.Color() },
    fogColor: { value: new THREE.Color() },
    lightColor: { value: new THREE.Color() },
    cloudColor: { value: new THREE.Color() },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    moonDirection: { value: new THREE.Vector3(0, -1, 0) },
    sunDiscPct: { value: 1 },
    starsPct: { value: 0 },
    cloudsPct: { value: 0 },
    cloudDriftM: { value: 0 },
    // This lighting's own fog glow and ground fog, written into every material's as its sky is drawn.
    fogGlowColor: { value: new Float32Array(3) },
    fogGlowDirection: { value: new Float32Array([0, 1, 0]) },
    groundFog: { value: new Float32Array([0, 1, 0]) },
  };
  const skyMaterial = new THREE.ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false });
  const skyGeometry = new THREE.SphereGeometry(1, 48, 24);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = "zaisma_sky";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  // The sky is drawn first, so the scene's materials take this lighting's fog: two lightings on one page each keep theirs.
  sky.onBeforeRender = shareFog;
  const sun = new THREE.DirectionalLight();
  sun.name = "zaisma_sun";
  const fill = new THREE.HemisphereLight();
  fill.name = "zaisma_fill";
  const fog = new THREE.Fog(0xffffff, 1, 2);
  scene.add(sky, sun, sun.target, fill);

  // Reflections: the sky without its sun disc (the sun's own light already shines), drawn into an environment map.
  const reflectionScene = new THREE.Scene();
  const reflectionMaterial = skyMaterial.clone();
  reflectionMaterial.uniforms = { ...skyUniforms, sunDiscPct: { value: 0 }, starsPct: { value: 0 } };
  reflectionScene.add(new THREE.Mesh(skyGeometry, reflectionMaterial));
  let reflectionMaker = null;
  let reflectionTarget = null;
  let reflectionMadeAtHours = null;

  let followTarget = given.followTarget ?? null;
  let qualityLevel = settings.get("qualityLevel") === "auto" ? startingQualityLevel() : settings.get("qualityLevel");
  let look = null;
  let isNight = null;
  let lastFrameMs = null;
  let frameDurationTotalMs = 0;
  let frameCount = 0;
  let cloudDriftM = 0;
  let isApplyingOwnTime = false;
  const lightDirection = new THREE.Vector3(0, 1, 0);

  function shareFog() {
    FOG_GLOW_COLOR.set(skyUniforms.fogGlowColor.value);
    FOG_GLOW_DIRECTION.set(skyUniforms.fogGlowDirection.value);
    GROUND_FOG.set(skyUniforms.groundFog.value);
  }

  // The fog's glow toward the sun: strongest while it's low (from just under the horizon to 8 degrees up), gone by
  // 30 degrees and at night, in the light's colour.
  function applyFogGlow(sunElevationDeg, sunDirection) {
    const risenPct = Math.min(Math.max((sunElevationDeg + 6) / 6, 0), 1);
    const highPct = Math.min(Math.max((sunElevationDeg - 8) / 22, 0), 1);
    const glowNumber = risenPct * (1 - highPct * highPct * (3 - 2 * highPct)) * FOG_SUN_GLOW_NUMBER * (settings.get("fogSunGlowPct") / 100);
    const glowColor = new THREE.Color(look.lightColor).multiplyScalar(glowNumber);
    skyUniforms.fogGlowColor.value.set([glowColor.r, glowColor.g, glowColor.b]);
    skyUniforms.fogGlowDirection.value.set(sunDirection);
    const groundFogPct = settings.get("groundFogPct");
    skyUniforms.groundFog.value.set([(groundFogPct / 100) * GROUND_FOG_DENSITY_PER_M, 1 / settings.get("groundFogHeightM"), settings.get("groundFogFloorM")]);
    shareFog();
  }

  function checkFollowTarget(target) {
    if (target !== null && !(target instanceof THREE.Object3D)) refuse("bad_follow_target", { message: "followTarget isn't a three.js object.", field: "followTarget", fix: "Give the player's character (any THREE.Object3D), or null to follow the camera." });
  }

  // What's wrong with a look before_look answered, as a PieceError, or null when it's a look.
  function lookProblem(answered) {
    const problem = (message, fix) => new PieceError(statement.name, "bad_look", { message, field: "beforeLook", fix });
    if (!answered || typeof answered !== "object") return problem("before_look answered something that isn't a look.", "Answer the look it was given with any fields changed, or nothing.");
    for (const field of Object.keys(answered)) {
      if (LOOK_COLOR_FIELDS.includes(field)) {
        if (typeof answered[field] !== "string" || !HEX_COLOR_PATTERN.test(answered[field].toLowerCase())) return problem(`before_look answered ${field} as ${JSON.stringify(answered[field])}, which isn't a colour.`, `Answer ${field} as six hex digits, like "#3fa9f5".`);
      } else if (field in LOOK_NUMBER_FIELDS) {
        const maximum = LOOK_NUMBER_FIELDS[field];
        if (typeof answered[field] !== "number" || !(answered[field] >= 0 && answered[field] <= maximum)) return problem(`before_look answered ${field} as ${JSON.stringify(answered[field])}.`, `Answer ${field} as a number from 0 to ${maximum}.`);
      } else {
        return problem(`A look has no "${field}".`, `A look has: ${[...LOOK_COLOR_FIELDS, ...Object.keys(LOOK_NUMBER_FIELDS)].join(", ")}.`);
      }
    }
    return null;
  }

  // Works out the look for the time of day, lets the game change it, and puts it on the sky, the lights and the fog.
  // While the day runs on its own the reflections wait until the look has moved; any other change remakes them.
  function applyLook({ isFromTimeFlow = false } = {}) {
    const values = settings.values;
    const worked = skyAt(values.timeOfDayHours, { peakElevationDeg: values.sunPeakElevationDeg, pathTurnDeg: values.sunPathTurnDeg });
    const proposed = { lightLux: worked.lightLux, fillLux: worked.fillLux, starsPct: worked.starsPct };
    for (const field of LOOK_COLOR_FIELDS) proposed[field] = rgbToHex(worked[field]);
    const answered = ask("beforeLook", { ...proposed }, { timeOfDayHours: values.timeOfDayHours, isNight: worked.isNight });
    // A look that isn't one is skipped with a logged error, like a handler that throws: the game never stops over it.
    const problem = lookProblem(answered);
    if (problem) console.error(`${statement.name}: before_look's answer was skipped.`, problem);
    look = problem ? { ...proposed } : { ...proposed, ...answered };
    for (const field of LOOK_COLOR_FIELDS) if (typeof look[field] === "string") look[field] = look[field].toLowerCase();

    skyUniforms.zenithColor.value.set(look.zenithColor);
    skyUniforms.horizonColor.value.set(look.horizonColor);
    skyUniforms.fogColor.value.set(look.fogColor);
    skyUniforms.lightColor.value.set(look.lightColor);
    skyUniforms.cloudColor.value.set(look.cloudColor);
    skyUniforms.sunDirection.value.fromArray(worked.sunDirection);
    skyUniforms.moonDirection.value.fromArray(worked.moonDirection);
    skyUniforms.starsPct.value = values.starsEnabled ? look.starsPct / 100 : 0;
    skyUniforms.cloudsPct.value = values.cloudsPct;
    lightDirection.fromArray(worked.lightDirection);

    sun.color.set(look.lightColor);
    sun.intensity = (look.lightLux * values.lightStrengthPct) / 100;
    fill.color.set(look.fillSkyColor);
    fill.groundColor.set(look.fillGroundColor);
    fog.color.set(look.fogColor);
    // Ground fog needs the scene's fog in place: with fog_enabled off, the fog by distance never starts.
    fog.near = values.fogEnabled ? Math.min(values.fogStartM, values.fogEndM - 0.5) : 1e9;
    fog.far = values.fogEnabled ? values.fogEndM : 2e9;
    applyFogGlow(worked.sunElevationDeg, worked.sunDirection);
    if (values.fogEnabled || values.groundFogPct > 0) scene.fog = fog;
    else if (scene.fog === fog) scene.fog = null;
    applyFillStrength();

    if (isNight !== null && isNight !== worked.isNight) tell(worked.isNight ? "nightStarted" : "dayStarted", values.timeOfDayHours);
    isNight = worked.isNight;
    // Remade when the look moved, measured round the clock: 23.9 is 0.2 hours from 0.1.
    const reflectionAgeHours = reflectionMadeAtHours === null ? null : Math.abs(values.timeOfDayHours - reflectionMadeAtHours);
    if (reflectionAgeHours === null || Math.min(reflectionAgeHours, 24 - reflectionAgeHours) >= REFLECTION_REMAKE_HOURS || !isFromTimeFlow) remakeReflections();
  }

  function hasReflections() {
    return QUALITY_LEVELS[qualityLevel].hasReflections && settings.get("reflectionsEnabled");
  }

  function applyFillStrength() {
    const fillLux = (look.fillLux * settings.get("fillStrengthPct")) / 100;
    const isReflecting = hasReflections() && reflectionTarget !== null;
    fill.intensity = (fillLux * (isReflecting ? FILL_SHARE_WITH_REFLECTIONS.hemispherePct : 100)) / 100;
    if (isReflecting && scene.environment === reflectionTarget.texture) scene.environmentIntensity = (fillLux * FILL_SHARE_WITH_REFLECTIONS.reflectionPct) / 100;
  }

  function remakeReflections() {
    if (!hasReflections()) {
      if (scene.environment === reflectionTarget?.texture) scene.environment = null;
      reflectionTarget?.dispose();
      reflectionTarget = null;
      reflectionMadeAtHours = null;
      if (look) applyFillStrength();
      return;
    }
    reflectionMaker ??= new THREE.PMREMGenerator(renderer);
    reflectionMaterial.defines = skyMaterial.defines.HAS_CLOUDS === undefined ? {} : { HAS_CLOUDS: "" };
    reflectionMaterial.needsUpdate = true;
    const made = reflectionMaker.fromScene(reflectionScene, 0, 0.1, 10);
    if (scene.environment === reflectionTarget?.texture || scene.environment === null) scene.environment = made.texture;
    reflectionTarget?.dispose();
    reflectionTarget = made;
    reflectionMadeAtHours = settings.get("timeOfDayHours");
    applyFillStrength();
  }

  // Puts the quality level and the renderer settings in place: shadows, the sky's parts, tone mapping and exposure.
  function applyQuality() {
    const quality = QUALITY_LEVELS[qualityLevel];
    const shadowMapSizePx = settings.get("shadowsEnabled") ? quality.shadowMapSizePx : 0;
    const hadShadows = renderer.shadowMap.enabled;
    const isRecompileNeeded = hadShadows !== shadowMapSizePx > 0 || (shadowMapSizePx > 0 && renderer.shadowMap.type !== shadowMapKindOf(quality)) || renderer.toneMapping !== TONE_MAPPINGS[settings.get("toneMapping")];
    renderer.shadowMap.enabled = shadowMapSizePx > 0;
    renderer.shadowMap.type = shadowMapKindOf(quality);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = TONE_MAPPINGS[settings.get("toneMapping")];
    renderer.toneMappingExposure = settings.get("exposurePct") / 100;
    sun.castShadow = shadowMapSizePx > 0;
    if (sun.castShadow && sun.shadow.mapSize.x !== shadowMapSizePx) {
      sun.shadow.mapSize.set(shadowMapSizePx, shadowMapSizePx);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    const reachM = settings.get("shadowDistanceM");
    Object.assign(sun.shadow.camera, { left: -reachM, right: reachM, top: reachM, bottom: -reachM, near: 0.5, far: reachM * 6 });
    sun.shadow.camera.updateProjectionMatrix();
    // Bias grows with the texel's size, so near shadows don't streak and far ones don't float.
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = texelSizeM(reachM, Math.max(shadowMapSizePx, 1)) * 1.2;
    sun.shadow.radius = quality.hasSoftShadows ? 3 : 1;
    const defines = {};
    if (quality.hasClouds) defines.HAS_CLOUDS = "";
    defines.HAS_STARS = "";
    skyMaterial.defines = defines;
    skyMaterial.needsUpdate = true;
    // Materials drawn before shadows turned on or off, or before the tone mapping changed, are built again.
    if (isRecompileNeeded) {
      scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of materials) material.needsUpdate = true;
      });
    }
    if (look) remakeReflections();
  }

  function changeQuality(nextLevel, reason) {
    if (nextLevel === qualityLevel) return;
    qualityLevel = nextLevel;
    frameDurationTotalMs = 0;
    frameCount = 0;
    applyQuality();
    tell("qualityChanged", { qualityLevel, reason });
  }

  settings.onChange((change) => {
    if (change.name === "qualityLevel") {
      changeQuality(change.newValue === "auto" ? startingQualityLevel() : change.newValue, "setting");
      return;
    }
    if (["shadowsEnabled", "shadowDistanceM", "toneMapping", "exposurePct", "reflectionsEnabled"].includes(change.name)) applyQuality();
    if (change.name === "timeOfDayHours" && isApplyingOwnTime) return;
    if (change.name !== "dayLengthMin") applyLook();
  });

  // The shadow box follows the target in whole texels of the shadow map, seen from the light, so shadows hold still
  // instead of shimmering as the player moves.
  const followSpot = new THREE.Vector3();
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  function placeShadow(camera) {
    (followTarget ?? camera).getWorldPosition(followSpot);
    const reachM = settings.get("shadowDistanceM");
    if (sun.castShadow) {
      const texelM = texelSizeM(reachM, sun.shadow.mapSize.x);
      lightRight.crossVectors(worldUp, lightDirection);
      if (lightRight.lengthSq() < 1e-6) lightRight.set(1, 0, 0);
      lightRight.normalize();
      lightUp.crossVectors(lightDirection, lightRight).normalize();
      const alongM = followSpot.dot(lightDirection);
      const rightM = Math.round(followSpot.dot(lightRight) / texelM) * texelM;
      const upM = Math.round(followSpot.dot(lightUp) / texelM) * texelM;
      followSpot.copy(lightDirection).multiplyScalar(alongM).addScaledVector(lightRight, rightM).addScaledVector(lightUp, upM);
    }
    sun.target.position.copy(followSpot);
    sun.position.copy(followSpot).addScaledVector(lightDirection, reachM * 3);
    sun.target.updateMatrixWorld();
  }

  function countFrame(nowMs) {
    if (lastFrameMs !== null) {
      const durationMs = nowMs - lastFrameMs;
      if (durationMs > 0 && durationMs < MAXIMUM_COUNTED_FRAME_DURATION_MS) {
        frameDurationTotalMs += durationMs;
        frameCount += 1;
      }
    }
    lastFrameMs = nowMs;
    if (frameCount < SLOW_FRAME_WINDOW_COUNT) return;
    const averageMs = frameDurationTotalMs / frameCount;
    frameDurationTotalMs = 0;
    frameCount = 0;
    if (settings.get("qualityLevel") === "auto" && averageMs > SLOW_FRAME_DURATION_MS && qualityLevel !== "low") changeQuality(QUALITY_ORDER[QUALITY_ORDER.indexOf(qualityLevel) - 1], "slow_frames");
  }

  const lighting = {
    settings,
    hooks,
    /** three's own objects, for anything the settings don't reach. */
    sky,
    sun,
    fill,
    fog,
    /** A unit vector from the scene toward the light that's shining: the sun, or the moon at night. */
    lightDirection,
    /** The quality level in use, with auto worked out: low, medium or high. */
    get qualityLevel() {
      return qualityLevel;
    },
    /** Whether the moon lights the scene now. */
    get isNight() {
      return isNight;
    },
    /** The look in use, after before_look: every colour as "#rrggbb" and every strength. A copy. */
    get look() {
      return { ...look };
    },
    /** Every frame, before rendering: moves the time of day, keeps the shadows round the followed target, and watches how fast frames run. */
    update(camera, nowMs = typeof performance === "object" ? performance.now() : Date.now()) {
      if (!(camera instanceof THREE.Camera)) refuse("camera_needed", { message: "update needs the camera the scene is drawn from.", field: "camera", fix: "Call lighting.update(camera) every frame, before renderer.render(scene, camera)." });
      const elapsedMs = lastFrameMs === null ? 0 : Math.min(Math.max(nowMs - lastFrameMs, 0), MAXIMUM_COUNTED_FRAME_DURATION_MS);
      countFrame(nowMs);
      const dayLengthMin = settings.get("dayLengthMin");
      if (dayLengthMin > 0 && elapsedMs > 0) {
        isApplyingOwnTime = true;
        try {
          settings.set({ timeOfDayHours: wrapHours(settings.get("timeOfDayHours") + (elapsedMs / (dayLengthMin * MS_PER_MIN)) * 24) });
        } finally {
          isApplyingOwnTime = false;
        }
        applyLook({ isFromTimeFlow: true });
      }
      cloudDriftM += (elapsedMs / 1000) * 0.004;
      skyUniforms.cloudDriftM.value = cloudDriftM;
      placeShadow(camera);
    },
    /** Moves the shadows to follow another object, or the camera with null. */
    follow(target) {
      checkFollowTarget(target);
      followTarget = target;
    },
    /** Lets every mesh in an object cast shadows and take them (the ground, buildings, characters). Answers how many meshes. */
    giveShadows(object, { isCasting = true, isReceiving = true } = {}) {
      if (!(object instanceof THREE.Object3D)) refuse("bad_object", { message: "giveShadows takes a three.js object.", field: "object", fix: "Pass the scene, a group or a mesh." });
      let meshCount = 0;
      object.traverse((child) => {
        if (!child.isMesh || child === sky) return;
        child.castShadow = isCasting;
        child.receiveShadow = isReceiving;
        meshCount += 1;
      });
      return meshCount;
    },
    /** Takes the lighting out of the scene and frees what it holds. */
    dispose() {
      scene.remove(sky, sun, sun.target, fill);
      if (scene.fog === fog) scene.fog = null;
      if (scene.environment === reflectionTarget?.texture) scene.environment = null;
      skyGeometry.dispose();
      skyMaterial.dispose();
      reflectionMaterial.dispose();
      reflectionTarget?.dispose();
      reflectionMaker?.dispose();
      sun.shadow.map?.dispose();
    },
  };

  applyQuality();
  applyLook();
  return lighting;
}
