import { invoke } from "@tauri-apps/api/core";
import {
  HSL_COLOR_NAMES,
  SCALAR_EDIT_KEYS,
  SEMANTIC_TARGET_LABELS,
  clampHslChannel,
  clampScalarParam,
  createDefaultHsl,
  isSemanticTargetLabel,
  shortenEditSummary,
  type EditParameters,
  type EditSessionContext,
  type HslBand,
  type HslColorName,
  type ImageAnalysis,
  type ScalarEditParameterKey,
  type SemanticTargetLabel,
} from "./engine";

/** Optional model note; never applied as an image parameter. */
const EDIT_SUMMARY_KEY = "edit_summary";
/** Optional semantic region label; never a bitmap / pixel payload. */
const TARGET_KEY = "target";
const INTENT_KEY = "intent";
const ADJUST_FACTOR_KEY = "adjust_factor";
const CLARIFICATION_KEY = "clarification";
const REFERENCE_TARGET_KEY = "reference_target";

const HSL_CHANNELS: (keyof HslBand)[] = ["hue", "saturation", "luminance"];

export type EditIntent =
  | "edit"
  | "adjust_previous"
  | "undo_previous"
  | "redo_previous"
  | "clarify";

export interface EditFromPromptResult {
  /** Values applied to the non-destructive edit pipeline. */
  parameters: EditParameters;
  /**
   * Semantic region to edit locally, or null for a global edit.
   * Gemini names the target only — segmentation happens locally via Segmenter.
   */
  target: SemanticTargetLabel | null;
  /** Short explanation from the model, if provided. */
  editSummary?: string;
  /** Conversational intent relative to the EditSession. */
  intent: EditIntent;
  /** Scale for adjust_previous (e.g. 1.25 = a little more). */
  adjustFactor?: number;
  /** Concise clarification question when intent is clarify. */
  clarification?: string;
  /** Which prior target an adjust/undo refers to, when not the active one. */
  referenceTarget?: string | null;
}

/**
 * Conversational photo-edit interface.
 *
 * Optional `sessionContext` carries the active EditAction + recent summaries
 * so follow-ups ("a little more") resolve without resending image history.
 */
export async function editFromPrompt(
  prompt: string,
  currentParameters: EditParameters,
  imageAnalysis: ImageAnalysis,
  sessionContext?: EditSessionContext | null,
): Promise<EditFromPromptResult> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Prompt must not be empty.");
  }

  let raw: unknown;
  try {
    raw = await invoke<unknown>("edit_from_prompt", {
      prompt: trimmed,
      currentParameters,
      imageAnalysis,
      sessionContext: sessionContext ?? null,
    });
  } catch (error) {
    throw new Error(formatInvokeError(error));
  }

  return parseEditResponse(raw);
}

function parseHslBand(value: unknown, color: HslColorName): HslBand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Field \`hsl.${color}\` must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const channel of HSL_CHANNELS) {
    if (!(channel in record)) {
      throw new Error(`Missing required field \`hsl.${color}.${channel}\`.`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!HSL_CHANNELS.includes(key as keyof HslBand)) {
      throw new Error(`Unexpected field \`hsl.${color}.${key}\`.`);
    }
  }
  const band = {} as HslBand;
  for (const channel of HSL_CHANNELS) {
    const rawValue = record[channel];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(
        `Field \`hsl.${color}.${channel}\` must be a finite number.`,
      );
    }
    band[channel] = clampHslChannel(channel, rawValue);
  }
  return band;
}

function parseTarget(value: unknown): SemanticTargetLabel | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Field `target` must be a string or null when present.");
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "global" || normalized === "none") {
    return null;
  }
  if (!isSemanticTargetLabel(normalized)) {
    console.warn(
      `[pixle ai] unsupported target "${value}"; applying as global edit. Known: ${SEMANTIC_TARGET_LABELS.join(", ")}`,
    );
    return null;
  }
  return normalized;
}

function parseIntent(value: unknown): EditIntent {
  if (value === null || value === undefined) return "edit";
  if (typeof value !== "string") {
    throw new Error("Field `intent` must be a string when present.");
  }
  const normalized = value.trim().toLowerCase();
  const allowed: EditIntent[] = [
    "edit",
    "adjust_previous",
    "undo_previous",
    "redo_previous",
    "clarify",
  ];
  if ((allowed as string[]).includes(normalized)) {
    return normalized as EditIntent;
  }
  return "edit";
}

/**
 * Validate LLM/backend JSON before applying it to the UI.
 * Accepts EditParameters plus optional conversational fields.
 */
