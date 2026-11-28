// Colour grading's named moods, as plain numbers with no engine. The effects piece draws them with three.js; another
// engine reads the same values and grades the same way (README.md, "For another engine").

/** Each field of a grade, with what it takes. Colours are "#rrggbb". */
export const GRADE_NUMBER_FIELDS = {
  saturationPct: { minimumNumber: 0, maximumNumber: 200 },
  contrastPct: { minimumNumber: 50, maximumNumber: 200 },
  brightnessPct: { minimumNumber: 50, maximumNumber: 200 },
  warmthPct: { minimumNumber: -100, maximumNumber: 100 },
  tintPct: { minimumNumber: 0, maximumNumber: 100 },
  vignettePct: { minimumNumber: 0, maximumNumber: 100 },
};
export const GRADE_COLOR_FIELDS = ["shadowColor", "highlightColor"];

/** A grade that changes nothing. */
export const NEUTRAL_GRADE = { saturationPct: 100, contrastPct: 100, brightnessPct: 100, warmthPct: 0, tintPct: 0, vignettePct: 0, shadowColor: "#808080", highlightColor: "#808080" };

/**
 * The named moods: grading_mood picks one. saturationPct 0 is grey and 200 doubles colour; contrastPct and
 * brightnessPct scale round the middle grey and from black; warmthPct moves colour toward orange (up) or blue (down);
 * shadowColor and highlightColor tintNumber the dark and bright parts by tintPct; vignettePct darkens the corners.
 */
export const MOODS = {
  vivid: { ...NEUTRAL_GRADE, saturationPct: 135, contrastPct: 112, brightnessPct: 102, warmthPct: 5, vignettePct: 10 },
  warm: { ...NEUTRAL_GRADE, saturationPct: 110, contrastPct: 104, warmthPct: 45, tintPct: 20, shadowColor: "#5a3a2a", highlightColor: "#ffc080", vignettePct: 15 },
  cool: { ...NEUTRAL_GRADE, saturationPct: 95, contrastPct: 106, warmthPct: -40, tintPct: 20, shadowColor: "#203860", highlightColor: "#d0e4ff", vignettePct: 15 },
  faded: { ...NEUTRAL_GRADE, saturationPct: 70, contrastPct: 82, brightnessPct: 106, warmthPct: 10, tintPct: 25, shadowColor: "#405060", highlightColor: "#f0e0c8" },
  moody: { ...NEUTRAL_GRADE, saturationPct: 85, contrastPct: 118, brightnessPct: 94, warmthPct: -10, tintPct: 35, shadowColor: "#1a3040", highlightColor: "#e8c090", vignettePct: 35 },
  noir: { ...NEUTRAL_GRADE, saturationPct: 0, contrastPct: 130, brightnessPct: 98, vignettePct: 40 },
  dreamy: { ...NEUTRAL_GRADE, saturationPct: 115, contrastPct: 90, brightnessPct: 106, warmthPct: 15, tintPct: 25, shadowColor: "#604080", highlightColor: "#ffd0e0", vignettePct: 20 },
};

const hexToRgb = (hex) => [1, 3, 5].map((startIndex) => parseInt(hex.slice(startIndex, startIndex + 2), 16) / 255);
const LUMA = [0.2126, 0.7152, 0.0722];
const clamp01 = (amountNumber) => Math.min(1, Math.max(0, amountNumber));
const overlay = (baseNumber, blend) => (baseNumber < 0.5 ? 2 * baseNumber * blend : 1 - 2 * (1 - baseNumber) * (1 - blend));

/**
 * One colour gradedNumber, as shown on screen: [red, green, blue] from 0 to 1 after tone mapping, at a place on the
 * screen (0 to 1 each way, for the vignette), mixed in by strengthPct. The effects piece's shader does exactly this.
 */
export function gradeColor(rgb, grade, { screenX = 0.5, screenY = 0.5, strengthPct = 100 } = {}) {
  let color = rgb.map((channel) => channel * (grade.brightnessPct / 100));
  const luma = color.reduce((total, channel, channelIndex) => total + channel * LUMA[channelIndex], 0);
  color = color.map((channel) => luma + (channel - luma) * (grade.saturationPct / 100));
  color = color.map((channel) => (channel - 0.5) * (grade.contrastPct / 100) + 0.5);
  const warmthNumber = (grade.warmthPct / 100) * 0.08;
  color = [color[0] + warmthNumber, color[1] + warmthNumber * 0.25, color[2] - warmthNumber];
  const shadow = hexToRgb(grade.shadowColor);
  const highlight = hexToRgb(grade.highlightColor);
  const tonePct = clamp01(luma);
  const toneShareNumber = tonePct * tonePct * (3 - 2 * tonePct);
  color = color.map((channel, channelIndex) => {
    const tintNumber = shadow[channelIndex] + (highlight[channelIndex] - shadow[channelIndex]) * toneShareNumber;
    const baseNumber = clamp01(channel);
    return baseNumber + (overlay(baseNumber, tintNumber) - baseNumber) * (grade.tintPct / 100);
  });
  const fromCentreNumber = Math.hypot(screenX - 0.5, screenY - 0.5) * 1.42;
  const edgeNumber = clamp01((fromCentreNumber - 0.45) / 0.65);
  const darkenNumber = 1 - (grade.vignettePct / 100) * 0.6 * edgeNumber * edgeNumber * (3 - 2 * edgeNumber);
  return color.map((channel, channelIndex) => {
    const gradedNumber = clamp01(channel * darkenNumber);
    return rgb[channelIndex] + (gradedNumber - rgb[channelIndex]) * (strengthPct / 100);
  });
}
