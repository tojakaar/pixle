import type { Segmenter } from "../Segmenter";
import type { Mask, MaskBounds, MaskCollection } from "../types";
import { emptyMaskCollection } from "../types";

/**
 * Lightweight classical sky segmenter for desktop preview/export.
 *
 * Trade-offs vs neural options (MobileSAM / EfficientSAM / FastSAM / Florence-2):
 * - Pros: zero model download, CPU-only, fast on working buffers, no WASM/ONNX deps
 * - Cons: works best for clear/overcast skies; struggles with reflections, neon
 *   sunsets, heavy foliage gaps, and interior “false sky” blues
 *
 * This is a real per-pixel mask from image content — not a hardcoded rectangle.
 * Swap for a neural Segmenter later without touching the renderer.
 */
export function createSkyHeuristicSegmenter(): Segmenter {
  return {
    id: "sky-heuristic",
    displayName: "Sky heuristic",
    supportedLabels: ["sky"],
    async segment(image) {
      return segmentSky(image);
    },
  };
}

const MIN_COVERAGE = 0.04;
const MIN_CONFIDENCE = 0.35;
/** Soften edges after thresholding (radius in pixels at working res). */
const FEATHER_RADIUS = 4;

function segmentSky(image: ImageData): MaskCollection {
  const { width, height, data } = image;
  if (width < 8 || height < 8) {
    return emptyMaskCollection(width, height);
  }

  const score = new Float32Array(width * height);
  let scoreSum = 0;
  let scoreCount = 0;

  for (let y = 0; y < height; y++) {
    // Vertical prior: sky is far more likely near the top.
    const vPrior = Math.pow(1 - y / (height - 1), 1.35);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const skyness = skyLikelihood(r, g, b) * vPrior;
      score[y * width + x] = skyness;
      if (skyness > 0.15) {
        scoreSum += skyness;
        scoreCount += 1;
      }
    }
  }

  if (scoreCount < width * height * 0.02) {
    return emptyMaskCollection(width, height);
  }

  const meanScore = scoreSum / scoreCount;
  const threshold = Math.max(0.28, Math.min(0.55, meanScore * 0.72));

  // Binary seed from score, then keep components that touch the top edge.
  const seed = new Uint8Array(width * height);
  for (let i = 0; i < seed.length; i++) {
    seed[i] = (score[i]! >= threshold ? 1 : 0) as 0 | 1;
  }

  const kept = keepTopConnected(seed, width, height);
  let coverage = 0;
  for (let i = 0; i < kept.length; i++) {
    if (kept[i]) coverage += 1;
  }
  coverage /= kept.length;

  if (coverage < MIN_COVERAGE) {
    return emptyMaskCollection(width, height);
  }

  // Soft matte: score inside kept region, feathered.
  let raw = new Float32Array(width * height);
  for (let i = 0; i < raw.length; i++) {
    if (!kept[i]) {
      raw[i] = 0;
      continue;
    }
    // Remap score above threshold into 0…1, with a floor so solid sky stays opaque.
    const s = score[i]!;
    raw[i] = Math.min(1, Math.max(0, (s - threshold * 0.5) / (1 - threshold * 0.5)));
  }

  raw = boxBlur(raw, width, height, FEATHER_RADIUS);
  // Re-zero outside a slightly dilated keep region so blur doesn't invent sky in foreground.
  const dilated = dilate(kept, width, height, FEATHER_RADIUS + 1);
  for (let i = 0; i < raw.length; i++) {
    if (!dilated[i]) raw[i] = 0;
    else raw[i] = Math.min(1, Math.max(0, raw[i]!));
  }

  const bounds = computeBounds(raw, width, height);
  if (bounds.width < 1 || bounds.height < 1) {
    return emptyMaskCollection(width, height);
  }

  // Confidence from coverage, mean skyness inside mask, and top-edge contact.
  let insideSum = 0;
  let insideCount = 0;
  let topHits = 0;
  for (let x = 0; x < width; x++) {
    if ((raw[x] ?? 0) > 0.25) topHits += 1;
  }
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a > 0.05) {
      insideSum += score[i]!;
      insideCount += 1;
    }
  }
  const meanInside = insideCount > 0 ? insideSum / insideCount : 0;
  const topRatio = topHits / width;
  const confidence = Math.min(
    1,
    0.25 * Math.min(1, coverage / 0.35) +
      0.45 * meanInside +
      0.3 * topRatio,
  );

  if (confidence < MIN_CONFIDENCE) {
    return emptyMaskCollection(width, height);
  }

  const mask: Mask = {
    id: `sky-${width}x${height}`,
    label: "sky",
    confidence,
    width,
    height,
    bitmap: raw,
    bounds,
  };

  return {
    masks: [mask],
    imageWidth: width,
    imageHeight: height,
  };
}

