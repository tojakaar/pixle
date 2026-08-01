import type { Mask } from "./types";
import { resampleMask } from "./resample";

/**
 * Blend `local` over `base` using a soft mask.
 * Both buffers must already be produced by the shared parameter engine —
 * this module never reimplements photographic edits.
 */
export function compositeMaskedEdit(
  source: ImageData,
  local: ImageData,
  base: ImageData,
  mask: Mask,
): ImageData {
  const { width, height } = source;
  if (local.width !== width || local.height !== height) {
    throw new Error("Local edit buffer size mismatch.");
  }
  if (base.width !== width || base.height !== height) {
    throw new Error("Base edit buffer size mismatch.");
  }

  const matte =
    mask.width === width && mask.height === height
      ? mask
      : resampleMask(mask, width, height);

  const out = new ImageData(width, height);
  const dst = out.data;
  const localData = local.data;
  const baseData = base.data;
  const alpha = matte.bitmap;
  const src = source.data;

  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const m = alpha[i]!;
    if (m <= 0) {
      dst[p] = baseData[p]!;
      dst[p + 1] = baseData[p + 1]!;
      dst[p + 2] = baseData[p + 2]!;
      dst[p + 3] = src[p + 3]!;
      continue;
    }
    if (m >= 1) {
      dst[p] = localData[p]!;
      dst[p + 1] = localData[p + 1]!;
      dst[p + 2] = localData[p + 2]!;
      dst[p + 3] = src[p + 3]!;
      continue;
    }
    const inv = 1 - m;
    dst[p] = Math.round(baseData[p]! * inv + localData[p]! * m);
    dst[p + 1] = Math.round(baseData[p + 1]! * inv + localData[p + 1]! * m);
    dst[p + 2] = Math.round(baseData[p + 2]! * inv + localData[p + 2]! * m);
    dst[p + 3] = src[p + 3]!;
  }

  return out;
}
