import {
  HSL_COLOR_NAMES,
  hslColorLabel,
  type HslColorName,
  type ScalarEditParameterKey,
} from "./EditParameters";
import type { ParameterChange } from "./editDiff";

export interface ChangeGroup {
  id: string;
  title: string;
  changes: ParameterChange[];
}

const TONE_KEYS = new Set<ScalarEditParameterKey>([
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "fade",
]);

const COLOUR_KEYS = new Set<ScalarEditParameterKey>([
  "temperature",
  "tint",
  "vibrance",
  "saturation",
]);

const DETAIL_KEYS = new Set<ScalarEditParameterKey>([
  "clarity",
  "sharpening",
  "luminanceNoiseReduction",
  "chromaNoiseReduction",
]);

const GRAIN_KEYS = new Set<ScalarEditParameterKey>([
  "grainAmount",
  "grainSize",
  "grainRoughness",
  "grainColor",
]);

const VIGNETTE_KEYS = new Set<ScalarEditParameterKey>([
  "vignetteAmount",
  "vignetteMidpoint",
  "vignetteFeather",
]);

const SHORT_SCALAR_LABELS: Partial<Record<ScalarEditParameterKey, string>> = {
  grainAmount: "Amount",
  grainSize: "Size",
  grainRoughness: "Roughness",
  grainColor: "Colour",
  vignetteAmount: "Amount",
  vignetteMidpoint: "Midpoint",
  vignetteFeather: "Feather",
  luminanceNoiseReduction: "Luma NR",
  chromaNoiseReduction: "Chroma NR",
};

function hslGroupTitle(color: HslColorName): string {
  return `${hslColorLabel(color)} HSL`;
}

function displayLabel(change: ParameterChange): string {
  if (change.key.startsWith("hsl.")) {
    const parts = change.key.split(".");
    const channel = parts[2];
    if (channel === "hue") return "Hue";
    if (channel === "saturation") return "Saturation";
    if (channel === "luminance") return "Luminance";
  }

  const short = SHORT_SCALAR_LABELS[change.key as ScalarEditParameterKey];
  return short ?? change.label;
}

/**
 * Group parameter deltas for the Changes tab.
 * Only includes non-empty groups; preserves + signs via `formatted`.
 */
export function groupParameterChanges(
  changes: ParameterChange[],
): ChangeGroup[] {
  const tone: ParameterChange[] = [];
  const colour: ParameterChange[] = [];
  const detail: ParameterChange[] = [];
  const grain: ParameterChange[] = [];
  const vignette: ParameterChange[] = [];
  const hslByColor = new Map<HslColorName, ParameterChange[]>();
  const other: ParameterChange[] = [];

  for (const change of changes) {
    const labeled = { ...change, label: displayLabel(change) };

    if (change.key.startsWith("hsl.")) {
      const color = change.key.split(".")[1] as HslColorName;
      if (HSL_COLOR_NAMES.includes(color)) {
        const list = hslByColor.get(color) ?? [];
        list.push(labeled);
        hslByColor.set(color, list);
        continue;
      }
    }

    const key = change.key as ScalarEditParameterKey;
    if (TONE_KEYS.has(key)) {
      tone.push(labeled);
    } else if (COLOUR_KEYS.has(key)) {
      colour.push(labeled);
    } else if (DETAIL_KEYS.has(key)) {
      detail.push(labeled);
    } else if (GRAIN_KEYS.has(key)) {
      grain.push(labeled);
    } else if (VIGNETTE_KEYS.has(key)) {
      vignette.push(labeled);
    } else {
      other.push(labeled);
    }
  }

  const groups: ChangeGroup[] = [];
  if (tone.length) groups.push({ id: "tone", title: "Tone", changes: tone });
  if (colour.length)
    groups.push({ id: "colour", title: "Colour", changes: colour });
  if (detail.length)
    groups.push({ id: "detail", title: "Detail", changes: detail });

  for (const color of HSL_COLOR_NAMES) {
    const list = hslByColor.get(color);
    if (list?.length) {
      groups.push({
        id: `hsl-${color}`,
        title: hslGroupTitle(color),
        changes: list,
      });
    }
  }

  if (grain.length)
    groups.push({ id: "grain", title: "Grain", changes: grain });
  if (vignette.length)
    groups.push({ id: "vignette", title: "Vignette", changes: vignette });
  if (other.length)
    groups.push({ id: "other", title: "Other", changes: other });

  return groups;
}
