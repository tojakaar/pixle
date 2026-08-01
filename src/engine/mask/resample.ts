import type { Mask, MaskBounds } from "./types";

/**
 * Bilinear-resample a soft mask to a target resolution.
 * Used so working-buffer masks can be applied at export resolution (and vice versa).
 */
export function resampleMask(
  mask: Mask,
  targetWidth: number,
  targetHeight: number,
): Mask {
  if (
    mask.width === targetWidth &&
    mask.height === targetHeight &&
    mask.bitmap.length === targetWidth * targetHeight
  ) {
    return mask;
  }

  if (targetWidth < 1 || targetHeight < 1) {
    throw new Error("Invalid mask resample dimensions.");
  }

  const srcW = mask.width;
  const srcH = mask.height;
  const src = mask.bitmap;
  const dst = new Float32Array(targetWidth * targetHeight);

  const xRatio = srcW / targetWidth;
  const yRatio = srcH / targetHeight;

  let minX = targetWidth;
  let minY = targetHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < targetHeight; y++) {
    const sy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));

    for (let x = 0; x < targetWidth; x++) {
      const sx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));

      const v00 = src[y0 * srcW + x0] ?? 0;
      const v10 = src[y0 * srcW + x1] ?? 0;
      const v01 = src[y1 * srcW + x0] ?? 0;
      const v11 = src[y1 * srcW + x1] ?? 0;

      const v0 = v00 + (v10 - v00) * fx;
      const v1 = v01 + (v11 - v01) * fx;
      const v = v0 + (v1 - v0) * fy;

      dst[y * targetWidth + x] = v;
      if (v > 0.02) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const bounds: MaskBounds =
    maxX >= minX && maxY >= minY
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : { x: 0, y: 0, width: 0, height: 0 };

  return {
    id: mask.id,
    label: mask.label,
    confidence: mask.confidence,
    width: targetWidth,
    height: targetHeight,
    bitmap: dst,
    bounds,
  };
}
