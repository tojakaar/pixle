/**
 * Compact, editor-oriented metadata derived locally from the loaded image.
 * Never includes pixel payloads — safe to send to an LLM as text context.
 */
export interface DominantColour {
  /** CSS hex, e.g. "#c48a62" */
  hex: string;
  r: number;
  g: number;
  b: number;
  /** Share of sampled pixels belonging to this cluster (0–100). */
  coveragePercent: number;
}

/** Axis-aligned face box in original image pixel coordinates. */
export interface DetectedFace {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageAnalysis {
  width: number;
  height: number;
  /**
   * Luminance histogram with 32 bins covering 0–255.
   * Each value is a percentage of sampled pixels (sums ≈ 100).
   */
  brightnessHistogram: number[];
  /** Correlated colour temperature estimate (Kelvin) from mean scene colour. */
  averageColourTemperatureKelvin: number;
  /** Short label for the Kelvin estimate, e.g. "warm tungsten". */
  colourTemperatureLabel: string;
  dominantColours: DominantColour[];
  /** Percent of sampled pixels near pure white (highlight clip). */
  highlightClippingPercent: number;
  /** Percent of sampled pixels near pure black (shadow clip). */
  shadowClippingPercent: number;
  /**
   * Detected faces when the platform FaceDetector API is available.
   * `null` means detection was not available (not “zero faces”).
   */
  faces: DetectedFace[] | null;
  faceDetectionAvailable: boolean;
}

const ANALYSIS_MAX_EDGE = 256;
const HISTOGRAM_BINS = 32;
const DOMINANT_COLOUR_COUNT = 5;
const HIGHLIGHT_CLIP_THRESHOLD = 250;
const SHADOW_CLIP_THRESHOLD = 5;

/**
 * Analyse `source` locally on a downscaled working copy.
 * Original dimensions are preserved in the result; full-res pixels are not kept.
 */
export async function analyzeImage(source: ImageData): Promise<ImageAnalysis> {
  const sample = downsampleForAnalysis(source);
  const stats = computePixelStats(sample);

  const facesResult = await detectFaces(source);

  return {
    width: source.width,
    height: source.height,
    brightnessHistogram: stats.brightnessHistogram,
    averageColourTemperatureKelvin: stats.averageColourTemperatureKelvin,
    colourTemperatureLabel: colourTemperatureLabel(
      stats.averageColourTemperatureKelvin,
    ),
    dominantColours: stats.dominantColours,
    highlightClippingPercent: stats.highlightClippingPercent,
    shadowClippingPercent: stats.shadowClippingPercent,
    faces: facesResult.faces,
    faceDetectionAvailable: facesResult.available,
  };
}

function downsampleForAnalysis(source: ImageData): ImageData {
  const maxEdge = Math.max(source.width, source.height);
  if (maxEdge <= ANALYSIS_MAX_EDGE) {
    return source;
  }

  const scale = ANALYSIS_MAX_EDGE / maxEdge;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const output = new ImageData(width, height);
  const src = source.data;
  const dst = output.data;

  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(source.width - 1, Math.floor(x / scale));
      const srcIndex = (srcY * source.width + srcX) * 4;
      const dstIndex = (y * width + x) * 4;
      dst[dstIndex] = src[srcIndex]!;
      dst[dstIndex + 1] = src[srcIndex + 1]!;
      dst[dstIndex + 2] = src[srcIndex + 2]!;
      dst[dstIndex + 3] = src[srcIndex + 3]!;
    }
  }

  return output;
}

interface PixelStats {
  brightnessHistogram: number[];
  averageColourTemperatureKelvin: number;
  dominantColours: DominantColour[];
  highlightClippingPercent: number;
  shadowClippingPercent: number;
}

