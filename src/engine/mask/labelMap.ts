/**
 * Maps SegFormer / ADE20K class names onto Pixle's small high-quality
 * semantic region set. Unknown ADE classes fall into `background`.
 *
 * The renderer never sees ADE labels — only these Pixle labels.
 */

/** Regions this neural Segmenter emits with quality intent. */
export const IMPLEMENTED_SEMANTIC_LABELS = [
  "sky",
  "person",
  "vegetation",
  "water",
  "buildings",
  "ground",
  "background",
] as const;

export type ImplementedSemanticLabel =
  (typeof IMPLEMENTED_SEMANTIC_LABELS)[number];

/**
 * ADE20K label → Pixle semantic label.
 * Multiple ADE classes merge into one soft mask (OR / max).
 */
export const ADE20K_TO_PIXLE: Record<string, ImplementedSemanticLabel> = {
  // Sky
  sky: "sky",

  // Person
  person: "person",

  // Vegetation
  tree: "vegetation",
  grass: "vegetation",
  plant: "vegetation",
  palm: "vegetation",
  flower: "vegetation",
  field: "vegetation",

  // Water
  water: "water",
  sea: "water",
  river: "water",
  lake: "water",
  waterfall: "water",
  "swimming pool": "water",
  fountain: "water",

  // Buildings / structures
  building: "buildings",
  house: "buildings",
  skyscraper: "buildings",
  wall: "buildings",
  column: "buildings",
  tower: "buildings",
  hovel: "buildings",
  bridge: "buildings",
  fence: "buildings",
  railing: "buildings",

  // Ground / terrain
  earth: "ground",
  road: "ground",
  sidewalk: "ground",
  floor: "ground",
  sand: "ground",
  path: "ground",
  "dirt track": "ground",
  land: "ground",
  rock: "ground",
  mountain: "ground",
  hill: "ground",
  rug: "ground",
};

/**
 * Gemini / user synonyms → implemented Pixle labels.
 * Unmapped names fall through as-is (then fail lookup → global edit).
 */
export const SEMANTIC_LABEL_ALIASES: Record<string, ImplementedSemanticLabel> = {
  trees: "vegetation",
  grass: "vegetation",
  flowers: "vegetation",
  plant: "vegetation",
  plants: "vegetation",
  foliage: "vegetation",
  forest: "vegetation",
  clouds: "sky",
  cloud: "sky",
  mountains: "ground",
  mountain: "ground",
  hill: "ground",
  hills: "ground",
  road: "ground",
  roads: "ground",
  face: "person",
  skin: "person",
  hair: "person",
  eyes: "person",
  people: "person",
  portrait: "person",
  building: "buildings",
  house: "buildings",
  architecture: "buildings",
  sea: "water",
  lake: "water",
  river: "water",
  ocean: "water",
  bg: "background",
};

/** Resolve a Gemini/user target to an implemented label, if possible. */
export function resolveSemanticLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return key;
  if ((IMPLEMENTED_SEMANTIC_LABELS as readonly string[]).includes(key)) {
    return key;
  }
  return SEMANTIC_LABEL_ALIASES[key] ?? key;
}

export function mapAdeLabelToPixle(
  adeLabel: string,
): ImplementedSemanticLabel {
  const key = adeLabel.trim().toLowerCase();
  return ADE20K_TO_PIXLE[key] ?? "background";
}
