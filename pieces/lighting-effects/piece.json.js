// This piece's statement, piece.json, as a module for its own code to read. "zaisma pieces check --fix" writes it: never edit it.
export default {
  "statement_version_number": 1,
  "name": "@zaisma/lighting-effects",
  "piece_version": "1.0.0",
  "kind": "extension",
  "standard": "@zaisma/standard",
  "summary": "Camera effects for the lighting piece: bloom on bright things, colour grading with named moods, sun rays and soft shade in corners. Each is off until a game turns it on, has its own level per device, and steps down with the lighting when frames run slow, so a phone keeps its frame rate.",
  "license": "MIT",
  "entry_path": "index.js",
  "server_entry_path": null,
  "file_paths": [
    "index.js",
    "index.d.ts",
    "moods.js",
    "piece.json.js",
    "README.md",
    "LICENSE.txt"
  ],
  "server_file_paths": [],
  "needs": [
    {
      "name": "@zaisma/lighting",
      "version_range": "^1.0.0",
      "kind": "piece"
    },
    {
      "name": "@zaisma/piece",
      "version_range": "^1.0.0",
      "kind": "piece"
    },
    {
      "name": "three",
      "version_range": ">=0.163.0 <1.0.0",
      "kind": "library"
    }
  ],
  "settings": [
    {
      "name": "bloom_level",
      "value_kind": "choice",
      "default_value": "off",
      "minimum_number": null,
      "maximum_number": null,
      "maximum_character_count": null,
      "choices": [
        "off",
        "auto",
        "low",
        "medium",
        "high"
      ],
      "summary": "Bloom: a soft glow round bright things, the sun, lamps, fire, anything lit past white. auto follows the lighting's quality in use (none at low, so the weakest phones never pay for it); low, medium and high draw it softer or finer whatever the device."
    },
    {
      "name": "bloom_strength_pct",
      "value_kind": "number",
      "default_value": 100,
      "minimum_number": 0,
      "maximum_number": 400,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How strong the bloom is."
    },
    {
      "name": "bloom_threshold_pct",
      "value_kind": "number",
      "default_value": 150,
      "minimum_number": 0,
      "maximum_number": 2000,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How bright something must be before it blooms, against white lit by the sun: at 150 the sun, lamps and anything given an emissive colour past white bloom, and sunlit walls don't; lower makes more things bloom."
    },
    {
      "name": "bloom_spread_pct",
      "value_kind": "number",
      "default_value": 60,
      "minimum_number": 0,
      "maximum_number": 100,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How far the bloom spreads round what shines: low keeps it tight, high makes a wide haze."
    },
    {
      "name": "grading_mood",
      "value_kind": "choice",
      "default_value": "none",
      "minimum_number": null,
      "maximum_number": null,
      "maximum_character_count": null,
      "choices": [
        "none",
        "vivid",
        "warm",
        "cool",
        "faded",
        "moody",
        "noir",
        "dreamy"
      ],
      "summary": "The colour grading's mood, over the whole picture: vivid is richer colour, warm golden, cool blue, faded soft and washed, moody dark teal and orange, noir black and white, dreamy soft and pink. none grades nothing. It costs the same on every device."
    },
    {
      "name": "grading_strength_pct",
      "value_kind": "number",
      "default_value": 100,
      "minimum_number": 0,
      "maximum_number": 100,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How much of the mood shows: 0 is the picture as it is, 100 the mood whole."
    },
    {
      "name": "sun_rays_level",
      "value_kind": "choice",
      "default_value": "off",
      "minimum_number": null,
      "maximum_number": null,
      "maximum_character_count": null,
      "choices": [
        "off",
        "auto",
        "low",
        "medium",
        "high"
      ],
      "summary": "Rays of light streaming from the sun past trees, buildings and characters while it's up and in view. auto follows the lighting's quality in use (none at low); low, medium and high draw them coarser or finer whatever the device."
    },
    {
      "name": "sun_rays_strength_pct",
      "value_kind": "number",
      "default_value": 100,
      "minimum_number": 0,
      "maximum_number": 400,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How strong the sun rays are."
    },
    {
      "name": "corner_shade_level",
      "value_kind": "choice",
      "default_value": "off",
      "minimum_number": null,
      "maximum_number": null,
      "maximum_character_count": null,
      "choices": [
        "off",
        "auto",
        "low",
        "medium",
        "high"
      ],
      "summary": "Soft shade where surfaces meet: corners, creases, under things, round feet. Drawn on PCs only, never on phones and tablets. auto draws it while the lighting's quality in use is high; low, medium and high draw it rougher or smoother."
    },
    {
      "name": "corner_shade_strength_pct",
      "value_kind": "number",
      "default_value": 100,
      "minimum_number": 0,
      "maximum_number": 300,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How dark the shade in corners is."
    },
    {
      "name": "corner_shade_radius_m",
      "value_kind": "number",
      "default_value": 0.8,
      "minimum_number": 0.05,
      "maximum_number": 10,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How far the shade reaches out of a corner, in metres: small for a character's details, large for a building's."
    }
  ],
  "hooks": [
    {
      "name": "before_grade",
      "hook_kind": "decision",
      "summary": "Asked whenever the mood changes, with its grade: { saturationPct, contrastPct, brightnessPct, warmthPct, tintPct, vignettePct, shadowColor, highlightColor }, colours as \"#rrggbb\". Answer a grade with any of them changed (a game's own mood: a storm's grey, a dream's haze), or nothing to leave it."
    },
    {
      "name": "levels_changed",
      "hook_kind": "event",
      "summary": "Told when an effect's level in use changes, with { bloomLevel, sunRaysLevel, cornerShadeLevel, reason }: each off, low, medium or high; reason is setting, or lighting_quality when the lighting's quality in use moved (auto stepping down on slow frames)."
    }
  ]
};
