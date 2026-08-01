import type { Segmenter } from "../Segmenter";
import { emptyMaskCollection } from "../types";

/**
 * Placeholder Segmenter that matches the final interface but never invents masks.
 * Useful when no model is bundled / available — editing falls back to global.
 */
export function createStubSegmenter(): Segmenter {
  return {
    id: "stub",
    displayName: "Stub (no segmentation)",
    supportedLabels: [],
    async segment(image) {
      return emptyMaskCollection(image.width, image.height);
    },
  };
}
