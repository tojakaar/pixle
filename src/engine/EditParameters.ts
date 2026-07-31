/**
 * All non-destructive edit adjustments for a photo.
 * Values are relative to a neutral midpoint of 0 (no change).
 */
export interface EditParameters {
  /** EV stops; typically -2 … +2 */
  exposure: number;
  /** Contrast strength; typically -100 … +100 */
  contrast: number;
  /** Bright-region lift/cut; typically -100 … +100 */
  highlights: number;
  /** Dark-region lift/cut; typically -100 … +100 */
  shadows: number;
  /** Cool (−) / warm (+); typically -100 … +100 */
  temperature: number;
  /** Green (−) / magenta (+); typically -100 … +100 */
  tint: number;
  /** Desaturate (−) / boost (+); typically -100 … +100 */
  saturation: number;
}

export const DEFAULT_EDIT_PARAMETERS: EditParameters = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
};

export type EditParameterKey = keyof EditParameters;

export const EDIT_SLIDER_CONFIG: Record<
  EditParameterKey,
  { label: string; min: number; max: number; step: number }
> = {
  exposure: { label: "Exposure", min: -2, max: 2, step: 0.01 },
  contrast: { label: "Contrast", min: -100, max: 100, step: 1 },
  highlights: { label: "Highlights", min: -100, max: 100, step: 1 },
  shadows: { label: "Shadows", min: -100, max: 100, step: 1 },
  temperature: { label: "Temperature", min: -100, max: 100, step: 1 },
  tint: { label: "Tint", min: -100, max: 100, step: 1 },
  saturation: { label: "Saturation", min: -100, max: 100, step: 1 },
};
