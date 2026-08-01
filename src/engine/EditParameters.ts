/**
 * All non-destructive edit adjustments for a photo.
 * Values are relative to a neutral midpoint of 0 (no change),
 * except grainColor / vignette ranges noted below.
 */

/** Per-hue HSL band. Reused for every named colour. */
export interface HslBand {
  /** Hue shift; typically -100 … +100 */
  hue: number;
  /** Saturation lift/cut; typically -100 … +100 */
  saturation: number;
  /** Luminance lift/cut; typically -100 … +100 */
  luminance: number;
}

export const HSL_COLOR_NAMES = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
] as const;

export type HslColorName = (typeof HSL_COLOR_NAMES)[number];

export type HslAdjustments = Record<HslColorName, HslBand>;

export const DEFAULT_HSL_BAND: HslBand = {
  hue: 0,
  saturation: 0,
  luminance: 0,
};

export function createDefaultHsl(): HslAdjustments {
  return {
    red: { ...DEFAULT_HSL_BAND },
    orange: { ...DEFAULT_HSL_BAND },
    yellow: { ...DEFAULT_HSL_BAND },
    green: { ...DEFAULT_HSL_BAND },
    aqua: { ...DEFAULT_HSL_BAND },
    blue: { ...DEFAULT_HSL_BAND },
    purple: { ...DEFAULT_HSL_BAND },
    magenta: { ...DEFAULT_HSL_BAND },
  };
}

export interface EditParameters {
  // —— Basic tone ——
  /** EV stops; typically -2 … +2 */
  exposure: number;
  /** Contrast strength; typically -100 … +100 */
  contrast: number;
  /** Bright-region lift/cut; typically -100 … +100 */
  highlights: number;
  /** Dark-region lift/cut; typically -100 … +100 */
  shadows: number;
  /** Extreme highlight tip; typically -100 … +100 */
  whites: number;
  /** Extreme shadow tip; typically -100 … +100 */
  blacks: number;
  /** Lifted / faded blacks; typically 0 … 100 */
  fade: number;

  // —— Global colour ——
  /** Cool (−) / warm (+); typically -100 … +100 */
  temperature: number;
  /** Green (−) / magenta (+); typically -100 … +100 */
  tint: number;
  /** Linear saturation; typically -100 … +100 */
  saturation: number;
  /** Smart saturation (protects skin / already-saturated); typically -100 … +100 */
  vibrance: number;

  // —— Film texture ——
  /** Grain strength; typically 0 … 100 */
  grainAmount: number;
  /** Grain scale (fine → coarse); typically 0 … 100 */
  grainSize: number;
  /** Soft ↔ crunchy grain; typically 0 … 100 */
  grainRoughness: number;
  /** 0 = mono grain, 100 = coloured grain */
  grainColor: number;

  // —— Detail ——
  /** Midtone local contrast; typically -100 … +100 */
  clarity: number;
  /** Capture sharpening; typically 0 … 100 */
  sharpening: number;
  /** Luma denoise; typically 0 … 100 */
  luminanceNoiseReduction: number;
  /** Chroma denoise; typically 0 … 100 */
  chromaNoiseReduction: number;

  // —— Vignette ——
  /** Darken (−) / lighten (+) edges; typically -100 … +100 */
  vignetteAmount: number;
  /** Vignette start radius; typically 0 … 100 */
  vignetteMidpoint: number;
  /** Soft edge falloff; typically 0 … 100 */
  vignetteFeather: number;

  // —— Per-colour HSL ——
  hsl: HslAdjustments;
}

/** Flat numeric keys (everything except nested `hsl`). */
export type ScalarEditParameterKey = Exclude<keyof EditParameters, "hsl">;

export type EditParameterKey = ScalarEditParameterKey;

export const DEFAULT_EDIT_PARAMETERS: EditParameters = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  fade: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  grainAmount: 0,
  grainSize: 40,
  grainRoughness: 35,
  grainColor: 0,
  clarity: 0,
  sharpening: 0,
  luminanceNoiseReduction: 0,
  chromaNoiseReduction: 0,
  vignetteAmount: 0,
  vignetteMidpoint: 50,
  vignetteFeather: 50,
  hsl: createDefaultHsl(),
};

