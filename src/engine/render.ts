import type { EditParameters } from "./EditParameters";
import { DEFAULT_EDIT_PARAMETERS } from "./EditParameters";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Applies `params` to a copy of `source`. The original `ImageData` is never mutated.
 */
export function applyEdits(
  source: ImageData,
  params: EditParameters,
): ImageData {
  const output = new ImageData(source.width, source.height);
  const src = source.data;
  const dst = output.data;

  const exposureMul = Math.pow(2, params.exposure);
  const contrast = params.contrast / 100;
  const contrastFactor = Math.tan(((contrast + 1) * Math.PI) / 4);
  const highlights = params.highlights / 100;
  const shadows = params.shadows / 100;
  const temperature = params.temperature / 100;
  const tint = params.tint / 100;
  const saturation = params.saturation / 100;
  const satFactor = 1 + saturation;

  for (let i = 0; i < src.length; i += 4) {
    let r = (src[i]! / 255) * exposureMul;
    let g = (src[i + 1]! / 255) * exposureMul;
    let b = (src[i + 2]! / 255) * exposureMul;

    // Contrast around mid-gray
    r = (r - 0.5) * contrastFactor + 0.5;
    g = (g - 0.5) * contrastFactor + 0.5;
    b = (b - 0.5) * contrastFactor + 0.5;

    // Highlights / shadows (luminance-weighted)
    const lum = luminance(r, g, b);
    const highlightMask = lum * lum;
    const shadowMask = (1 - lum) * (1 - lum);

    const hsAdjust = highlightMask * highlights * -0.5 + shadowMask * shadows * 0.5;
    r += hsAdjust;
    g += hsAdjust;
    b += hsAdjust;

    // White balance: temperature (blue↔yellow) and tint (green↔magenta)
    r += temperature * 0.15 - tint * 0.08;
    g += tint * 0.12;
    b += -temperature * 0.15 - tint * 0.04;

    // Saturation
    const gray = luminance(r, g, b);
    r = gray + (r - gray) * satFactor;
    g = gray + (g - gray) * satFactor;
    b = gray + (b - gray) * satFactor;

    dst[i] = clampByte(clamp01(r) * 255);
    dst[i + 1] = clampByte(clamp01(g) * 255);
    dst[i + 2] = clampByte(clamp01(b) * 255);
    dst[i + 3] = src[i + 3]!;
  }

  return output;
}

/** True when every parameter is at its default (identity) value. */
export function isIdentityEdit(params: EditParameters): boolean {
  return (
    params.exposure === DEFAULT_EDIT_PARAMETERS.exposure &&
    params.contrast === DEFAULT_EDIT_PARAMETERS.contrast &&
    params.highlights === DEFAULT_EDIT_PARAMETERS.highlights &&
    params.shadows === DEFAULT_EDIT_PARAMETERS.shadows &&
    params.temperature === DEFAULT_EDIT_PARAMETERS.temperature &&
    params.tint === DEFAULT_EDIT_PARAMETERS.tint &&
    params.saturation === DEFAULT_EDIT_PARAMETERS.saturation
  );
}
