import type { EditParameters } from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  cloneEditParameters,
  createDefaultHsl,
} from "./EditParameters";

/**
 * A reusable parameter preset ("look").
 * Stores only adjustment parameters — never image pixels.
 */
export interface Look {
  id: string;
  name: string;
  parameters: EditParameters;
  /** Built-in looks ship with the app; custom looks are user-saved. */
  builtin: boolean;
}

function lookParams(
  partial: Partial<Omit<EditParameters, "hsl">> & {
    hsl?: Partial<EditParameters["hsl"]>;
  },
): EditParameters {
  const base = cloneEditParameters(DEFAULT_EDIT_PARAMETERS);
  const { hsl: hslPartial, ...scalars } = partial;
  Object.assign(base, scalars);
  if (hslPartial) {
    for (const [color, band] of Object.entries(hslPartial)) {
      if (!band) continue;
      const key = color as keyof EditParameters["hsl"];
      base.hsl[key] = { ...base.hsl[key], ...band };
    }
  }
  return base;
}

/**
 * Built-in film-inspired looks expressed with the full EditParameters set.
 * Names are descriptive — no trademarked film stock names.
 */
export const BUILTIN_LOOKS: Look[] = [
  {
    id: "builtin:muted-documentary",
    name: "Muted Documentary",
    builtin: true,
    parameters: lookParams({
      exposure: 0.05,
      contrast: -8,
      highlights: -18,
      shadows: 16,
      whites: -6,
      blacks: 4,
      fade: 10,
      temperature: -6,
      tint: 2,
      saturation: -14,
      vibrance: -8,
      clarity: 8,
      grainAmount: 18,
      grainSize: 28,
      grainRoughness: 40,
      grainColor: 8,
      vignetteAmount: -12,
      vignetteMidpoint: 45,
      vignetteFeather: 60,
      hsl: {
        green: { hue: 0, saturation: -18, luminance: -4 },
        aqua: { hue: 0, saturation: -10, luminance: 0 },
        orange: { hue: 0, saturation: -6, luminance: 4 },
        blue: { hue: 0, saturation: -8, luminance: 6 },
      },
    }),
  },
  {
    id: "builtin:warm-slide",
    name: "Warm Slide",
    builtin: true,
    parameters: lookParams({
      exposure: 0.12,
      contrast: 14,
      highlights: -22,
      shadows: 10,
      whites: -8,
      blacks: -4,
      fade: 4,
      temperature: 32,
      tint: 8,
      saturation: -4,
      vibrance: 12,
      clarity: 4,
      grainAmount: 14,
      grainSize: 36,
      grainRoughness: 30,
      grainColor: 22,
      vignetteAmount: -18,
      vignetteMidpoint: 50,
      vignetteFeather: 55,
      hsl: {
        orange: { hue: 4, saturation: 10, luminance: 6 },
        red: { hue: -4, saturation: 6, luminance: 2 },
        blue: { hue: -6, saturation: -12, luminance: -4 },
        yellow: { hue: 0, saturation: 8, luminance: 4 },
      },
    }),
  },
  {
    id: "builtin:faded-summer",
    name: "Faded Summer",
    builtin: true,
    parameters: lookParams({
      exposure: 0.18,
      contrast: -6,
      highlights: -12,
      shadows: 22,
      whites: -4,
      blacks: 10,
      fade: 22,
      temperature: 18,
      tint: 4,
      saturation: -10,
      vibrance: 6,
      clarity: -6,
      grainAmount: 20,
      grainSize: 42,
      grainRoughness: 25,
      grainColor: 18,
      vignetteAmount: -8,
      vignetteMidpoint: 55,
      vignetteFeather: 70,
      hsl: {
        yellow: { hue: 0, saturation: -16, luminance: 8 },
        green: { hue: 8, saturation: -20, luminance: 6 },
        aqua: { hue: 0, saturation: -8, luminance: 10 },
        orange: { hue: 0, saturation: -4, luminance: 8 },
      },
    }),
  },
  {
    id: "builtin:soft-negative",
    name: "Soft Negative",
    builtin: true,
    parameters: lookParams({
      exposure: 0.08,
      contrast: -14,
      highlights: -20,
      shadows: 24,
      whites: -10,
      blacks: 12,
      fade: 16,
      temperature: -4,
      tint: 6,
      saturation: -18,
      vibrance: -6,
      clarity: -10,
      grainAmount: 16,
      grainSize: 32,
      grainRoughness: 20,
      grainColor: 12,
      vignetteAmount: -6,
      vignetteMidpoint: 48,
      vignetteFeather: 65,
      hsl: {
        magenta: { hue: 0, saturation: -8, luminance: 4 },
        purple: { hue: 0, saturation: -10, luminance: 2 },
        green: { hue: -4, saturation: -14, luminance: 4 },
        blue: { hue: 4, saturation: -6, luminance: 8 },
      },
    }),
  },
  {
    id: "builtin:cool-editorial",
    name: "Cool Editorial",
    builtin: true,
    parameters: lookParams({
      exposure: 0.1,
      contrast: 10,
      highlights: -26,
      shadows: 14,
      whites: -12,
      blacks: -2,
      fade: 6,
      temperature: -22,
      tint: -2,
      saturation: -8,
      vibrance: 8,
      clarity: 12,
      sharpening: 12,
      grainAmount: 10,
      grainSize: 24,
      grainRoughness: 35,
      grainColor: 6,
      vignetteAmount: -20,
      vignetteMidpoint: 42,
      vignetteFeather: 50,
      hsl: {
        blue: { hue: 0, saturation: 6, luminance: 10 },
        aqua: { hue: 0, saturation: 4, luminance: 6 },
        orange: { hue: 0, saturation: -8, luminance: 4 },
        red: { hue: 0, saturation: -6, luminance: 2 },
        green: { hue: 0, saturation: -12, luminance: 0 },
      },
    }),
  },
  {
    id: "builtin:fine-grain-mono",
    name: "Fine Grain Mono",
    builtin: true,
    parameters: lookParams({
      exposure: 0.05,
      contrast: 22,
      highlights: -16,
      shadows: 12,
      whites: -4,
      blacks: -8,
      fade: 8,
      temperature: 0,
      tint: 0,
      saturation: -100,
      vibrance: 0,
      clarity: 16,
      sharpening: 18,
      grainAmount: 32,
      grainSize: 18,
      grainRoughness: 45,
      grainColor: 0,
      vignetteAmount: -22,
      vignetteMidpoint: 48,
      vignetteFeather: 55,
      hsl: createDefaultHsl(),
    }),
  },
];
