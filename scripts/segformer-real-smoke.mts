import { RawImage, env } from "@huggingface/transformers";
import { createSegformerSegmenter } from "../src/engine/mask/providers/segformerSegmenter.ts";
import { createMaskProvider } from "../src/engine/mask/MaskProvider.ts";
import { getSegformerLoadMs } from "../src/engine/mask/providers/segformerSegmenter.ts";

env.useBrowserCache = false;
env.useFSCache = true;
env.cacheDir = "/tmp/pixle-transformers-cache";

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(
    a: Uint8ClampedArray | number,
    b?: number,
    c?: number,
  ) {
    if (typeof a === "number") {
      this.width = a;
      this.height = b ?? 0;
      this.data = new Uint8ClampedArray(a * (b ?? 0) * 4);
    } else {
      this.data = a;
      this.width = b ?? 0;
      this.height = c ?? 0;
    }
  }
}
(globalThis as unknown as { ImageData: typeof FakeImageData }).ImageData =
  FakeImageData;

const url =
  "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/house.jpg";
const raw = await RawImage.read(url);
const rgba = raw.rgba();
const img = new ImageData(
  new Uint8ClampedArray(rgba.data),
  rgba.width,
  rgba.height,
);
console.log("image", img.width, "x", img.height);

const provider = createMaskProvider(createSegformerSegmenter());
const t0 = performance.now();
const c1 = await provider.prefetch(img);
const first = performance.now() - t0;
const t1 = performance.now();
await provider.getMasks(img);
const second = performance.now() - t1;

console.log("modelLoadMs", getSegformerLoadMs()?.toFixed(0) ?? "n/a");
console.log("first infer+map", `${first.toFixed(0)}ms`);
console.log("cache reuse", `${second.toFixed(1)}ms`);
console.log(
  c1.masks
    .map((m) => {
      const cov =
        m.bitmap.reduce((a, b) => a + (b > 0.5 ? 1 : 0), 0) / m.bitmap.length;
      return `${m.label}: cov=${cov.toFixed(3)} conf=${m.confidence.toFixed(2)}`;
    })
    .join("\n"),
);
console.log(
  "aliases",
  "trees→",
  provider.getCachedLabel("trees")?.label ?? null,
  "buildings→",
  provider.getCachedLabel("buildings")?.label ?? null,
);
console.log("OK");
