import { createSkyHeuristicSegmenter } from "../src/engine/mask/providers/skyHeuristicSegmenter.ts";
import { createStubSegmenter } from "../src/engine/mask/providers/stubSegmenter.ts";
import { applyEdits, isIdentityEdit } from "../src/engine/render.ts";
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

function makeSkyImage(w = 128, h = 96): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y < h * 0.45) {
        data[i] = 90;
        data[i + 1] = 150;
        data[i + 2] = 230;
        data[i + 3] = 255;
      } else {
        data[i] = 60;
        data[i + 1] = 120;
        data[i + 2] = 50;
        data[i + 3] = 255;
      }
    }
  }
  return new ImageData(data, w, h);
}

function makeNoSkyImage(w = 64, h = 64): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 140;
    data[i + 1] = 100;
    data[i + 2] = 70;
    data[i + 3] = 255;
  }
  return new ImageData(data, w, h);
}

const sky = createSkyHeuristicSegmenter();
const stub = createStubSegmenter();
const img = makeSkyImage();
const masks = await sky.segment(img);
console.log(
  "sky masks",
  masks.masks.length,
  masks.masks[0]?.confidence?.toFixed(3),
  masks.masks[0]?.label,
);
const coverage = masks.masks[0]
  ? masks.masks[0].bitmap.reduce((a, b) => a + (b > 0.5 ? 1 : 0), 0) /
    masks.masks[0].bitmap.length
  : 0;
console.log("sky coverage", coverage.toFixed(3));

const empty = await sky.segment(makeNoSkyImage());
console.log("no-sky masks", empty.masks.length);

const stubEmpty = await stub.segment(img);
console.log("stub masks", stubEmpty.masks.length);

if (!masks.masks[0]) throw new Error("expected sky mask");
const params = cloneEditParameters(DEFAULT_EDIT_PARAMETERS);
params.exposure = -0.6;
const out = applyEdits(img, params, {
  mask: masks.masks[0],
  baseParameters: DEFAULT_EDIT_PARAMETERS,
});
const skyIdx = 10 * img.width + 10;
const groundIdx = (img.height - 5) * img.width + 10;
const sample = (buf: ImageData, i: number) => [
  buf.data[i * 4],
  buf.data[i * 4 + 1],
  buf.data[i * 4 + 2],
];
console.log("sky src/out", sample(img, skyIdx), sample(out, skyIdx));
console.log("ground src/out", sample(img, groundIdx), sample(out, groundIdx));
const skyDarkened = out.data[skyIdx * 4]! < img.data[skyIdx * 4]!;
const groundSame =
  out.data[groundIdx * 4] === img.data[groundIdx * 4] &&
  out.data[groundIdx * 4 + 1] === img.data[groundIdx * 4 + 1];
console.log("skyDarkened", skyDarkened, "groundUnchanged", groundSame);
console.log("global identity", isIdentityEdit(DEFAULT_EDIT_PARAMETERS));
if (!skyDarkened || !groundSame) process.exit(1);
console.log("OK");
