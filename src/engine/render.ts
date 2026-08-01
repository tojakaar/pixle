import type { EditParameters, HslAdjustments, HslBand, HslColorName } from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  HSL_COLOR_NAMES,
  cloneEditParameters,
} from "./EditParameters";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

/** Soft circular distance on the hue wheel (degrees). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Overlapping smooth hue weights — no hard band boundaries.
 * Centres sit ~45° apart; Gaussian falloff keeps neighbouring bands blended.
 */
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

/** Approximate half-width (degrees) where weight falls to ~e^-2. */
const HSL_SIGMA = 28;

function hueWeight(pixelHue: number, center: number): number {
  const d = hueDistance(pixelHue, center);
  const w = Math.exp(-(d * d) / (2 * HSL_SIGMA * HSL_SIGMA));
  return w;
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
  if (s < 0.002) {
    // Near-gray: luminance-only contributions still apply lightly via weak weights.
  }

  let hueShift = 0;
  let satMul = 0;
  let lumAdd = 0;
  let weightSum = 0;

  for (const name of HSL_COLOR_NAMES) {
    const band = hsl[name];
    if (!hslBandActive(band)) continue;
    const w = hueWeight(h, HSL_CENTERS[name]);
    if (w < 0.01) continue;
    weightSum += w;
    hueShift += w * (band.hue / 100) * 30; // ±30° at full slider
    satMul += w * (band.saturation / 100);
    lumAdd += w * (band.luminance / 100) * 0.25;
  }

  if (weightSum < 0.01) {
    return { r, g, b };
  }

  // Normalise so overlapping bands don't overshoot wildly.
  const inv = 1 / Math.max(1, weightSum);
  hueShift *= inv;
  satMul *= inv;
  lumAdd *= inv;

  const nextH = h + hueShift;
  const nextS = clamp01(s * (1 + satMul));
  const nextL = clamp01(l + lumAdd);
  return hslToRgb(nextH, nextS, nextL);
}

// —— Tone response ——

/**
 * Gentle parametric S-curve + highlight compression.
 * Contrast drives the S; no freeform curve UI.
 */
function applyToneCurve(value: number, contrast: number): number {
  const c = contrast / 100;
  // Mild S via smoothstep-ish pivot around mid-gray.
  const x = clamp01(value);
  const s = x * x * (3 - 2 * x);
  const blended = x + (s - x) * (c * 0.65);
  // Classic contrast pivot.
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
  // Extreme tips use tighter masks.
  const whiteMask = highlightMask * highlightMask;
  const blackMask = shadowMask * shadowMask;

  // Negative highlights compress / recover; positive push.
  const hs =
    highlightMask * (highlights / 100) * -0.55 +
    shadowMask * (shadows / 100) * 0.55;
  const wb =
    whiteMask * (whites / 100) * 0.4 + blackMask * (blacks / 100) * 0.45;

  // Soft highlight rolloff when recovering.
  const recover = highlights < 0 ? highlightMask * (-highlights / 100) * 0.15 : 0;

  return {
    r: r + hs + wb - recover * Math.max(0, r - 0.75),
    g: g + hs + wb - recover * Math.max(0, g - 0.75),
    b: b + hs + wb - recover * Math.max(0, b - 0.75),
  };
}

/** Lifted blacks / faded film — raises the floor and softens deep contrast. */
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

// —— Vibrance ——

/**
 * Vibrance boosts muted colours more than saturated ones and protects skin
 * (orange–red hues). Saturation is applied separately as a linear multiplier.
 */
