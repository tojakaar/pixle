import type { Segmenter } from "../Segmenter";
import {
  IMPLEMENTED_SEMANTIC_LABELS,
  mapAdeLabelToPixle,
  type ImplementedSemanticLabel,
} from "../labelMap";
import type { Mask, MaskBounds, MaskCollection } from "../types";
import { emptyMaskCollection } from "../types";
import { perfLog, perfTime } from "../../perf";
import {
  recordFeasibilityMetric,
  sampleJsHeap,
} from "../../../platform/feasibilityMetrics";

const MODEL_ID = "Xenova/segformer-b0-finetuned-ade-512-512";

/** Tracks first vs warm inference for the iOS feasibility spike. */
let firstInferDone = false;

/** Soft edge radius after nearest-neighbour upsample (working-buffer pixels). */
const FEATHER_RADIUS = 2;

/** Drop masks covering less than this fraction of the image. */
const MIN_COVERAGE = 0.008;

type PipelineFn = (
  input: unknown,
) => Promise<
  Array<{
    label: string;
    score: number | null;
    mask: {
      data: Uint8Array | Uint8ClampedArray | Float32Array;
      width: number;
      height: number;
      channels?: number;
    };
  }>
>;

let pipelinePromise: Promise<PipelineFn> | null = null;
let loadMs: number | null = null;