export function parseEditResponse(value: unknown): EditFromPromptResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EditParameters must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  for (const key of SCALAR_EDIT_KEYS) {
    if (!(key in record)) {
      throw new Error(`Missing required field \`${key}\`.`);
    }
  }
  if (!("hsl" in record)) {
    throw new Error("Missing required field `hsl`.");
  }

  const optionalKeys = new Set([
    EDIT_SUMMARY_KEY,
    TARGET_KEY,
    INTENT_KEY,
    ADJUST_FACTOR_KEY,
    CLARIFICATION_KEY,
    REFERENCE_TARGET_KEY,
  ]);

  for (const key of keys) {
    const allowed =
      SCALAR_EDIT_KEYS.includes(key as ScalarEditParameterKey) ||
      key === "hsl" ||
      optionalKeys.has(key);
    if (!allowed) {
      throw new Error(`Unexpected field \`${key}\` in EditParameters.`);
    }
  }

  const parameters = {
    hsl: createDefaultHsl(),
  } as EditParameters;

  for (const key of SCALAR_EDIT_KEYS) {
    const rawValue = record[key];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(`Field \`${key}\` must be a finite number.`);
    }
    parameters[key] = clampScalarParam(key, rawValue);
  }

  const hslRaw = record.hsl;
  if (hslRaw === null || typeof hslRaw !== "object" || Array.isArray(hslRaw)) {
    throw new Error("Field `hsl` must be an object.");
  }
  const hslRecord = hslRaw as Record<string, unknown>;
  for (const color of HSL_COLOR_NAMES) {
    if (!(color in hslRecord)) {
      throw new Error(`Missing required field \`hsl.${color}\`.`);
    }
  }
  for (const key of Object.keys(hslRecord)) {
    if (!HSL_COLOR_NAMES.includes(key as HslColorName)) {
      throw new Error(`Unexpected field \`hsl.${key}\`.`);
    }
  }
  for (const color of HSL_COLOR_NAMES) {
    parameters.hsl[color] = parseHslBand(hslRecord[color], color);
  }

  let editSummary: string | undefined;
  if (EDIT_SUMMARY_KEY in record) {
    const summary = record[EDIT_SUMMARY_KEY];
    if (summary === null || summary === undefined) {
      editSummary = undefined;
    } else if (typeof summary !== "string") {
      throw new Error("Field `edit_summary` must be a string when present.");
    } else {
      editSummary = shortenEditSummary(summary);
    }
  }

  const target =
    TARGET_KEY in record ? parseTarget(record[TARGET_KEY]) : null;
  const intent =
    INTENT_KEY in record ? parseIntent(record[INTENT_KEY]) : "edit";

  let adjustFactor: number | undefined;
  if (ADJUST_FACTOR_KEY in record && record[ADJUST_FACTOR_KEY] != null) {
    const raw = record[ADJUST_FACTOR_KEY];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error("Field `adjust_factor` must be a finite number.");
    }
    adjustFactor = Math.min(3, Math.max(0.05, raw));
  }

  let clarification: string | undefined;
  if (CLARIFICATION_KEY in record && record[CLARIFICATION_KEY] != null) {
    const raw = record[CLARIFICATION_KEY];
    if (typeof raw !== "string") {
      throw new Error("Field `clarification` must be a string when present.");
    }
    clarification = raw.trim().slice(0, 160) || undefined;
  }

  let referenceTarget: string | null | undefined;
  if (REFERENCE_TARGET_KEY in record) {
    referenceTarget = parseTarget(record[REFERENCE_TARGET_KEY]);
  }

  if (intent === "clarify" && !clarification) {
    clarification = "Which edit did you mean?";
  }

  return {
    parameters,
    target,
    editSummary,
    intent,
    adjustFactor,
    clarification,
    referenceTarget,
  };
}

export function parseEditParameters(value: unknown): EditParameters {
  return parseEditResponse(value).parameters;
}

const GEMINI_BUSY_MESSAGE =
  "Gemini is temporarily busy. Please try again in a moment.";

function isProviderUnavailable(message: string): boolean {
  const upper = message.toUpperCase();
  return (
    upper.includes("503") ||
    upper.includes("UNAVAILABLE") ||
    upper.includes("TEMPORARILY BUSY")
  );
}

function formatInvokeError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    if (isProviderUnavailable(error)) {
      console.warn("[pixle ai] provider unavailable:", error);
      return GEMINI_BUSY_MESSAGE;
    }
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    if (isProviderUnavailable(error.message)) {
      console.warn("[pixle ai] provider unavailable:", error.message);
      return GEMINI_BUSY_MESSAGE;
    }
    return error.message;
  }
  return "AI edit request failed.";
}
