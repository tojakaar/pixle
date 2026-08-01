import type { Segmenter } from "./Segmenter";
import { resolveSemanticLabel } from "./labelMap";
import { resampleMask } from "./resample";
import {
  emptyMaskCollection,
  findMaskByLabel,
  type Mask,
  type MaskCollection,
} from "./types";
import { perfLog } from "../perf";

export type MaskProviderStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "empty";

export type MaskProviderStatusListener = (status: MaskProviderStatus) => void;

/**
 * Thin façade over a Segmenter with a per-image session cache.
 *
 * - Segment once per opened image (working buffer).
 * - Parameter edits reuse the cache.
 * - Export resamples cached masks — does not re-run the model.
 * - Prefetch is cancellable when the user opens another image.
 */
export interface MaskProvider {
  readonly segmenter: Segmenter;
  /** Current async status for UI / debug. */
  readonly status: MaskProviderStatus;
  /** Segment (or return cached masks) for this ImageData identity. */
  getMasks(image: ImageData): Promise<MaskCollection>;
  /** Highest-confidence mask for `label`, or null if unavailable. */
  findLabel(image: ImageData, label: string): Promise<Mask | null>;
  /**
   * Read a cached mask (optionally resampled) without inference.
   * Returns null when the cache is empty / label missing.
   */
  getCachedLabel(
    label: string,
    targetWidth?: number,
    targetHeight?: number,
  ): Mask | null;
  /** Cached collection at working resolution, or null. */
  getCachedCollection(): MaskCollection | null;
  /**
   * Begin background segmentation for `image`.
   * Cancels any in-flight job for a previous image.
   */
  prefetch(image: ImageData, signal?: AbortSignal): Promise<MaskCollection>;
  /** Drop cached masks and cancel in-flight work. */
  clearCache(): void;
  onStatusChange(listener: MaskProviderStatusListener): () => void;
}

interface CacheEntry {
  image: ImageData;
  collection: MaskCollection;
  /** Wall-clock duration of the segment() call that produced this cache. */
  inferMs: number;
}

export function createMaskProvider(segmenter: Segmenter): MaskProvider {
  let cache: CacheEntry | null = null;
  let status: MaskProviderStatus = "idle";
  let inflight: Promise<MaskCollection> | null = null;
  let inflightImage: ImageData | null = null;
  let generation = 0;
  const listeners = new Set<MaskProviderStatusListener>();

  function setStatus(next: MaskProviderStatus): void {
    if (status === next) return;
    status = next;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error) {
        console.warn("[pixle mask] status listener failed", error);
      }
    }
  }

  async function runSegment(
    image: ImageData,
    gen: number,
    signal?: AbortSignal,
  ): Promise<MaskCollection> {
    if (signal?.aborted) {
      return emptyMaskCollection(image.width, image.height);
    }

    setStatus("loading");
    const t0 = performance.now();
    let collection: MaskCollection;
    try {
      collection = await segmenter.segment(image);
    } catch (error) {
      console.warn(
        `[pixle mask] segmenter "${segmenter.id}" failed; falling back to empty masks`,
        error,
      );
      collection = emptyMaskCollection(image.width, image.height);
      if (gen === generation && !signal?.aborted) {
        setStatus("error");
      }
      return collection;
    }

    if (signal?.aborted || gen !== generation) {
      return collection;
    }

    const inferMs = performance.now() - t0;
    cache = { image, collection, inferMs };
    inflight = null;
    inflightImage = null;

    const labelList = collection.masks.map((m) => m.label).join(", ") || "(none)";
    perfLog(
      `[pixle mask] cached ${collection.masks.length} masks in ${inferMs.toFixed(0)}ms: ${labelList}`,
    );

    setStatus(collection.masks.length > 0 ? "ready" : "empty");
    return collection;
  }

  async function getMasks(image: ImageData): Promise<MaskCollection> {
    if (cache && cache.image === image) {
      return cache.collection;
    }
    if (inflight && inflightImage === image) {
      return inflight;
    }

    const gen = ++generation;
    const promise = runSegment(image, gen);
    inflight = promise;
    inflightImage = image;
    return promise;
  }

  return {
    segmenter,
    get status() {
      return status;
    },

    getMasks,

    async findLabel(image, label) {
      const collection = await getMasks(image);
      const resolved = resolveSemanticLabel(label);
      return findMaskByLabel(collection, resolved);
    },

    getCachedLabel(label, targetWidth, targetHeight) {
      if (!cache) return null;
      const resolved = resolveSemanticLabel(label);
      const mask = findMaskByLabel(cache.collection, resolved);
      if (!mask) return null;
      if (
        targetWidth == null ||
        targetHeight == null ||
        (mask.width === targetWidth && mask.height === targetHeight)
      ) {
        return mask;
      }
      return resampleMask(mask, targetWidth, targetHeight);
    },

    getCachedCollection() {
      return cache?.collection ?? null;
    },

    async prefetch(image, signal) {
      if (cache && cache.image === image) {
        setStatus(cache.collection.masks.length > 0 ? "ready" : "empty");
        return cache.collection;
      }

      // Cancel obsolete work by bumping generation; previous awaits ignore results.
      const gen = ++generation;
      const promise = runSegment(image, gen, signal);
      inflight = promise;
      inflightImage = image;

      if (signal) {
        const onAbort = () => {
          if (gen === generation) {
            generation += 1;
            inflight = null;
            inflightImage = null;
            setStatus("idle");
          }
        };
        if (signal.aborted) {
          onAbort();
          return emptyMaskCollection(image.width, image.height);
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      return promise;
    },

    clearCache() {
      generation += 1;
      cache = null;
      inflight = null;
      inflightImage = null;
      setStatus("idle");
    },

    onStatusChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