function applyVibrance(
  r: number,
  g: number,
  b: number,
  vibrance: number,
): { r: number; g: number; b: number } {
  if (vibrance === 0) return { r, g, b };
  const { h, s } = rgbToHsl(r, g, b);
  const gray = luminance(r, g, b);

  // Skin protection: reduce effect near orange/red skin hues.
  const skinDist = hueDistance(h, 35);
  const skinProtect = skinDist < 50 ? clamp01(1 - (50 - skinDist) / 50) : 1;
  // Already-saturated colours get less boost.
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

// —— Spatial filters (clarity / sharpen / NR) ——

function boxBlurChannel(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = width;
  const h = height;
  const r = Math.max(1, Math.floor(radius));

  // Horizontal
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

  // Vertical
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

  // Clarity: midtone local contrast via unsharp of a medium blur.
  if (needsClarity) {
    const radius = Math.max(1, Math.round(Math.min(width, height) * 0.012));
    const blurred = boxBlurChannel(yCh, width, height, radius);
    const amount = (clarity / 100) * 0.55;
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const y = yCh[i]!;
      // Protect deep shadows / specular tips.
      const midMask = 1 - Math.abs(y - 0.5) * 2;
      const delta = (y - blurred[i]!) * amount * Math.max(0, midMask);
      rCh[i]! += delta;
      gCh[i]! += delta;
      bCh[i]! += delta;
      yCh[i]! = y + delta;
    }
  }

  // Sharpening: fine unsharp mask.
  if (needsSharpen) {
    const radius = 1;
    const blurred = boxBlurChannel(yCh, width, height, radius);
    const amount = (sharpening / 100) * 0.7;
    for (let i = 0; i < n; i++) {
      const delta = (yCh[i]! - blurred[i]!) * amount;
      rCh[i]! += delta;
      gCh[i]! += delta;
      bCh[i]! += delta;
    }
  }

  // Luminance NR: blend toward blurred luma.
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

  // Chroma NR: blur chroma while keeping luma.
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
      // Mix chroma (deviation from gray) toward blurred chroma.
      const mixedR = rCh[i]! * (1 - t) + (br - by + y) * t;
      const mixedG = gCh[i]! * (1 - t) + (bg - by + y) * t;
      const mixedB = bCh[i]! * (1 - t) + (bb - by + y) * t;
      // Re-anchor luma.
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

// —— Vignette ——

function vignetteFactor(
  x: number,
  y: number,
  width: number,
  height: number,
  amount: number,
  midpoint: number,
  feather: number,
): number {
  if (amount === 0) return 1;
  const cx = (width - 1) * 0.5;
  const cy = (height - 1) * 0.5;
  const nx = (x - cx) / (cx || 1);
  const ny = (y - cy) / (cy || 1);
  const dist = Math.sqrt(nx * nx + ny * ny);
  const inner = (midpoint / 100) * 1.1;
  const soft = Math.max(0.05, feather / 100);
  const t = clamp01((dist - inner) / soft);
  // Smoothstep falloff.
  const edge = t * t * (3 - 2 * t);
  const strength = (amount / 100) * 0.65;
  // Negative amount darkens edges; positive lightens (white vignette).
  return 1 - edge * strength;
}

// —— Procedural film grain ——

/** Deterministic 2D hash → [0, 1). Same inputs always match across preview/export. */
function hash2(ix: number, iy: number, salt: number): number {
  let n = (ix * 374761393 + iy * 668265263 + salt * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value-noise sample with bilinear interpolation for finer grain. */
function valueNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = hash2(x0, y0, salt);
  const v10 = hash2(x0 + 1, y0, salt);
  const v01 = hash2(x0, y0 + 1, salt);
  const v11 = hash2(x0 + 1, y0 + 1, salt);
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const a = v00 * (1 - sx) + v10 * sx;
  const b = v01 * (1 - sx) + v11 * sx;
  return a * (1 - sy) + b * sy;
}

/**
 * Photographic grain: multi-octave, luma-weighted, optional chroma.
 * Coordinates are resolution-relative so preview and export share visual scale.
 */
function sampleGrain(
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  roughness: number,
): { mono: number; r: number; g: number; b: number } {
  // Map size 0…100 → frequency. Fine grain = high frequency.
  const minEdge = Math.min(width, height);
  const scale = minEdge / (6 + (size / 100) * 40);
  const px = (x / minEdge) * scale;
  const py = (y / minEdge) * scale;

  const rough = roughness / 100;
  // Soft octave
  const n1 = valueNoise(px, py, 101);
  // Harder octave
  const n2 = hash2(Math.floor(px * 2), Math.floor(py * 2), 202);
  const mono = n1 * (1 - rough) + n2 * rough;

  // Mildly correlated colour channels for film-like chroma grain.
  const cr = valueNoise(px * 1.07, py * 0.97, 303);
  const cg = valueNoise(px * 0.95, py * 1.05, 404);
  const cb = valueNoise(px * 1.02, py * 1.11, 505);

  return { mono, r: cr, g: cg, b: cb };
}

function applyGrainPixel(
  r: number,
  g: number,
  b: number,
  x: number,
  y: number,
  width: number,
  height: number,
  amount: number,
  size: number,
  roughness: number,
  grainColor: number,
): { r: number; g: number; b: number } {
  if (amount <= 0) return { r, g, b };
  const gSample = sampleGrain(x, y, width, height, size, roughness);
  const strength = (amount / 100) * 0.28;
  const lum = luminance(r, g, b);
  // Film grain is most visible in midtones, quieter in deep blacks / speculars.
  const midMask = 4 * lum * (1 - lum);
  const mask = 0.25 + 0.75 * midMask;

  const colorMix = grainColor / 100;
  const monoCentered = (gSample.mono - 0.5) * 2;
  const rG = (gSample.r - 0.5) * 2;
  const gG = (gSample.g - 0.5) * 2;
  const bG = (gSample.b - 0.5) * 2;

  const grainR = monoCentered * (1 - colorMix) + rG * colorMix;
  const grainG = monoCentered * (1 - colorMix) + gG * colorMix;
  const grainB = monoCentered * (1 - colorMix) + bG * colorMix;

  // Multiply-ish blend keeps grain photographic rather than chalky overlay.
  const amp = strength * mask;
  return {
    r: r * (1 + grainR * amp) + grainR * amp * 0.08,
    g: g * (1 + grainG * amp) + grainG * amp * 0.08,
    b: b * (1 + grainB * amp) + grainB * amp * 0.08,
  };
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
 * 4. Fade (lifted blacks)
 * 5. Temperature / tint
 * 6. Per-colour HSL
 * 7. Vibrance
 * 8. Saturation
 * 9. Clarity / sharpening / noise reduction
 * 10. Vignette
 * 11. Procedural grain
 */
export function applyEdits(
  source: ImageData,
  params: EditParameters,
): ImageData {
  const width = source.width;
  const height = source.height;
  const src = source.data;
  const pixelCount = width * height;

  const exposureMul = Math.pow(2, params.exposure);
  const temperature = params.temperature / 100;
  const tint = params.tint / 100;
  const hslActive = anyHslActive(params.hsl);
  const spatial = needsSpatial(params);

  // Working buffer in linear-ish 0…1 RGB (3 channels).
  const buffer = new Float32Array(pixelCount * 3);

  for (let i = 0, p = 0; i < src.length; i += 4, p += 3) {
    let r = (src[i]! / 255) * exposureMul;
    let g = (src[i + 1]! / 255) * exposureMul;
    let b = (src[i + 2]! / 255) * exposureMul;

    r = applyToneCurve(r, params.contrast);
    g = applyToneCurve(g, params.contrast);
    b = applyToneCurve(b, params.contrast);

    ({ r, g, b } = applyHighlightsShadows(
      r,
      g,
      b,
      params.highlights,
      params.shadows,
      params.whites,
      params.blacks,
    ));

    ({ r, g, b } = applyFade(r, g, b, params.fade));

    // White balance
    r += temperature * 0.15 - tint * 0.08;
    g += tint * 0.12;
    b += -temperature * 0.15 - tint * 0.04;

    r = clamp01(r);
    g = clamp01(g);
    b = clamp01(b);

    if (hslActive) {
      ({ r, g, b } = applyHslBands(r, g, b, params.hsl));
    }

    ({ r, g, b } = applyVibrance(r, g, b, params.vibrance));
    ({ r, g, b } = applySaturation(r, g, b, params.saturation));

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

  const output = new ImageData(width, height);
  const dst = output.data;
  const amount = params.grainAmount;
  const vigAmount = params.vignetteAmount;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pix = y * width + x;
      const p = pix * 3;
      const i = pix * 4;
      let r = buffer[p]!;
      let g = buffer[p + 1]!;
      let b = buffer[p + 2]!;

      if (vigAmount !== 0) {
        const vf = vignetteFactor(
          x,
          y,
          width,
          height,
          vigAmount,
          params.vignetteMidpoint,
          params.vignetteFeather,
        );
        r *= vf;
        g *= vf;
        b *= vf;
      }

      if (amount > 0) {
        ({ r, g, b } = applyGrainPixel(
          r,
          g,
          b,
          x,
          y,
          width,
          height,
          amount,
          params.grainSize,
          params.grainRoughness,
          params.grainColor,
        ));
      }

      dst[i] = clampByte(clamp01(r) * 255);
      dst[i + 1] = clampByte(clamp01(g) * 255);
      dst[i + 2] = clampByte(clamp01(b) * 255);
      dst[i + 3] = src[i + 3]!;
    }
  }

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
    // grainSize / roughness / color only matter when amount > 0
    params.clarity === d.clarity &&
    params.sharpening === d.sharpening &&
    params.luminanceNoiseReduction === d.luminanceNoiseReduction &&
    params.chromaNoiseReduction === d.chromaNoiseReduction &&
    params.vignetteAmount === d.vignetteAmount &&
    hslEqual(params.hsl, d.hsl)
  );
}

export { cloneEditParameters };
