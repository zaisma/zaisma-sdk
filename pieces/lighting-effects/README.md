# @zaisma/lighting-effects

Camera effects for [`@zaisma/lighting`](../lighting): bloom on bright things, colour grading with named moods, sun rays, and soft shade in corners. Each is off until a game turns it on, each has its own level per device, and the `auto` levels step down with the lighting when frames run slow, so a phone keeps its frame rate.

```
npx @zaisma/cli pieces add @zaisma/lighting-effects
```

It brings the lighting with it when the game doesn't have it.

```js
import { createLighting } from "./pieces/@zaisma/lighting/index.js";
import { createLightingEffects } from "./pieces/@zaisma/lighting-effects/index.js";

const lighting = createLighting({ scene, renderer, followTarget: player });
const effects = createLightingEffects({
  lighting,
  scene,
  renderer,
  settings: { bloomLevel: "auto", sunRaysLevel: "auto", cornerShadeLevel: "auto", gradingMood: "warm" },
});

function frame() {
  lighting.update(camera);
  effects.render(camera); // in place of renderer.render(scene, camera)
}

effects.settings.set({ gradingMood: "noir" }); // a flashback, while playing
```

## The effects

| Effect | Setting | What it does | `auto` draws it |
| --- | --- | --- | --- |
| Bloom | `bloomLevel`, `bloomStrengthPct`, `bloomThresholdPct`, `bloomSpreadPct` | A soft glow round anything lit past white: the sun, lamps, fire, a sword's edge. Give a thing an emissive colour above 1 to make it shine. | At the lighting's quality in use, medium or high; not at low. |
| Colour grading | `gradingMood`, `gradingStrengthPct` | A mood over the whole picture: `vivid`, `warm`, `cool`, `faded`, `moody`, `noir`, `dreamy`. `beforeGrade` changes any of a mood's numbers, for a game's own. | Always: it costs the same on every device. |
| Sun rays | `sunRaysLevel`, `sunRaysStrengthPct` | Light streaming from the sun past trees, buildings and characters, while it's up and in view, in the sun's colour. | At the lighting's quality in use, medium or high; not at low. |
| Shade in corners | `cornerShadeLevel`, `cornerShadeStrengthPct`, `cornerShadeRadiusM` | Soft shade where surfaces meet: corners, creases, under things, round feet. | Only on a PC, while the lighting's quality in use is high. Never on phones and tablets, at any level. |

`low`, `medium` and `high` pick an effect's level whatever the device (shade in corners still never draws on phones and tablets): `EFFECT_LEVELS` says what each draws. `effects.levels` says the level each draws at now, and `levelsChanged` tells the game when one moves, and why. With every effect off, `render` draws the scene exactly as `renderer.render` would, at no cost.

## For another engine

`moods.js` has no engine: `MOODS` gives each mood as numbers, and `gradeColor(rgb, grade, { screenX, screenY, strengthPct })` grades one colour exactly as the shader does, on the picture as shown on screen (after tone mapping): brightness from black, saturation round the colour's luma, contrast round middle grey, warmth toward orange or blue, an overlay tint from `shadowColor` to `highlightColor` by brightness, then the vignette.

The bloom takes what's brighter than `bloomThresholdPct` of white (with a soft knee), shrinks it into 3 to 5 smaller pictures and adds them back up, before tone mapping. The sun rays take the open sky round the sun and gather it along each pixel's line to the sun. Shade in corners compares each pixel's depth with a spiral of samples within `cornerShadeRadiusM` above its surface.

`index.d.ts` is the reference. How pieces work: [docs/PIECES.md](https://github.com/zaisma/zaisma-sdk/blob/main/docs/PIECES.md). MIT licensed.