/** Combine hue/saturation/value cues typical of clear and overcast skies. */
function skyLikelihood(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta < 1e-6 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (delta >= 1e-6) {
    if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / delta + 2) / 6;
    else h = ((r - g) / delta + 4) / 6;
  }
  const hue = h * 360;

  // Blue / cyan band (clear sky).
  const hueDist = Math.min(Math.abs(hue - 210), 360 - Math.abs(hue - 210));
  const blueHue = Math.exp(-(hueDist * hueDist) / (2 * 38 * 38));

  // Blue channel dominance.
  const blueDom = Math.max(0, b - Math.max(r, g));
  const blueRatio = b / (r + g + b + 1e-6);

  // Overcast: bright, low-sat, slightly cool.
  const overcast =
    l > 0.55 && s < 0.22 && b >= r * 0.92 && b >= g * 0.92
      ? (l - 0.55) / 0.45 * (1 - s / 0.22)
      : 0;

  // Reject warm ground / foliage / skin.
  const warmPenalty = r > b + 0.08 && r > g ? 0.55 : 1;
  // Reject very dark regions (night / underexposed).
  const darkPenalty = l < 0.18 ? l / 0.18 : 1;

  const clear =
    blueHue * (0.35 + 0.65 * Math.min(1, s * 1.8)) *
    (0.4 + 0.6 * blueRatio) *
    (0.5 + 0.5 * Math.min(1, blueDom * 4));

  return Math.min(1, Math.max(clear, overcast * 0.85) * warmPenalty * darkPenalty);
}

/** Keep connected components (4-connected) that touch the top image edge. */
function keepTopConnected(
  seed: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const stack: number[] = [];

  for (let x = 0; x < width; x++) {
    const i = x;
    if (seed[i] && !out[i]) {
      out[i] = 1;
      stack.push(i);
    }
  }

  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || out[n] || !seed[n]) continue;
      out[n] = 1;
      stack.push(n);
    }
  }

  return out;
}

function dilate(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src.slice();
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      outer: for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (src[yy * width + xx]) {
            on = 1;
            break outer;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = radius * 2 + 1;

  // Horizontal
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      const xx = Math.min(width - 1, Math.max(0, x));
      sum += src[y * width + xx]!;
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / w;
      const xOut = x - radius;
      const xIn = x + radius + 1;
      sum -= src[y * width + Math.max(0, xOut)]!;
      sum += src[y * width + Math.min(width - 1, xIn)]!;
    }
  }

  // Vertical
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      const yy = Math.min(height - 1, Math.max(0, y));
      sum += tmp[yy * width + x]!;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / w;
      const yOut = y - radius;
      const yIn = y + radius + 1;
      sum -= tmp[Math.max(0, yOut) * width + x]!;
      sum += tmp[Math.min(height - 1, yIn) * width + x]!;
    }
  }

  return out;
}

function computeBounds(
  alpha: Float32Array,
  width: number,
  height: number,
): MaskBounds {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[y * width + x] ?? 0) > 0.02) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
