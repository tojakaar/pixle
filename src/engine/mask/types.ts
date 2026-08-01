/**
 * Model-agnostic soft masks for semantic local editing.
 *
 * The rendering engine receives these bitmaps without knowing whether they
 * came from a classical sky detector, MobileSAM, Florence-2, or a stub.
 */

export interface MaskBounds {
  /** Inclusive left edge in mask bitmap coordinates. */
  x: number;
  /** Inclusive top edge in mask bitmap coordinates. */
  y: number;
  width: number;
  height: number;
}

/**
 * One semantic region. `bitmap` is a soft alpha matte (0…1) in row-major order,
 * length = width * height. Values may be fractional for feathered edges.
 */
export interface Mask {
  id: string;
  /** Stable semantic label, e.g. "sky", "person". */
  label: string;
  /** Provider confidence in 0…1. */
  confidence: number;
  width: number;
  height: number;
  bitmap: Float32Array;
  bounds: MaskBounds;
}

/** All masks produced for one image by a Segmenter. */
export interface MaskCollection {
  masks: Mask[];
  /** Dimensions of the image the masks were computed for. */
  imageWidth: number;
  imageHeight: number;
}

export function emptyMaskCollection(
  imageWidth: number,
  imageHeight: number,
): MaskCollection {
  return { masks: [], imageWidth, imageHeight };
}

/** Case-insensitive label lookup; returns the highest-confidence match. */
export function findMaskByLabel(
  collection: MaskCollection,
  label: string,
): Mask | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  let best: Mask | null = null;
  for (const mask of collection.masks) {
    if (mask.label.toLowerCase() !== needle) continue;
    if (!best || mask.confidence > best.confidence) {
      best = mask;
    }
  }
  return best;
}

/**
 * Labels Gemini may request. Unknown / unsupported labels fall back to a
 * global edit — the renderer is never blocked by a missing mask.
 *
 * High-quality implemented set (SegFormer): sky, person, vegetation, water,
 * buildings, ground, background. Other names are accepted as aliases or
 * reserved for future providers.
 */
export const SEMANTIC_TARGET_LABELS = [
  "sky",
  "person",
  "vegetation",
  "water",
  "buildings",
  "ground",
  "background",
  "face",
  "skin",
  "hair",
  "eyes",
  "clouds",
  "mountains",
  "trees",
  "grass",
  "road",
  "food",
  "cup",
  "flowers",
  "animals",
  "cars",
  "foreground",
] as const;

export type SemanticTargetLabel = (typeof SEMANTIC_TARGET_LABELS)[number];

export function isSemanticTargetLabel(value: string): value is SemanticTargetLabel {
  return (SEMANTIC_TARGET_LABELS as readonly string[]).includes(value);
}
