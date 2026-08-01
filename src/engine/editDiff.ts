import {
  EDIT_SLIDER_CONFIG,
  HSL_COLOR_NAMES,
  HSL_BAND_SLIDER_CONFIG,
  hslColorLabel,
  type EditParameters,
  type HslBand,
  type HslColorName,
  type ScalarEditParameterKey,
} from "./EditParameters";

/** Ordered scalar keys for stable UI presentation. */
export const EDIT_PARAMETER_KEYS: ScalarEditParameterKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "fade",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
  "clarity",
  "sharpening",
  "luminanceNoiseReduction",
  "chromaNoiseReduction",
  "grainAmount",
  "grainSize",
  "grainRoughness",
  "grainColor",
  "vignetteAmount",
  "vignetteMidpoint",
  "vignetteFeather",
];

const HSL_CHANNELS: (keyof HslBand)[] = ["hue", "saturation", "luminance"];

const NEGLIGIBLE_SCALAR: Record<ScalarEditParameterKey, number> = {
  exposure: 0.005,
  contrast: 0.5,
  highlights: 0.5,
  shadows: 0.5,
  whites: 0.5,
  blacks: 0.5,
  fade: 0.5,
  temperature: 0.5,
  tint: 0.5,
  saturation: 0.5,
  vibrance: 0.5,
  grainAmount: 0.5,
  grainSize: 0.5,
  grainRoughness: 0.5,
  grainColor: 0.5,
  clarity: 0.5,
  sharpening: 0.5,
  luminanceNoiseReduction: 0.5,
  chromaNoiseReduction: 0.5,
  vignetteAmount: 0.5,
  vignetteMidpoint: 0.5,
  vignetteFeather: 0.5,
};

const NEGLIGIBLE_HSL = 0.5;

export interface ParameterChange {
  /** Stable id, e.g. `vibrance` or `hsl.blue.saturation`. */
  key: string;
  label: string;
  /** Signed delta introduced by the edit (after − before). */
  delta: number;
  /** Human-readable signed value, e.g. "+0.3" or "-12". */
  formatted: string;
}

function formatScalarDelta(key: ScalarEditParameterKey, delta: number): string {
  if (key === "exposure") {
    const rounded = Math.round(delta * 100) / 100;
    return rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
  }
  const rounded = Math.round(delta);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatHslDelta(delta: number): string {
  const rounded = Math.round(delta);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function hslChannelLabel(
  color: HslColorName,
  channel: keyof HslBand,
): string {
  const colorLabel = hslColorLabel(color);
  if (channel === "hue") return `${colorLabel} Hue`;
  if (channel === "saturation") return `${colorLabel} Saturation`;
  return `${colorLabel} Luminance`;
}

/** Linearly interpolate every parameter, including nested HSL. `t` is 0…1. */
export function lerpParameters(
  from: EditParameters,
  to: EditParameters,
  t: number,
): EditParameters {
  const clampT = Math.min(1, Math.max(0, t));
  const lerp = (a: number, b: number) => a + (b - a) * clampT;

  const hsl = {} as EditParameters["hsl"];
  for (const color of HSL_COLOR_NAMES) {
    hsl[color] = {
      hue: lerp(from.hsl[color].hue, to.hsl[color].hue),
      saturation: lerp(from.hsl[color].saturation, to.hsl[color].saturation),
      luminance: lerp(from.hsl[color].luminance, to.hsl[color].luminance),
    };
  }

  return {
    exposure: lerp(from.exposure, to.exposure),
    contrast: lerp(from.contrast, to.contrast),
    highlights: lerp(from.highlights, to.highlights),
    shadows: lerp(from.shadows, to.shadows),
    whites: lerp(from.whites, to.whites),
    blacks: lerp(from.blacks, to.blacks),
    fade: lerp(from.fade, to.fade),
    temperature: lerp(from.temperature, to.temperature),
    tint: lerp(from.tint, to.tint),
    saturation: lerp(from.saturation, to.saturation),
    vibrance: lerp(from.vibrance, to.vibrance),
    grainAmount: lerp(from.grainAmount, to.grainAmount),
    grainSize: lerp(from.grainSize, to.grainSize),
    grainRoughness: lerp(from.grainRoughness, to.grainRoughness),
    grainColor: lerp(from.grainColor, to.grainColor),
    clarity: lerp(from.clarity, to.clarity),
    sharpening: lerp(from.sharpening, to.sharpening),
    luminanceNoiseReduction: lerp(
      from.luminanceNoiseReduction,
      to.luminanceNoiseReduction,
    ),
    chromaNoiseReduction: lerp(
      from.chromaNoiseReduction,
      to.chromaNoiseReduction,
    ),
    vignetteAmount: lerp(from.vignetteAmount, to.vignetteAmount),
    vignetteMidpoint: lerp(from.vignetteMidpoint, to.vignetteMidpoint),
    vignetteFeather: lerp(from.vignetteFeather, to.vignetteFeather),
    hsl,
  };
}

/**
 * Diff two parameter snapshots. Only non-negligible changes are returned.
 * Does not include any model reasoning — final parameter deltas only.
 */
export function diffParameters(
  before: EditParameters,
  after: EditParameters,
): ParameterChange[] {
  const changes: ParameterChange[] = [];

  for (const key of EDIT_PARAMETER_KEYS) {
    // Skip grain size/roughness/color noise when amount didn't meaningfully change
    // and both amounts are near zero — keeps Changes tidy.
    if (
      (key === "grainSize" ||
        key === "grainRoughness" ||
        key === "grainColor") &&
      Math.abs(after.grainAmount) < NEGLIGIBLE_SCALAR.grainAmount &&
      Math.abs(before.grainAmount) < NEGLIGIBLE_SCALAR.grainAmount
    ) {
      continue;
    }
    if (
      (key === "vignetteMidpoint" || key === "vignetteFeather") &&
      Math.abs(after.vignetteAmount) < NEGLIGIBLE_SCALAR.vignetteAmount &&
      Math.abs(before.vignetteAmount) < NEGLIGIBLE_SCALAR.vignetteAmount
    ) {
      continue;
    }

    const delta = after[key] - before[key];
    if (Math.abs(delta) < NEGLIGIBLE_SCALAR[key]) continue;

    changes.push({
      key,
      label: EDIT_SLIDER_CONFIG[key].label,
      delta,
      formatted: formatScalarDelta(key, delta),
    });
  }

  for (const color of HSL_COLOR_NAMES) {
    for (const channel of HSL_CHANNELS) {
      const delta = after.hsl[color][channel] - before.hsl[color][channel];
      if (Math.abs(delta) < NEGLIGIBLE_HSL) continue;
      changes.push({
        key: `hsl.${color}.${channel}`,
        label: hslChannelLabel(color, channel),
        delta,
        formatted: formatHslDelta(delta),
      });
    }
  }

  return changes;
}

/** Re-export for callers that want HSL slider metadata. */
export { HSL_BAND_SLIDER_CONFIG };
