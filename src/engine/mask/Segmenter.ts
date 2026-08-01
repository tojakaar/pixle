import type { MaskCollection } from "./types";

/**
 * Pluggable segmentation backend.
 *
 * Implementations may use classical heuristics, ONNX (MobileSAM / EfficientSAM),
 * Florence-2, Grounded-SAM, or a cloud API. Callers depend only on this interface.
 *
 * Gemini must never implement Segmenter — it only names a semantic target.
 */
export interface Segmenter {
  /** Stable provider id, e.g. "sky-heuristic", "mobile-sam", "stub". */
  readonly id: string;
  readonly displayName: string;
  /** Labels this provider can emit. Unsupported labels are simply absent. */
  readonly supportedLabels: readonly string[];
  /**
   * Segment `image` into zero or more soft masks.
   * Must not throw for “nothing found” — return an empty collection instead.
   */
  segment(image: ImageData): Promise<MaskCollection>;
}
