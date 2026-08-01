import type { Segmenter } from "./Segmenter";
import { createSkyHeuristicSegmenter } from "./providers/skyHeuristicSegmenter";
import { createStubSegmenter } from "./providers/stubSegmenter";

export type SegmenterKind = "sky-heuristic" | "stub";

/**
 * Resolve the active Segmenter.
 *
 * Default: classical sky heuristic (proves one end-to-end object).
 * Set `VITE_PIXLE_SEGMENTER=stub` to force the empty stub provider.
 */
export function createDefaultSegmenter(
  kind: SegmenterKind = resolveSegmenterKind(),
): Segmenter {
  switch (kind) {
    case "stub":
      return createStubSegmenter();
    case "sky-heuristic":
    default:
      return createSkyHeuristicSegmenter();
  }
}

function resolveSegmenterKind(): SegmenterKind {
  try {
    const env = import.meta.env?.VITE_PIXLE_SEGMENTER;
    if (typeof env === "string" && env.trim().toLowerCase() === "stub") {
      return "stub";
    }
  } catch {
    // Non-Vite contexts (tests) fall through to the default.
  }
  return "sky-heuristic";
}
