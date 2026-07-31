import type { EditParameters } from "./EditParameters";

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

/**
 * Built-in looks expressed with the supported EditParameters set
 * (exposure, contrast, highlights, shadows, temperature, tint, saturation).
 * Names avoid living photographers.
 */
export const BUILTIN_LOOKS: Look[] = [
  {
    id: "builtin:cinematic-night",
    name: "Cinematic Night",
    builtin: true,
    parameters: {
      exposure: -0.35,
      contrast: 18,
      highlights: -28,
      shadows: 22,
      temperature: -18,
      tint: 4,
      saturation: -12,
    },
  },
  {
    id: "builtin:warm-film",
    name: "Warm Film",
    builtin: true,
    parameters: {
      exposure: 0.1,
      contrast: 8,
      highlights: -10,
      shadows: 12,
      temperature: 28,
      tint: 6,
      saturation: -6,
    },
  },
  {
    id: "builtin:nordic-overcast",
    name: "Nordic Overcast",
    builtin: true,
    parameters: {
      exposure: 0.15,
      contrast: -12,
      highlights: -8,
      shadows: 18,
      temperature: -22,
      tint: -4,
      saturation: -18,
    },
  },
  {
    id: "builtin:soft-editorial",
    name: "Soft Editorial",
    builtin: true,
    parameters: {
      exposure: 0.2,
      contrast: -8,
      highlights: -16,
      shadows: 20,
      temperature: 4,
      tint: 2,
      saturation: -4,
    },
  },
  {
    id: "builtin:2000s-compact-flash",
    name: "2000s Compact Flash",
    builtin: true,
    parameters: {
      exposure: 0.25,
      contrast: 28,
      highlights: 12,
      shadows: -8,
      temperature: 16,
      tint: -2,
      saturation: 22,
    },
  },
];
