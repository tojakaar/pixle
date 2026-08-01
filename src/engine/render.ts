import type {
  EditParameters,
  HslAdjustments,
  HslBand,
  HslColorName,
} from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  HSL_COLOR_NAMES,
  cloneEditParameters,
} from "./EditParameters";
import { perfTime } from "./perf";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ken Perlin's smootherstep — C2 continuous, no ringing. */
function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// —— Reusable working buffers (avoid per-render allocations) ——

let sharedFloatRgb: Float32Array | null = null;
let sharedFloatLen = 0;
let sharedChannel: Float32Array | null = null;
let sharedChannelLen = 0;

function acquireFloatRgb(len: number): Float32Array {
  if (!sharedFloatRgb || sharedFloatLen < len) {
    sharedFloatRgb = new Float32Array(len);
    sharedFloatLen = len;
  }
  return sharedFloatRgb;
}

function acquireChannel(len: number): Float32Array {
  if (!sharedChannel || sharedChannelLen < len) {
    sharedChannel = new Float32Array(len);
    sharedChannelLen = len;
  }
  return sharedChannel;
}

// —— Colour space helpers ——

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  if (s <= 0) {
    return { r: l, g: l, b: l };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = hh / 360;
  return {
    r: hueToRgb(p, q, hk + 1 / 3),
    g: hueToRgb(p, q, hk),
    b: hueToRgb(p, q, hk - 1 / 3),
  };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const HSL_CENTERS: Record<HslColorName, number> = {
  red: 0,
  orange: 30,
  yellow: 55,
  green: 120,
  aqua: 180,
  blue: 225,
  purple: 275,
  magenta: 315,
};

/** Slightly tighter sigma keeps neighbour spill controlled after strength boost. */
const HSL_SIGMA = 26;

/** ~25% stronger perceived HSL response vs. the prior scales. */
const HSL_HUE_RANGE = 38; // degrees at full slider
const HSL_SAT_SCALE = 1.25;
const HSL_LUM_SCALE = 0.32;

function hueWeight(pixelHue: number, center: number): number {
  const d = hueDistance(pixelHue, center);
  return Math.exp(-(d * d) / (2 * HSL_SIGMA * HSL_SIGMA));
}

function hslBandActive(band: HslBand): boolean {
  return band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0;
}

function anyHslActive(hsl: HslAdjustments): boolean {
  for (const name of HSL_COLOR_NAMES) {
    if (hslBandActive(hsl[name])) return true;
  }
  return false;
}

function applyHslBands(
  r: number,
  g: number,
  b: number,
  hsl: HslAdjustments,
): { r: number; g: number; b: number } {
  const { h, s, l } = rgbToHsl(r, g, b);

  let hueShift = 0;
  let satMul = 0;
  let lumAdd = 0;
  let weightSum = 0;

  for (const name of HSL_COLOR_NAMES) {
    const band = hsl[name];
    if (!hslBandActive(band)) continue;
    const w = hueWeight(h, HSL_CENTERS[name]);
    if (w < 0.012) continue;
    weightSum += w;
    hueShift += w * (band.hue / 100) * HSL_HUE_RANGE;
    satMul += w * (band.saturation / 100) * HSL_SAT_SCALE;
    lumAdd += w * (band.luminance / 100) * HSL_LUM_SCALE;
  }

  if (weightSum < 0.012) {
    return { r, g, b };
  }

  // Soft-normalise overlaps without over-diluting mid-band weights.
  const inv = 1 / Math.max(0.75, weightSum);
  hueShift *= inv;
  satMul *= inv;
  lumAdd *= inv;

  // Mild skin safeguard: restrain extreme orange/red saturation push.
  const skinDist = hueDistance(h, 35);
  if (skinDist < 40 && satMul > 0) {
    const protect = 1 - ((40 - skinDist) / 40) * 0.35;
    satMul *= protect;
  }

  const nextH = h + hueShift;
  const nextS = clamp01(s * (1 + satMul));
  const nextL = clamp01(l + lumAdd);
  return hslToRgb(nextH, nextS, nextL);
}

// —— Tone response ——

function applyToneCurve(value: number, contrast: number): number {
  const c = contrast / 100;
  const x = clamp01(value);
  const s = x * x * (3 - 2 * x);
  const blended = x + (s - x) * (c * 0.65);
  const factor = Math.tan(((c + 1) * Math.PI) / 4);
  return (blended - 0.5) * factor + 0.5;
}

function applyHighlightsShadows(
  r: number,
  g: number,
  b: number,
  highlights: number,
  shadows: number,
  whites: number,
  blacks: number,
): { r: number; g: number; b: number } {
  const lum = luminance(r, g, b);
  const highlightMask = lum * lum;
  const shadowMask = (1 - lum) * (1 - lum);
  const whiteMask = highlightMask * highlightMask;
  const blackMask = shadowMask * shadowMask;

  const hs =
    highlightMask * (highlights / 100) * -0.55 +
    shadowMask * (shadows / 100) * 0.55;
  const wb =
    whiteMask * (whites / 100) * 0.4 + blackMask * (blacks / 100) * 0.45;
  const recover =
    highlights < 0 ? highlightMask * (-highlights / 100) * 0.15 : 0;

  return {
    r: r + hs + wb - recover * Math.max(0, r - 0.75),
    g: g + hs + wb - recover * Math.max(0, g - 0.75),
    b: b + hs + wb - recover * Math.max(0, b - 0.75),
  };
}

function applyFade(
  r: number,
  g: number,
  b: number,
  fade: number,
): { r: number; g: number; b: number } {
  if (fade <= 0) return { r, g, b };
  const t = fade / 100;
  const lift = t * 0.18;
  const compress = 1 - t * 0.12;
  return {
    r: r * compress + lift,
    g: g * compress + lift,
    b: b * compress + lift,
  };
}

function applyVibrance(
  r: number,
  g: number,
  b: number,
  vibrance: number,
): { r: number; g: number; b: number } {
  if (vibrance === 0) return { r, g, b };
  const { h, s } = rgbToHsl(r, g, b);
  const gray = luminance(r, g, b);
  const skinDist = hueDistance(h, 35);
  const skinProtect = skinDist < 50 ? clamp01(1 - (50 - skinDist) / 50) : 1;
  const mutedBias = 1 - s;
  const amount = (vibrance / 100) * mutedBias * (0.35 + 0.65 * skinProtect);
  const satFactor = 1 + amount;
  return {
    r: gray + (r - gray) * satFactor,
    g: gray + (g - gray) * satFactor,
    b: gray + (b - gray) * satFactor,
  };
}

function applySaturation(
  r: number,
  g: number,
  b: number,
  saturation: number,
): { r: number; g: number; b: number } {
  if (saturation === 0) return { r, g, b };
  const gray = luminance(r, g, b);
  const satFactor = 1 + saturation / 100;
  return {
    r: gray + (r - gray) * satFactor,
    g: gray + (g - gray) * satFactor,
    b: gray + (b - gray) * satFactor,
  };
}

// —— Spatial filters ——

function boxBlurChannel(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius < 1) return src;
  const tmp = acquireChannel(src.length);
  // tmp may alias sharedChannel — need a second buffer for out.
  const out = new Float32Array(src.length);
  const w = width;
  const h = height;
  const r = Math.max(1, Math.floor(radius));

  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) {
      const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
      sum += src[row + xx]!;
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (r * 2 + 1);
      const removeX = x - r;
      const addX = x + r + 1;
      const rx = removeX < 0 ? 0 : removeX;
      const ax = addX >= w ? w - 1 : addX;
      sum += src[row + ax]! - src[row + rx]!;
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
      sum += tmp[yy * w + x]!;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (r * 2 + 1);
      const removeY = y - r;
      const addY = y + r + 1;
      const ry = removeY < 0 ? 0 : removeY;
      const ay = addY >= h ? h - 1 : addY;
      sum += tmp[ay * w + x]! - tmp[ry * w + x]!;
    }
  }

  return out;
}