export const SCALAR_EDIT_KEYS: ScalarEditParameterKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "fade",
  "temperature",
  "tint",
  "saturation",
  "vibrance",
  "grainAmount",
  "grainSize",
  "grainRoughness",
  "grainColor",
  "clarity",
  "sharpening",
  "luminanceNoiseReduction",
  "chromaNoiseReduction",
  "vignetteAmount",
  "vignetteMidpoint",
  "vignetteFeather",
];

export const EDIT_SLIDER_CONFIG: Record<
  ScalarEditParameterKey,
  { label: string; min: number; max: number; step: number }
> = {
  exposure: { label: "Exposure", min: -2, max: 2, step: 0.01 },
  contrast: { label: "Contrast", min: -100, max: 100, step: 1 },
  highlights: { label: "Highlights", min: -100, max: 100, step: 1 },
  shadows: { label: "Shadows", min: -100, max: 100, step: 1 },
  whites: { label: "Whites", min: -100, max: 100, step: 1 },
  blacks: { label: "Blacks", min: -100, max: 100, step: 1 },
  fade: { label: "Fade", min: 0, max: 100, step: 1 },
  temperature: { label: "Temperature", min: -100, max: 100, step: 1 },
  tint: { label: "Tint", min: -100, max: 100, step: 1 },
  saturation: { label: "Saturation", min: -100, max: 100, step: 1 },
  vibrance: { label: "Vibrance", min: -100, max: 100, step: 1 },
  grainAmount: { label: "Grain Amount", min: 0, max: 100, step: 1 },
  grainSize: { label: "Grain Size", min: 0, max: 100, step: 1 },
  grainRoughness: { label: "Grain Roughness", min: 0, max: 100, step: 1 },
  grainColor: { label: "Grain Color", min: 0, max: 100, step: 1 },
  clarity: { label: "Clarity", min: -100, max: 100, step: 1 },
  sharpening: { label: "Sharpening", min: 0, max: 100, step: 1 },
  luminanceNoiseReduction: {
    label: "Luminance NR",
    min: 0,
    max: 100,
    step: 1,
  },
  chromaNoiseReduction: { label: "Chroma NR", min: 0, max: 100, step: 1 },
  vignetteAmount: { label: "Vignette", min: -100, max: 100, step: 1 },
  vignetteMidpoint: { label: "Vignette Midpoint", min: 0, max: 100, step: 1 },
  vignetteFeather: { label: "Vignette Feather", min: 0, max: 100, step: 1 },
};

export const HSL_BAND_SLIDER_CONFIG: Record<
  keyof HslBand,
  { label: string; min: number; max: number; step: number }
> = {
  hue: { label: "Hue", min: -100, max: 100, step: 1 },
  saturation: { label: "Saturation", min: -100, max: 100, step: 1 },
  luminance: { label: "Luminance", min: -100, max: 100, step: 1 },
};

const HSL_COLOR_LABELS: Record<HslColorName, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  aqua: "Aqua",
  blue: "Blue",
  purple: "Purple",
  magenta: "Magenta",
};

export function hslColorLabel(color: HslColorName): string {
  return HSL_COLOR_LABELS[color];
}

/** Deep-clone parameters (safe for history / intensity snapshots). */
export function cloneEditParameters(params: EditParameters): EditParameters {
  return {
    ...params,
    hsl: {
      red: { ...params.hsl.red },
      orange: { ...params.hsl.orange },
      yellow: { ...params.hsl.yellow },
      green: { ...params.hsl.green },
      aqua: { ...params.hsl.aqua },
      blue: { ...params.hsl.blue },
      purple: { ...params.hsl.purple },
      magenta: { ...params.hsl.magenta },
    },
  };
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeHslBand(value: unknown): HslBand {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_HSL_BAND };
  }
  const band = value as Record<string, unknown>;
  return {
    hue: typeof band.hue === "number" && Number.isFinite(band.hue) ? band.hue : 0,
    saturation:
      typeof band.saturation === "number" && Number.isFinite(band.saturation)
        ? band.saturation
        : 0,
    luminance:
      typeof band.luminance === "number" && Number.isFinite(band.luminance)
        ? band.luminance
        : 0,
  };
}

