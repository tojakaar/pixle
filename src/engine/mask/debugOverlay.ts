/**
 * Development debug helpers for verifying segmentation quality.
 *
 * Enabled when ANY of:
 * - localStorage `pixle.debugMasks` === "1"
 * - URL search `?debugMasks=1`
 * - Ctrl/Cmd+Shift+M toggle (persists to localStorage)
 *
 * Overlay never affects export. Safe in production builds when explicitly on.
 */

const STORAGE_KEY = "pixle.debugMasks";

const OVERLAY_COLORS: Record<string, [number, number, number]> = {
  sky: [80, 160, 255],
  person: [255, 120, 90],
  vegetation: [70, 200, 100],
  water: [40, 120, 220],
  buildings: [200, 160, 80],
  ground: [160, 120, 70],
  background: [140, 140, 160],
};

export function isMaskDebugEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("debugMasks") === "1") return true;
    if (params.get("debugMasks") === "0") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMaskDebugEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function toggleMaskDebugEnabled(): boolean {
  const next = !isMaskDebugEnabled();
  setMaskDebugEnabled(next);
  return next;
}

/** ~40% coloured overlay; click-through (pointer-events none on the canvas). */
export function paintMaskDebugOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  masks: Array<{ label: string; bitmap: Float32Array; width: number; height: number }>,
): void {
  if (masks.length === 0) return;

  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (const mask of masks) {
    const [r, g, b] = OVERLAY_COLORS[mask.label] ?? [180, 80, 200];
    const src =
      mask.width === width && mask.height === height
        ? mask.bitmap
        : null;
    if (!src) continue;

    for (let i = 0, p = 0; i < src.length; i++, p += 4) {
      const a = src[i]!;
      if (a <= 0.02) continue;
      const alpha = Math.min(1, a) * 0.4;
      const inv = 1 - alpha;
      // Composite over existing overlay pixels (additive soft stack).
      data[p] = Math.round(data[p]! * inv + r * alpha);
      data[p + 1] = Math.round(data[p + 1]! * inv + g * alpha);
      data[p + 2] = Math.round(data[p + 2]! * inv + b * alpha);
      data[p + 3] = Math.max(data[p + 3]!, Math.round(alpha * 255));
    }
  }

  ctx.putImageData(image, 0, 0);
}
