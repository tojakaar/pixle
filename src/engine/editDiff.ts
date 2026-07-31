import {
  EDIT_SLIDER_CONFIG,
  type EditParameterKey,
  type EditParameters,
} from "./EditParameters";

/** Ordered keys for stable UI presentation. */
export const EDIT_PARAMETER_KEYS: EditParameterKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "temperature",
  "tint",
  "saturation",
];

const NEGLIGIBLE: Record<EditParameterKey, number> = {
  exposure: 0.005,
  contrast: 0.5,
  highlights: 0.5,
  shadows: 0.5,
  temperature: 0.5,
  tint: 0.5,
  saturation: 0.5,
};

export interface ParameterChange {
  key: EditParameterKey;
  label: string;
  /** Signed delta introduced by the edit (after − before). */
  delta: number;
  /** Human-readable signed value, e.g. "+0.3" or "-12". */
  formatted: string;
}

/** Linearly interpolate every parameter. `t` is typically 0…1. */
export function lerpParameters(
  from: EditParameters,
  to: EditParameters,
  t: number,
): EditParameters {
  const clampT = Math.min(1, Math.max(0, t));
  return {
    exposure: from.exposure + (to.exposure - from.exposure) * clampT,
    contrast: from.contrast + (to.contrast - from.contrast) * clampT,
    highlights: from.highlights + (to.highlights - from.highlights) * clampT,
    shadows: from.shadows + (to.shadows - from.shadows) * clampT,
    temperature:
      from.temperature + (to.temperature - from.temperature) * clampT,
    tint: from.tint + (to.tint - from.tint) * clampT,
    saturation:
      from.saturation + (to.saturation - from.saturation) * clampT,
  };
}

function formatDelta(key: EditParameterKey, delta: number): string {
  if (key === "exposure") {
    const rounded = Math.round(delta * 100) / 100;
    return rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
  }
  const rounded = Math.round(delta);
  return rounded > 0 ? `+${rounded}` : String(rounded);
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
    const delta = after[key] - before[key];
    if (Math.abs(delta) < NEGLIGIBLE[key]) continue;

    changes.push({
      key,
      label: EDIT_SLIDER_CONFIG[key].label,
      delta,
      formatted: formatDelta(key, delta),
    });
  }

  return changes;
}