/**
 * Merge a partial / legacy parameter object with neutral defaults.
 * Old saved Looks missing newer fields remain loadable.
 */
export function normalizeEditParameters(
  value: unknown,
): EditParameters | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;

  // Legacy looks always had these seven fields.
  const requiredLegacy = [
    "exposure",
    "contrast",
    "highlights",
    "shadows",
    "temperature",
    "tint",
    "saturation",
  ] as const;
  for (const key of requiredLegacy) {
    if (typeof p[key] !== "number" || !Number.isFinite(p[key] as number)) {
      return null;
    }
  }

  const defaults = DEFAULT_EDIT_PARAMETERS;
  const hslSource =
    p.hsl && typeof p.hsl === "object"
      ? (p.hsl as Record<string, unknown>)
      : {};

  return {
    exposure: p.exposure as number,
    contrast: p.contrast as number,
    highlights: p.highlights as number,
    shadows: p.shadows as number,
    whites: readNumber(p, "whites", defaults.whites),
    blacks: readNumber(p, "blacks", defaults.blacks),
    fade: readNumber(p, "fade", defaults.fade),
    temperature: p.temperature as number,
    tint: p.tint as number,
    saturation: p.saturation as number,
    vibrance: readNumber(p, "vibrance", defaults.vibrance),
    grainAmount: readNumber(p, "grainAmount", defaults.grainAmount),
    grainSize: readNumber(p, "grainSize", defaults.grainSize),
    grainRoughness: readNumber(p, "grainRoughness", defaults.grainRoughness),
    grainColor: readNumber(p, "grainColor", defaults.grainColor),
    clarity: readNumber(p, "clarity", defaults.clarity),
    sharpening: readNumber(p, "sharpening", defaults.sharpening),
    luminanceNoiseReduction: readNumber(
      p,
      "luminanceNoiseReduction",
      defaults.luminanceNoiseReduction,
    ),
    chromaNoiseReduction: readNumber(
      p,
      "chromaNoiseReduction",
      defaults.chromaNoiseReduction,
    ),
    vignetteAmount: readNumber(p, "vignetteAmount", defaults.vignetteAmount),
    vignetteMidpoint: readNumber(
      p,
      "vignetteMidpoint",
      defaults.vignetteMidpoint,
    ),
    vignetteFeather: readNumber(
      p,
      "vignetteFeather",
      defaults.vignetteFeather,
    ),
    hsl: {
      red: normalizeHslBand(hslSource.red),
      orange: normalizeHslBand(hslSource.orange),
      yellow: normalizeHslBand(hslSource.yellow),
      green: normalizeHslBand(hslSource.green),
      aqua: normalizeHslBand(hslSource.aqua),
      blue: normalizeHslBand(hslSource.blue),
      purple: normalizeHslBand(hslSource.purple),
      magenta: normalizeHslBand(hslSource.magenta),
    },
  };
}

/** Clamp a scalar parameter into its slider range. */
export function clampScalarParam(
  key: ScalarEditParameterKey,
  value: number,
): number {
  const { min, max, step } = EDIT_SLIDER_CONFIG[key];
  const clamped = Math.min(max, Math.max(min, value));
  if (step >= 1) {
    return Math.round(clamped);
  }
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number(clamped.toFixed(decimals));
}

/** Clamp an HSL band channel into range. */
export function clampHslChannel(
  channel: keyof HslBand,
  value: number,
): number {
  const { min, max, step } = HSL_BAND_SLIDER_CONFIG[channel];
  const clamped = Math.min(max, Math.max(min, value));
  if (step >= 1) return Math.round(clamped);
  return clamped;
}
