// What the sky and its light look like at each time of day, as plain numbers with no engine: where the sun and
// the moon are, and every colour and strength. The lighting piece draws these with three.js; another engine reads
// the same values and draws the same sky (README.md, "For another engine").

/** Named times of day: lighting.settings.set(TIME_PRESETS.golden_hour). */
export const TIME_PRESETS = {
  dawn: { timeOfDayHours: 6.3 },
  morning: { timeOfDayHours: 9 },
  day: { timeOfDayHours: 13 },
  golden_hour: { timeOfDayHours: 17 },
  dusk: { timeOfDayHours: 18.4 },
  night: { timeOfDayHours: 23 },
};

/** Below this many degrees under the horizon the moon lights the scene in place of the sun. */
export const NIGHT_ELEVATION_DEG = -4;

/** The lowest the light shines from, in degrees above the horizon, however low the sun or the moon is drawn. */
export const MINIMUM_SUN_LIGHT_ELEVATION_DEG = 12;
export const MINIMUM_MOON_LIGHT_ELEVATION_DEG = 20;

// The sky at five heights of the sun, in degrees above the horizon; between them everything blends. Colours are
// [red, green, blue] from 0 to 1, as shown on screen. Strengths are in lux, as three.js's lights take them.
// Night stays readable: a game never goes black because the sun set.
const SKY_KEYS = [
  { elevationDeg: -14, zenith: [0.02, 0.03, 0.085], horizon: [0.07, 0.09, 0.18], fog: [0.06, 0.075, 0.15], sun: [0.62, 0.72, 1], lightLux: 0.55, fillSky: [0.3, 0.38, 0.62], fillGround: [0.08, 0.09, 0.13], fillLux: 1.5, cloud: [0.13, 0.15, 0.24], starsPct: 100 },
  { elevationDeg: -4, zenith: [0.07, 0.09, 0.22], horizon: [0.42, 0.3, 0.38], fog: [0.3, 0.24, 0.32], sun: [0.75, 0.62, 0.75], lightLux: 0.45, fillSky: [0.55, 0.5, 0.74], fillGround: [0.14, 0.12, 0.15], fillLux: 1.7, cloud: [0.4, 0.3, 0.38], starsPct: 45 },
  { elevationDeg: 2, zenith: [0.2, 0.27, 0.52], horizon: [0.98, 0.58, 0.36], fog: [0.82, 0.56, 0.44], sun: [1, 0.55, 0.3], lightLux: 2.2, fillSky: [0.6, 0.56, 0.68], fillGround: [0.26, 0.2, 0.18], fillLux: 2, cloud: [1, 0.66, 0.5], starsPct: 0 },
  { elevationDeg: 14, zenith: [0.22, 0.42, 0.8], horizon: [0.96, 0.82, 0.64], fog: [0.88, 0.8, 0.7], sun: [1, 0.85, 0.64], lightLux: 3, fillSky: [0.62, 0.72, 0.92], fillGround: [0.36, 0.31, 0.26], fillLux: 2.2, cloud: [1, 0.93, 0.84], starsPct: 0 },
  { elevationDeg: 42, zenith: [0.16, 0.42, 0.88], horizon: [0.68, 0.83, 0.97], fog: [0.72, 0.84, 0.96], sun: [1, 0.97, 0.9], lightLux: 3.1, fillSky: [0.64, 0.78, 1], fillGround: [0.4, 0.37, 0.32], fillLux: 2, cloud: [1, 1, 1], starsPct: 0 },
];

const mix = (from, to, blendPct) => from + ((to - from) * blendPct) / 100;
const mixColor = (from, to, blendPct) => from.map((channel, channelIndex) => mix(channel, to[channelIndex], blendPct));
const degToRad = (angleDeg) => (angleDeg * Math.PI) / 180;
const radToDeg = (angleRad) => (angleRad * 180) / Math.PI;

/** A time of day brought into 0 to 24: 25 is 1, -1 is 23. */
export function wrapHours(timeOfDayHours) {
  return ((timeOfDayHours % 24) + 24) % 24;
}

/**
 * The sun's place at a time of day: elevationDeg above the horizon (below it at night) and direction, a unit vector
 * from the scene toward the sun (+y up). With pathTurnDeg 0 it rises at +x (east) at 6, is highest toward +z at 12
 * (peakElevationDeg up) and sets at -x at 18; pathTurnDeg turns that whole path round the up axis, counterclockwise
 * seen from above.
 */