async function getSegmentationPipeline(): Promise<PipelineFn> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const end = perfTime("segformer model load");
      const t0 = performance.now();
      const { env, pipeline } = await import("@huggingface/transformers");

      const isBrowser =
        typeof window !== "undefined" && typeof document !== "undefined";

      // Browser: Cache API. Node/tests: filesystem cache under /tmp.
      env.allowLocalModels = false;
      env.useBrowserCache = isBrowser;
      env.useFSCache = !isBrowser;
      if (!isBrowser) {
        env.cacheDir = "/tmp/pixle-transformers-cache";
      }

      try {
        // proxy moves ORT WASM into a worker when SharedArrayBuffer is available.
        if (isBrowser) {
          (env.backends.onnx.wasm as { proxy?: boolean }).proxy = true;
        }
      } catch {
        // Older runtime shapes — ignore.
      }

      const segmenter = (await pipeline(
        "image-segmentation",
        MODEL_ID,
        {
          dtype: "q8",
        },
      )) as unknown as PipelineFn;

      loadMs = performance.now() - t0;
      end();
      perfLog(`[pixle segformer] model ready in ${loadMs.toFixed(0)}ms`);
      recordFeasibilityMetric("segformer_load_ms", Math.round(loadMs));
      sampleJsHeap();
      return segmenter;
    })().catch((error) => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

/**
 * Neural semantic Segmenter (SegFormer-B0 ADE20K via Transformers.js / ONNX).
 *
 * Emits Pixle labels only — ADE class names never leave this module.
 * Swap for MobileSAM / FastSAM / etc. by implementing the same Segmenter interface.
 */
export function createSegformerSegmenter(): Segmenter {
  return {
    id: "segformer-b0-ade20k",
    displayName: "SegFormer-B0 (ADE20K)",
    supportedLabels: IMPLEMENTED_SEMANTIC_LABELS,
    async segment(image) {
      return segmentWithSegformer(image);
    },
  };
}

export function getSegformerLoadMs(): number | null {
  return loadMs;
}

async function segmentWithSegformer(
  image: ImageData,
): Promise<MaskCollection> {
  const { width, height } = image;
  if (width < 8 || height < 8) {
    return emptyMaskCollection(width, height);
  }

  let segmenter: PipelineFn;
  try {
    segmenter = await getSegmentationPipeline();
  } catch (error) {
    console.warn("[pixle segformer] model unavailable", error);
    return emptyMaskCollection(width, height);
  }

  const endInfer = perfTime(
    `segformer infer ${width}x${height}`,
  );
  const t0 = performance.now();

  try {
    const { RawImage } = await import("@huggingface/transformers");
    // Copy — RawImage may retain the buffer; never hand it the live working buffer.
    const rgba = new Uint8ClampedArray(image.data);
    const raw = new RawImage(rgba, width, height, 4);
    const outputs = await segmenter(raw);
    const inferMs = performance.now() - t0;
    endInfer();
    perfLog(
      `[pixle segformer] inference ${inferMs.toFixed(0)}ms → ${outputs?.length ?? 0} ADE classes`,
    );
    if (!firstInferDone) {
      firstInferDone = true;
      recordFeasibilityMetric(
        "segformer_first_infer_ms",
        Math.round(inferMs),
      );
    } else {
      recordFeasibilityMetric(
        "segformer_warm_infer_ms",
        Math.round(inferMs),
      );
    }
    sampleJsHeap();

    return buildPixleMasks(outputs ?? [], width, height);
  } catch (error) {
    endInfer();
    console.warn("[pixle segformer] inference failed", error);
    return emptyMaskCollection(width, height);
  }
}

function buildPixleMasks(
  outputs: Array<{
    label: string;
    score: number | null;
    mask: {
      data: Uint8Array | Uint8ClampedArray | Float32Array;
      width: number;
      height: number;
      channels?: number;
    };
  }>,
  targetWidth: number,
  targetHeight: number,
): MaskCollection {
  const accum = new Map<ImplementedSemanticLabel, Float32Array>();
  for (const label of IMPLEMENTED_SEMANTIC_LABELS) {
    accum.set(label, new Float32Array(targetWidth * targetHeight));
  }

  for (const item of outputs) {
    const pixleLabel = mapAdeLabelToPixle(item.label);
    const dest = accum.get(pixleLabel);
    if (!dest) continue;

    const src = normalizeMaskPlane(item.mask);
    const resized =
      src.width === targetWidth && src.height === targetHeight
        ? src.data
        : resizeMaskNearest(src.data, src.width, src.height, targetWidth, targetHeight);

    for (let i = 0; i < dest.length; i++) {
      const v = resized[i]!;
      if (v > dest[i]!) dest[i] = v;
    }
  }

  // Feather each group, then drop tiny regions.
  const masks: Mask[] = [];
  for (const label of IMPLEMENTED_SEMANTIC_LABELS) {
    let bitmap = accum.get(label)!;
    if (FEATHER_RADIUS > 0) {
      bitmap = boxBlur(bitmap, targetWidth, targetHeight, FEATHER_RADIUS);
    }

    let coverageCount = 0;
    let sum = 0;
    for (let i = 0; i < bitmap.length; i++) {
      const v = Math.min(1, Math.max(0, bitmap[i]!));
      bitmap[i] = v;
      if (v > 0.05) {
        coverageCount += 1;
        sum += v;
      }
    }
    const coverage = coverageCount / bitmap.length;
    if (coverage < MIN_COVERAGE) continue;

    const bounds = computeBounds(bitmap, targetWidth, targetHeight);
    if (bounds.width < 1 || bounds.height < 1) continue;

    const meanAlpha = coverageCount > 0 ? sum / coverageCount : 0;
    // Confidence from coverage + mean opacity — no fake hardcoding.
    const confidence = Math.min(
      1,
      0.35 + 0.45 * Math.min(1, coverage / 0.25) + 0.2 * meanAlpha,
    );

    masks.push({
      id: `${label}-${targetWidth}x${targetHeight}`,
      label,
      confidence,
      width: targetWidth,
      height: targetHeight,
      bitmap,
      bounds,
    });
  }

  return {
    masks,
    imageWidth: targetWidth,
    imageHeight: targetHeight,
  };
}

function normalizeMaskPlane(mask: {
  data: Uint8Array | Uint8ClampedArray | Float32Array;
  width: number;
  height: number;
  channels?: number;
}): { data: Float32Array; width: number; height: number } {
  const channels = mask.channels ?? 1;
  const { width, height, data } = mask;
  const out = new Float32Array(width * height);

  if (channels === 1) {
    let max = 0;
    for (let i = 0; i < out.length; i++) {
      const v = Number(data[i] ?? 0);
      if (v > max) max = v;
    }
    const scale = max > 1.5 ? 1 / 255 : 1;
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.min(1, Math.max(0, Number(data[i] ?? 0) * scale));
    }
  } else {
    // RGBA / multi-channel — use first channel (or alpha if present).
    const alphaOffset = channels >= 4 ? 3 : 0;
    for (let i = 0, p = 0; i < out.length; i++, p += channels) {
      const v = Number(data[p + alphaOffset] ?? 0);
      out[i] = v > 1.5 ? v / 255 : v;
    }
  }

  return { data: out, width, height };
}

function resizeMaskNearest(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * (srcH / dstH)));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * (srcW / dstW)));
      dst[y * dstW + x] = src[sy * srcW + sx]!;
    }
  }
  return dst;
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

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[y * width + Math.min(width - 1, Math.max(0, x))]!;
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / w;
      sum -= src[y * width + Math.max(0, x - radius)]!;
      sum += src[y * width + Math.min(width - 1, x + radius + 1)]!;
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x]!;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / w;
      sum -= tmp[Math.max(0, y - radius) * width + x]!;
      sum += tmp[Math.min(height - 1, y + radius + 1) * width + x]!;
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
      if ((alpha[y * width + x] ?? 0) > 0.05) {
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
