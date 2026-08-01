import type { Segmenter } from "./Segmenter";
import {
  emptyMaskCollection,
  findMaskByLabel,
  type Mask,
  type MaskCollection,
} from "./types";

/**
 * Thin façade over a Segmenter with a per-image cache.
 * Swap the underlying Segmenter without touching the renderer or UI.
 */
export interface MaskProvider {
  readonly segmenter: Segmenter;
  /** Segment (or return cached masks) for this ImageData identity. */
  getMasks(image: ImageData): Promise<MaskCollection>;
  /** Highest-confidence mask for `label`, or null if unavailable. */
  findLabel(image: ImageData, label: string): Promise<Mask | null>;
  /** Drop cached masks (e.g. after opening a new image). */
  clearCache(): void;
}

interface CacheEntry {
  image: ImageData;
  collection: MaskCollection;
}

export function createMaskProvider(segmenter: Segmenter): MaskProvider {
  let cache: CacheEntry | null = null;

  async function getMasks(image: ImageData): Promise<MaskCollection> {
    if (cache && cache.image === image) {
      return cache.collection;
    }
    let collection: MaskCollection;
    try {
      collection = await segmenter.segment(image);
    } catch (error) {
      console.warn(
        `[pixle mask] segmenter "${segmenter.id}" failed; falling back to empty masks`,
        error,
      );
      collection = emptyMaskCollection(image.width, image.height);
    }
    cache = { image, collection };
    return collection;
  }

  return {
    segmenter,
    getMasks,
    async findLabel(image, label) {
      const collection = await getMasks(image);
      return findMaskByLabel(collection, label);
    },
    clearCache() {
      cache = null;
    },
  };
}