export function sunAt(timeOfDayHours, { peakElevationDeg = 62, pathTurnDeg = 0 } = {}) {
  const dayAngleRad = ((wrapHours(timeOfDayHours) - 6) / 12) * Math.PI;
  const peakRad = degToRad(peakElevationDeg);
  const turnRad = degToRad(pathTurnDeg);
  // On a circle tilted toward +z: x runs east to west, and the arc's height splits between y and z by the peak.
  const pathX = Math.cos(dayAngleRad);
  const pathY = Math.sin(dayAngleRad) * Math.sin(peakRad);
  const pathZ = Math.sin(dayAngleRad) * Math.cos(peakRad);
  const direction = [pathX * Math.cos(turnRad) + pathZ * Math.sin(turnRad), pathY, -pathX * Math.sin(turnRad) + pathZ * Math.cos(turnRad)];
  return { elevationDeg: radToDeg(Math.asin(Math.max(-1, Math.min(1, pathY)))), direction };
}

/**
 * Every colour and strength of the sky and its light at a time of day (0 to 24): the sky's zenith and horizon
 * colours, the fog's (which is also the sky under the horizon, so the world's edge melts into it), the light's colour
 * and strength in lux (the sun by day, the moon by night), the fill light's sky and ground colours and strength, the
 * clouds' lit colour and how bright the stars are. lightDirection points toward whichever light is shining, never
 * lower than its minimum elevation, so shadows always fall on the ground.
 */
export function skyAt(timeOfDayHours, sunPath = {}) {
  const sun = sunAt(timeOfDayHours, sunPath);
  const elevationDeg = sun.elevationDeg;
  const last = SKY_KEYS[SKY_KEYS.length - 1];
  let look;
  if (elevationDeg <= SKY_KEYS[0].elevationDeg) look = SKY_KEYS[0];
  else if (elevationDeg >= last.elevationDeg) look = last;
  else {
    const upperIndex = SKY_KEYS.findIndex((key) => key.elevationDeg > elevationDeg);
    const lower = SKY_KEYS[upperIndex - 1];
    const upper = SKY_KEYS[upperIndex];
    // Smoothstep between keys, so colours ease in and out instead of turning at each key.
    const linearPct = ((elevationDeg - lower.elevationDeg) / (upper.elevationDeg - lower.elevationDeg)) * 100;
    const blendPct = (linearPct * linearPct * (300 - 2 * linearPct)) / 10000;
    look = { lightLux: mix(lower.lightLux, upper.lightLux, blendPct), fillLux: mix(lower.fillLux, upper.fillLux, blendPct), starsPct: mix(lower.starsPct, upper.starsPct, blendPct) };
    for (const field of ["zenith", "horizon", "fog", "sun", "fillSky", "fillGround", "cloud"]) look[field] = mixColor(lower[field], upper[field], blendPct);
  }
  const isNight = elevationDeg < NIGHT_ELEVATION_DEG;
  const [sunX, sunY, sunZ] = sun.direction;
  const moonDirection = [-sunX, -sunY, -sunZ];
  // The light never sits low enough to wash the ground out or run shadows to the horizon: at night it's the moon, kept
  // at least 20 degrees up; at sunrise and sunset the sun's light is kept 12 degrees up while its disc sets.
  const [shiningX, shiningY, shiningZ] = isNight ? moonDirection : sun.direction;
  const headingRad = Math.atan2(shiningZ, shiningX);
  const lightElevationRad = Math.max(Math.asin(Math.max(-1, Math.min(1, shiningY))), degToRad(isNight ? MINIMUM_MOON_LIGHT_ELEVATION_DEG : MINIMUM_SUN_LIGHT_ELEVATION_DEG));
  const lightDirection = [Math.cos(headingRad) * Math.cos(lightElevationRad), Math.sin(lightElevationRad), Math.sin(headingRad) * Math.cos(lightElevationRad)];
  return {
    sunElevationDeg: elevationDeg,
    sunDirection: sun.direction,
    moonDirection,
    lightDirection,
    isNight,
    zenithColor: look.zenith,
    horizonColor: look.horizon,
    fogColor: look.fog,
    lightColor: look.sun,
    lightLux: look.lightLux,
    fillSkyColor: look.fillSky,
    fillGroundColor: look.fillGround,
    fillLux: look.fillLux,
    cloudColor: look.cloud,
    starsPct: look.starsPct,
  };
}