function applySpatialDetail(
  buffer: Float32Array,
  width: number,
  height: number,
  clarity: number,
  sharpening: number,
  lumaNr: number,
  chromaNr: number,
): void {
  const needsClarity = clarity !== 0;
  const needsSharpen = sharpening > 0;
  const needsLumaNr = lumaNr > 0;
  const needsChromaNr = chromaNr > 0;
  if (!needsClarity && !needsSharpen && !needsLumaNr && !needsChromaNr) {
    return;
  }

  const n = width * height;
  const rCh = new Float32Array(n);
  const gCh = new Float32Array(n);
  const bCh = new Float32Array(n);
  const yCh = new Float32Array(n);

  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const r = buffer[p]!;
    const g = buffer[p + 1]!;
    const b = buffer[p + 2]!;
    rCh[i] = r;
    gCh[i] = g;
    bCh[i] = b;
    yCh[i] = luminance(r, g, b);
  }

  if (needsClarity) {
    const radius = Math.max(1, Math.round(Math.min(width, height) * 0.012));
    const blurred = boxBlurChannel(yCh, width, height, radius);
    const amount = (clarity / 100) * 0.55;
    for (let i = 0; i < n; i++) {
      const y = yCh[i]!;
      const midMask = 1 - Math.abs(y - 0.5) * 2;
      const delta = (y - blurred[i]!) * amount * Math.max(0, midMask);
      rCh[i]! += delta;
      gCh[i]! += delta;
      bCh[i]! += delta;
      yCh[i]! = y + delta;
    }
  }

  if (needsSharpen) {
    const blurred = boxBlurChannel(yCh, width, height, 1);
    const amount = (sharpening / 100) * 0.7;
    for (let i = 0; i < n; i++) {
      const delta = (yCh[i]! - blurred[i]!) * amount;
      rCh[i]! += delta;
      gCh[i]! += delta;
      bCh[i]! += delta;
    }
  }

  if (needsLumaNr) {
    const radius = Math.max(1, Math.round(1 + (lumaNr / 100) * 2));
    const blurredY = boxBlurChannel(yCh, width, height, radius);
    const t = (lumaNr / 100) * 0.85;
    for (let i = 0; i < n; i++) {
      const y = yCh[i]!;
      const by = blurredY[i]!;
      const scale = y > 1e-6 ? (y * (1 - t) + by * t) / y : 1;
      rCh[i]! *= scale;
      gCh[i]! *= scale;
      bCh[i]! *= scale;
      yCh[i] = y * (1 - t) + by * t;
    }
  }

  if (needsChromaNr) {
    const radius = Math.max(1, Math.round(1 + (chromaNr / 100) * 3));
    const blurR = boxBlurChannel(rCh, width, height, radius);
    const blurG = boxBlurChannel(gCh, width, height, radius);
    const blurB = boxBlurChannel(bCh, width, height, radius);
    const t = (chromaNr / 100) * 0.9;
    for (let i = 0; i < n; i++) {
      const y = luminance(rCh[i]!, gCh[i]!, bCh[i]!);
      const br = blurR[i]!;
      const bg = blurG[i]!;
      const bb = blurB[i]!;
      const by = luminance(br, bg, bb);
      const mixedR = rCh[i]! * (1 - t) + (br - by + y) * t;
      const mixedG = gCh[i]! * (1 - t) + (bg - by + y) * t;
      const mixedB = bCh[i]! * (1 - t) + (bb - by + y) * t;
      const my = luminance(mixedR, mixedG, mixedB);
      const corr = y - my;
      rCh[i] = mixedR + corr;
      gCh[i] = mixedG + corr;
      bCh[i] = mixedB + corr;
    }
  }

  for (let i = 0, p = 0; i < n; i++, p += 3) {
    buffer[p] = rCh[i]!;
    buffer[p + 1] = gCh[i]!;
    buffer[p + 2] = bCh[i]!;
  }
}

