/**
 * Smoke-test SegFormer Segmenter + MaskProvider cache/resample.
 * Requires network on first run (downloads ~13MB ONNX).
 *
 *   npx tsx scripts/segformer-smoke.mts
 */
import { createSegformerSegmenter } from "../src/engine/mask/providers/segformerSegmenter.ts";
import { createMaskProvider } from "../src/engine/mask/MaskProvider.ts";
import { applyEdits } from "../src/engine/render.ts";
import {
  DEFAULT_EDIT_PARAMETERS,
  cloneEditParameters,
} from "../src/engine/EditParameters.ts";

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight?: number,
    maybeHeight?: number,
  ) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight ?? 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight ?? 0;
      this.height = maybeHeight ?? 0;
    }
  }
}
(globalThis as unknown as { ImageData: typeof FakeImageData }).ImageData =
  FakeImageData;

function makeLandscape(w = 256, h = 192): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y < h * 0.4) {
        data[i] = 95;
        data[i + 1] = 155;
        data[i + 2] = 235;
      } else if (y < h * 0.55) {
        data[i] = 70;
        data[i + 1] = 140;
        data[i + 2] = 70;
      } else {
        data[i] = 120;
        data[i + 1] = 95;
        data[i + 2] = 55;
      }
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

const img = makeLandscape();
const provider = createMaskProvider(createSegformerSegmenter());

console.log("prefetch…");
const t0 = performance.now();
const collection = await provider.prefetch(img);
const prefetchMs = performance.now() - t0;
console.log(
  `prefetch ${prefetchMs.toFixed(0)}ms → ${collection.masks.length} masks:`,
  collection.masks.map((m) => `${m.label}@${m.confidence.toFixed(2)}`),
);

const t1 = performance.now();
const again = await provider.getMasks(img);
const cacheMs = performance.now() - t1;
console.log(`cache reuse ${cacheMs.toFixed(1)}ms (same ref: ${again === collection})`);

const sky = provider.getCachedLabel("sky", 512, 384);
const trees = provider.getCachedLabel("trees"); // alias → vegetation
console.log(
  "sky resampled",
  sky ? `${sky.width}x${sky.height}` : null,
  "trees→",
  trees?.label ?? null,
);

if (sky) {
  const params = cloneEditParameters(DEFAULT_EDIT_PARAMETERS);
  params.exposure = -0.5;
  const out = applyEdits(img, params, {
    mask: provider.getCachedLabel("sky", img.width, img.height)!,
    baseParameters: DEFAULT_EDIT_PARAMETERS,
  });
  const skyIdx = 8 * img.width + 8;
  const groundIdx = (img.height - 4) * img.width + 8;
  console.log(
    "sky darkened",
    out.data[skyIdx * 4]! < img.data[skyIdx * 4]!,
    "ground same-ish",
    Math.abs(out.data[groundIdx * 4]! - img.data[groundIdx * 4]!) < 3,
  );
}

console.log("status", provider.status);
console.log("OK");
