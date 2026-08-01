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

const HSL_CHANNELS: (keyof HslBand)[] = ["hue", "saturation", "luminance"];

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
}

/**
 * Conversational photo-edit interface.
 *
 * Calls the Tauri/Rust backend, which talks to an OpenAI-compatible API using
 * server-side environment variables. The API key never enters the frontend.
 * Image understanding is provided as compact local `ImageAnalysis` metadata —
 * never full-resolution pixels. Gemini never segments or returns masks.
 * Only `parameters` (+ optional `target` label) are applied to the image.
 */
export async function editFromPrompt(
  prompt: string,
  currentParameters: EditParameters,
  imageAnalysis: ImageAnalysis,
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
    // Unknown labels are treated as global rather than rejecting the whole edit.
    console.warn(
      `[pixle ai] unsupported target "${value}"; applying as global edit. Known: ${SEMANTIC_TARGET_LABELS.join(", ")}`,
    );
    return null;
  }
  return normalized;
}

/**
 * Validate LLM/backend JSON before applying it to the UI.
 * Accepts the EditParameters schema plus optional `edit_summary` and `target`.
 * Rejects other unexpected fields (including image payloads / masks).
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

  for (const key of keys) {
    const allowed =
      SCALAR_EDIT_KEYS.includes(key as ScalarEditParameterKey) ||
      key === "hsl" ||
      key === EDIT_SUMMARY_KEY ||
      key === TARGET_KEY;
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

  return { parameters, target, editSummary };
}

export function parseEditParameters(value: unknown): EditParameters {
  return parseEditResponse(value).parameters;
}

const GEMINI_BUSY_MESSAGE =
  "Gemini is temporarily busy. Please try again in a moment.";

/** Map provider overload / 503 payloads to a short UI-safe message. */
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