// —— Vignette (smooth optical falloff) ——

/**
 * Analytic radial falloff in normalised image coordinates.
 * Uses smootherstep (C2) to avoid rings/banding; aspect-aware so the oval
 * follows the frame. Negative amount darkens edges; positive lightens.
 */
function vignetteMul(
  x: number,
  y: number,
  width: number,
  height: number,
  amount: number,
  midpoint: number,
  feather: number,
): number {
  if (amount === 0) return 1;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const nx = (x + 0.5 - cx) / Math.max(cx, 1e-6);
  const ny = (y + 0.5 - cy) / Math.max(cy, 1e-6);
  // 0 at centre, 1 at mid-edges, √2 at corners.
  const dist = Math.sqrt(nx * nx + ny * ny);
  const inner = (midpoint / 100) * 1.25;
  const soft = Math.max(0.08, (feather / 100) * 1.35 + 0.08);
  const t = smootherstep((dist - inner) / soft);
  return 1 - t * (amount / 100) * 0.72;
}

// —— Film grain (fine high-frequency, deterministic) ——

/** Stable integer hash → [0, 1). */
function hash2(ix: number, iy: number, salt: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(salt, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

/** Approx unit Gaussian via Box–Muller on two hashes (uncorrelated per cell). */
function gaussianGrain(ix: number, iy: number, salt: number): number {
  const u1 = Math.max(1e-6, hash2(ix, iy, salt));
  const u2 = hash2(ix, iy, salt + 17);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

/**
 * Fine photographic grain — dominant high-frequency luminance, optional weak
 * medium octave (nearest, never bilinear), restrained chroma via grainColor.
 *
 * Coordinates are integer pixel cells scaled by grainSize so preview and
 * export share perceived scale without upscaling a texture.
 */
function sampleFilmGrain(
  x: number,
  y: number,
  size: number,
  roughness: number,
): { luma: number; cr: number; cg: number; cb: number } {
  // size 0 → ~1px grains; size 100 → ~3px cells (still fine, never cloudy).
  const cell = 1 + (size / 100) * 2.2;
  const ix = Math.floor(x / cell);
  const iy = Math.floor(y / cell);

  const fine = gaussianGrain(ix, iy, 101);
  // Weak medium octave — nearest-neighbour only (no smooth value noise).
  const mx = Math.floor(ix / 2);
  const my = Math.floor(iy / 2);
  const medium = gaussianGrain(mx, my, 202) * 0.18;

  // Roughness: more hard spikes vs slightly softened fine grain.
  const rough = roughness / 100;
  const hard = gaussianGrain(ix, iy, 303);
  const luma = (fine * (1 - rough) + hard * rough) * 0.88 + medium * (0.12 + rough * 0.08);

  // Chroma grain amplitude stays well below luma.
  const cr = gaussianGrain(ix, iy, 404) * 0.45;
  const cg = gaussianGrain(ix, iy, 505) * 0.45;
  const cb = gaussianGrain(ix, iy, 606) * 0.45;

  return { luma, cr, cg, cb };
}

function applyGrainPixel(
  r: number,
  g: number,
  b: number,
  x: number,
  y: number,
  amount: number,
  size: number,
  roughness: number,
  grainColor: number,
): { r: number; g: number; b: number } {
  const sample = sampleFilmGrain(x, y, size, roughness);
  // Curve amount so 20–30 is subtle, 40–60 clear, 70–100 strong but film-like.
  const t = amount / 100;
  const strength = t * t * 0.14 + t * 0.16;
  const lum = luminance(r, g, b);
  // Mild midtone bias; never cloud-modulate with low-frequency masks.
  const midMask = 0.55 + 0.45 * (4 * lum * (1 - lum));

  const colorMix = (grainColor / 100) * 0.55;
  const lumaG = sample.luma;
  const grainR = lumaG * (1 - colorMix) + sample.cr * colorMix;
  const grainG = lumaG * (1 - colorMix) + sample.cg * colorMix;
  const grainB = lumaG * (1 - colorMix) + sample.cb * colorMix;

  const amp = strength * midMask;
  return {
    r: r + grainR * amp * (0.65 + r * 0.35),
    g: g + grainG * amp * (0.65 + g * 0.35),
    b: b + grainB * amp * (0.65 + b * 0.35),
  };
}

/** Tiny triangular dither to break smooth-gradient banding before 8-bit quantise. */
function ditherNoise(x: number, y: number): number {
  return (hash2(x, y, 909) - 0.5) * (1 / 255);
}

// —— Pipeline ——

function needsSpatial(params: EditParameters): boolean {
  return (
    params.clarity !== 0 ||
    params.sharpening > 0 ||
    params.luminanceNoiseReduction > 0 ||
    params.chromaNoiseReduction > 0
  );
}

/**
 * Applies `params` to a copy of `source`. The original `ImageData` is never mutated.
 *
 * Processing order:
 * 1. Exposure
 * 2. Contrast / gentle S-curve
 * 3. Highlights / shadows / whites / blacks
 * 4. Fade
 * 5. Temperature / tint
 * 6. Per-colour HSL
 * 7. Vibrance
 * 8. Saturation
 * 9. Clarity / sharpening / noise reduction
 * 10. Vignette
 * 11. Procedural film grain
 *
 * TODO(workers): Move applyEdits into a Web Worker + OffscreenCanvas when the
 * Tauri WebKitGTK webview path is verified reliable. Until then, preview uses
 * rAF-coalesced main-thread renders with generation tokens to drop stale work.
 */
export function applyEdits(
  source: ImageData,
  params: EditParameters,
): ImageData {
  const end = perfTime(
    `applyEdits ${source.width}x${source.height}` +
      (params.grainAmount > 0 ? " grain" : "") +
      (params.vignetteAmount !== 0 ? " vig" : ""),
  );

  const width = source.width;
  const height = source.height;
  const src = source.data;
  const pixelCount = width * height;

  const needsExposure = params.exposure !== 0;
  const needsContrast = params.contrast !== 0;
  const needsTone =
    params.highlights !== 0 ||
    params.shadows !== 0 ||
    params.whites !== 0 ||
    params.blacks !== 0;
  const needsFade = params.fade > 0;
  const needsWb = params.temperature !== 0 || params.tint !== 0;
  const hslActive = anyHslActive(params.hsl);
  const needsVibrance = params.vibrance !== 0;
  const needsSaturation = params.saturation !== 0;
  const spatial = needsSpatial(params);
  const needsGrain = params.grainAmount > 0;
  const needsVignette = params.vignetteAmount !== 0;

  const exposureMul = needsExposure ? Math.pow(2, params.exposure) : 1;
  const temperature = params.temperature / 100;
  const tint = params.tint / 100;

  const needsFloatBuffer = spatial || needsGrain || needsVignette;
  const output = new ImageData(width, height);
  const dst = output.data;

  if (!needsFloatBuffer) {
    // Fast path: single pass straight to 8-bit when no spatial/grain/vignette.
    for (let i = 0; i < src.length; i += 4) {
      let r = src[i]! / 255;
      let g = src[i + 1]! / 255;
      let b = src[i + 2]! / 255;

      if (needsExposure) {
        r *= exposureMul;
        g *= exposureMul;
        b *= exposureMul;
      }
      if (needsContrast) {
        r = applyToneCurve(r, params.contrast);
        g = applyToneCurve(g, params.contrast);
        b = applyToneCurve(b, params.contrast);
      }
      if (needsTone) {
        ({ r, g, b } = applyHighlightsShadows(
          r,
          g,
          b,
          params.highlights,
          params.shadows,
          params.whites,
          params.blacks,
        ));
      }
      if (needsFade) ({ r, g, b } = applyFade(r, g, b, params.fade));
      if (needsWb) {
        r += temperature * 0.15 - tint * 0.08;
        g += tint * 0.12;
        b += -temperature * 0.15 - tint * 0.04;
      }
      r = clamp01(r);
      g = clamp01(g);
      b = clamp01(b);
      if (hslActive) ({ r, g, b } = applyHslBands(r, g, b, params.hsl));
      if (needsVibrance) ({ r, g, b } = applyVibrance(r, g, b, params.vibrance));
      if (needsSaturation) {
        ({ r, g, b } = applySaturation(r, g, b, params.saturation));
      }

      dst[i] = clampByte(clamp01(r) * 255);
      dst[i + 1] = clampByte(clamp01(g) * 255);
      dst[i + 2] = clampByte(clamp01(b) * 255);
      dst[i + 3] = src[i + 3]!;
    }
    end();
    return output;
  }

  const buffer = acquireFloatRgb(pixelCount * 3);

  for (let i = 0, p = 0; i < src.length; i += 4, p += 3) {
    let r = src[i]! / 255;
    let g = src[i + 1]! / 255;
    let b = src[i + 2]! / 255;

    if (needsExposure) {
      r *= exposureMul;
      g *= exposureMul;
      b *= exposureMul;
    }
    if (needsContrast) {
      r = applyToneCurve(r, params.contrast);
      g = applyToneCurve(g, params.contrast);
      b = applyToneCurve(b, params.contrast);
    }
    if (needsTone) {
      ({ r, g, b } = applyHighlightsShadows(
        r,
        g,
        b,
        params.highlights,
        params.shadows,
        params.whites,
        params.blacks,
      ));
    }
    if (needsFade) ({ r, g, b } = applyFade(r, g, b, params.fade));
    if (needsWb) {
      r += temperature * 0.15 - tint * 0.08;
      g += tint * 0.12;
      b += -temperature * 0.15 - tint * 0.04;
    }

    r = clamp01(r);
    g = clamp01(g);
    b = clamp01(b);

    if (hslActive) ({ r, g, b } = applyHslBands(r, g, b, params.hsl));
    if (needsVibrance) ({ r, g, b } = applyVibrance(r, g, b, params.vibrance));
    if (needsSaturation) {
      ({ r, g, b } = applySaturation(r, g, b, params.saturation));
    }

    buffer[p] = r;
    buffer[p + 1] = g;
    buffer[p + 2] = b;
  }

  if (spatial) {
    applySpatialDetail(
      buffer,
      width,
      height,
      params.clarity,
      params.sharpening,
      params.luminanceNoiseReduction,
      params.chromaNoiseReduction,
    );
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pix = y * width + x;
      const p = pix * 3;
      const i = pix * 4;
      let r = buffer[p]!;
      let g = buffer[p + 1]!;
      let b = buffer[p + 2]!;

      if (needsVignette) {
        const vf = vignetteMul(
          x,
          y,
          width,
          height,
          params.vignetteAmount,
          params.vignetteMidpoint,
          params.vignetteFeather,
        );
        r *= vf;
        g *= vf;
        b *= vf;
      }

      if (needsGrain) {
        ({ r, g, b } = applyGrainPixel(
          r,
          g,
          b,
          x,
          y,
          params.grainAmount,
          params.grainSize,
          params.grainRoughness,
          params.grainColor,
        ));
      }

      // Micro-dither on smooth vignette/tone paths to reduce 8-bit banding.
      const dither =
        needsVignette || needsFade ? ditherNoise(x, y) : 0;

      dst[i] = clampByte(clamp01(r + dither) * 255);
      dst[i + 1] = clampByte(clamp01(g + dither) * 255);
      dst[i + 2] = clampByte(clamp01(b + dither) * 255);
      dst[i + 3] = src[i + 3]!;
    }
  }

  end();
  return output;
}

function hslEqual(a: HslAdjustments, b: HslAdjustments): boolean {
  for (const name of HSL_COLOR_NAMES) {
    const aa = a[name];
    const bb = b[name];
    if (
      aa.hue !== bb.hue ||
      aa.saturation !== bb.saturation ||
      aa.luminance !== bb.luminance
    ) {
      return false;
    }
  }
  return true;
}

/** True when every parameter is at its default (identity) value. */
export function isIdentityEdit(params: EditParameters): boolean {
  const d = DEFAULT_EDIT_PARAMETERS;
  return (
    params.exposure === d.exposure &&
    params.contrast === d.contrast &&
    params.highlights === d.highlights &&
    params.shadows === d.shadows &&
    params.whites === d.whites &&
    params.blacks === d.blacks &&
    params.fade === d.fade &&
    params.temperature === d.temperature &&
    params.tint === d.tint &&
    params.saturation === d.saturation &&
    params.vibrance === d.vibrance &&
    params.grainAmount === d.grainAmount &&
    params.clarity === d.clarity &&
    params.sharpening === d.sharpening &&
    params.luminanceNoiseReduction === d.luminanceNoiseReduction &&
    params.chromaNoiseReduction === d.chromaNoiseReduction &&
    params.vignetteAmount === d.vignetteAmount &&
    hslEqual(params.hsl, d.hsl)
  );
}

export { cloneEditParameters };
