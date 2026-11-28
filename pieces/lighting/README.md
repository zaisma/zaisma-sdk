# @zaisma/lighting

Lighting and sky for three.js. One call gives a scene a sky with a sun, a moon, stars and clouds, sunlight whose shadows follow the player, fill light, reflections and fog that all match the sky, set by the time of day. It fits what it draws to the device, so the same game looks finished on a phone and a gaming PC.

```
npx @zaisma/cli pieces add @zaisma/lighting
```

```js
import { createLighting } from "./pieces/@zaisma/lighting/index.js";

const lighting = createLighting({ scene, renderer, followTarget: player, settings: { timeOfDayHours: 17 } });
lighting.giveShadows(level); // every mesh in it casts and takes shadows

function frame() {
  lighting.update(camera); // before rendering
  renderer.render(scene, camera);
}

lighting.settings.set({ dayLengthMin: 20 }); // the sun crosses the sky in 20 minutes, while playing
lighting.hooks.on("nightStarted", () => lightTheTorches());
lighting.hooks.on("beforeLook", (look) => (isStorm ? { zenithColor: "#5b6069", fogColor: "#70757e", lightLux: 0.8 } : undefined));
```

A page with no bundler needs the import map `zaisma pieces add` prints, so the piece finds three.js.

## What it does

- **The time of day** sets everything: `timeOfDayHours` from 0 to 24 (the sun rises at 6, is highest at 12, sets at 18), or a named one: `lighting.settings.set(TIME_PRESETS.golden_hour)` (`dawn`, `morning`, `day`, `golden_hour`, `dusk`, `night`). `dayLengthMin` above 0 runs the day on its own. `sunPeakElevationDeg` and `sunPathTurnDeg` shape the sun's path and so which way shadows fall.
- **Night stays playable:** the moon takes over below the horizon, with a blue light that still casts shadows, and the light never shines from lower than 12 degrees (20 for the moon), so shadows stay on the ground.
- **Shadows follow the player** (`followTarget`, or the camera), over `shadowDistanceM` round them, holding still in whole texels so they never shimmer. Things cast and take them once passed to `giveShadows`, or with three's `castShadow` and `receiveShadow`.
- **Reflections:** standard and physical materials reflect the sky and are lit by it, remade as the day turns.
- **Fog** fades the world into the sky's colour, and the sky below the horizon is the fog's colour, so a world's edge is never a line. Toward a low sun it glows warm in the sun's colour (`fogSunGlowPct`), and `groundFogPct` pools a mist low over the ground, thinning upward over `groundFogHeightM` from `groundFogFloorM`. Both reach every material that takes fog, three's own and shader materials alike.
- **Effects for the camera** (bloom on bright things, colour grading, sun rays, soft shade in corners) are a piece of their own, [`@zaisma/lighting-effects`](../lighting-effects), that plugs into this one.
- **Quality:** `qualityLevel` `auto` starts at `medium` on phones and tablets and `high` elsewhere, and steps down a level each time frames run under 25 a second (`qualityChanged` says so). `low` draws no shadows, reflections or clouds.
- **The renderer** is set up by the piece: shadows at the quality level, tone mapping (`toneMapping`, `neutral` by default, which keeps the colours a game picks), `exposurePct` and the screen's colour space.

Every setting changes while playing (`lighting.settings.set`), `lighting.settings.list()` lists them, and `beforeLook` lets a game change any colour or strength of the sky and its light. `lighting.sky`, `sun`, `fill` and `fog` are three's own objects for anything else.

## For another engine

`sky.js` has no engine: `sunAt(timeOfDayHours, { peakElevationDeg, pathTurnDeg })` and `skyAt(...)` give the sun's and the moon's directions, the light's direction and every colour and strength as plain numbers. To draw the same sky:

- **The sun's path:** `dayAngle = (hours - 6) / 12 × π`; on a circle tilted toward +z by the peak elevation, `x = cos(dayAngle)`, `y = sin(dayAngle) × sin(peak)`, `z = sin(dayAngle) × cos(peak)`, then turned round +y by `pathTurnDeg`. +y is up. The moon is opposite the sun.
- **The look** blends between five keys by the sun's elevation (-14, -4, 2, 14 and 42 degrees), eased with smoothstep. Colours are as shown on screen (sRGB); convert to linear before lighting.
- **The sky:** horizon to zenith by `height^0.45`; a glow round the sun (`toSun^6 × 0.22 + toSun^48 × 0.35`, times the light's colour, fading as the sun sets); the sun's disc; clouds as four octaves of value noise on a flat layer (`direction.xz / (height + 0.08) × 1.6`); and the fog's colour below the horizon.
- **The fog** mixes toward its colour by distance (three's linear fog), plus ground fog: along a ray from the camera at height `h` in unit direction `d` over `t` metres, `amount = density × e^(−(h − floor) / height) × (1 − e^(−d.y × t / height)) / (d.y / height)`, hidden share `1 − e^(−amount)`, with `density = groundFogPct / 100 × 0.08` per metre. Its colour gains `lightColor × glow × max(d · sun, 0)^8`, where glow is `0.55 × fogSunGlowPct / 100`, full from the sun's rise to 8 degrees up and gone by 30.
- **The light** comes from `lightDirection` in `lightColor` at `lightLux` (three's directional light units); the fill is a hemisphere light from `fillSkyColor` above and `fillGroundColor` below at `fillLux`.

`index.d.ts` is the reference. How pieces work: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md). MIT licensed.