function computePixelStats(sample: ImageData): PixelStats {
  const { data } = sample;
  const histogram = new Array<number>(HISTOGRAM_BINS).fill(0);
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let opaquePixels = 0;
  let highlightClipped = 0;
  let shadowClipped = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 8) continue;

    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    opaquePixels += 1;

    sumR += r;
    sumG += g;
    sumB += b;

    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const bin = Math.min(
      HISTOGRAM_BINS - 1,
      Math.floor((lum / 256) * HISTOGRAM_BINS),
    );
    histogram[bin]! += 1;

    if (lum >= HIGHLIGHT_CLIP_THRESHOLD) highlightClipped += 1;
    if (lum <= SHADOW_CLIP_THRESHOLD) shadowClipped += 1;

    // 4-bit/channel quantisation for dominant-colour clustering.
    const qr = r >> 4;
    const qg = g >> 4;
    const qb = b >> 4;
    const key = (qr << 8) | (qg << 4) | qb;
    const existing = buckets.get(key);
    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  const safeCount = Math.max(1, opaquePixels);
  const brightnessHistogram = histogram.map((count) =>
    round1((count / safeCount) * 100),
  );

  const meanR = sumR / safeCount;
  const meanG = sumG / safeCount;
  const meanB = sumB / safeCount;
  const kelvin = estimateColourTemperatureKelvin(meanR, meanG, meanB);

  const dominantColours = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, DOMINANT_COLOUR_COUNT)
    .map((bucket) => {
      const r = Math.round(bucket.r / bucket.count);
      const g = Math.round(bucket.g / bucket.count);
      const b = Math.round(bucket.b / bucket.count);
      return {
        hex: rgbToHex(r, g, b),
        r,
        g,
        b,
        coveragePercent: round1((bucket.count / safeCount) * 100),
      };
    });

  return {
    brightnessHistogram,
    averageColourTemperatureKelvin: Math.round(kelvin),
    dominantColours,
    highlightClippingPercent: round2((highlightClipped / safeCount) * 100),
    shadowClippingPercent: round2((shadowClipped / safeCount) * 100),
  };
}

/**
 * McCamy approximation of correlated colour temperature from mean sRGB.
 * Clamped to a photographically useful 1000–15000 K range.
 */
function estimateColourTemperatureKelvin(
  rByte: number,
  gByte: number,
  bByte: number,
): number {
  const r = srgbToLinear(rByte / 255);
  const g = srgbToLinear(gByte / 255);
  const b = srgbToLinear(bByte / 255);

  // sRGB D65 → XYZ
  const X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const Z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;

  const denom = X + Y + Z;
  if (denom < 1e-6) {
    return 6500;
  }

  const x = X / denom;
  const y = Y / denom;
  const n = (x - 0.332) / (0.1858 - y);
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;

  if (!Number.isFinite(cct)) {
    return 6500;
  }
  return Math.min(15000, Math.max(1000, cct));
}

function colourTemperatureLabel(kelvin: number): string {
  if (kelvin < 3000) return "very warm (candle/tungsten)";
  if (kelvin < 4000) return "warm tungsten";
  if (kelvin < 5000) return "warm white";
  if (kelvin < 5800) return "neutral daylight";
  if (kelvin < 7000) return "cool daylight";
  if (kelvin < 9000) return "cool / overcast";
  return "very cool / blue";
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface FaceDetectionResult {
  available: boolean;
  faces: DetectedFace[] | null;
}

async function detectFaces(source: ImageData): Promise<FaceDetectionResult> {
  const Detector = (
    globalThis as unknown as {
      FaceDetector?: new (options?: {
        fastMode?: boolean;
        maxDetectedFaces?: number;
      }) => {
        detect: (
          image: ImageBitmapSource,
        ) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
      };
    }
  ).FaceDetector;

  if (typeof Detector !== "function") {
    return { available: false, faces: null };
  }

  try {
    const detector = new Detector({ fastMode: true, maxDetectedFaces: 10 });
    // Detect on a moderate-resolution bitmap for speed; scale boxes back.
    const maxEdge = Math.max(source.width, source.height);
    const detectEdge = Math.min(maxEdge, 640);
    const scale = detectEdge / maxEdge;
    const dw = Math.max(1, Math.round(source.width * scale));
    const dh = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { available: false, faces: null };
    }

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = source.width;
    srcCanvas.height = source.height;
    const srcCtx = srcCanvas.getContext("2d");
    if (!srcCtx) {
      return { available: false, faces: null };
    }
    srcCtx.putImageData(source, 0, 0);
    ctx.drawImage(srcCanvas, 0, 0, dw, dh);

    const detected = await detector.detect(canvas);
    const inv = 1 / scale;
    const faces: DetectedFace[] = detected.map((face) => {
      const box = face.boundingBox;
      return {
        x: Math.round(box.x * inv),
        y: Math.round(box.y * inv),
        width: Math.round(box.width * inv),
        height: Math.round(box.height * inv),
      };
    });

    return { available: true, faces };
  } catch {
    // API present but failed (permissions, backend missing, etc.)
    return { available: false, faces: null };
  }
}
