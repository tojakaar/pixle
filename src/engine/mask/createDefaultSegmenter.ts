import type { Segmenter } from "./Segmenter";
import { createSegformerSegmenter } from "./providers/segformerSegmenter";
import { createSkyHeuristicSegmenter } from "./providers/skyHeuristicSegmenter";
import { createStubSegmenter } from "./providers/stubSegmenter";

export type SegmenterKind = "segformer" | "sky-heuristic" | "stub";

/**
 * Resolve the active Segmenter.
 *
 * Default: SegFormer-B0 ADE20K (local ONNX via Transformers.js).
 * Overrides:
 *   VITE_PIXLE_SEGMENTER=stub
 *   VITE_PIXLE_SEGMENTER=sky-heuristic
 *   VITE_PIXLE_SEGMENTER=segformer
 */
export function createDefaultSegmenter(
  kind: SegmenterKind = resolveSegmenterKind(),
): Segmenter {
  switch (kind) {
    case "stub":
      return createStubSegmenter();
    case "sky-heuristic":
      return createSkyHeuristicSegmenter();
    case "segformer":
    default:
      return createSegformerSegmenter();
  }
}

function resolveSegmenterKind(): SegmenterKind {
  try {
    const env = import.meta.env?.VITE_PIXLE_SEGMENTER;
    if (typeof env === "string") {
      const value = env.trim().toLowerCase();
      if (value === "stub") return "stub";
      if (value === "sky-heuristic" || value === "sky") return "sky-heuristic";
      if (value === "segformer") return "segformer";
    }
  } catch {
    // Non-Vite contexts fall through to the default.
  }
  return "segformer";
}
