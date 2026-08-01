import { invoke } from "@tauri-apps/api/core";
import {
  HSL_COLOR_NAMES,
  SCALAR_EDIT_KEYS,
  clampHslChannel,
  clampScalarParam,
  createDefaultHsl,
  type EditParameters,
  type HslBand,
  type HslColorName,
  type ImageAnalysis,
  type ScalarEditParameterKey,
} from "./engine";

/** Optional model note; never applied as an image parameter. */
const EDIT_SUMMARY_KEY = "edit_summary";

const HSL_CHANNELS: (keyof HslBand)[] = ["hue", "saturation", "luminance"];

export interface EditFromPromptResult {
  /** Values applied to the non-destructive edit pipeline. */
  parameters: EditParameters;
  /** Short explanation from the model, if provided. */
  editSummary?: string;
}

/**
 * Conversational photo-edit interface.
 *
 * Calls the Tauri/Rust backend, which talks to an OpenAI-compatible API using
 * server-side environment variables. The API key never enters the frontend.
 * Image understanding is provided as compact local `ImageAnalysis` metadata —
 * never full-resolution pixels.
 * Only `parameters` are applied to the image; `editSummary` is explanatory.
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

/**
 * Validate LLM/backend JSON before applying it to the UI.
 * Accepts the EditParameters schema plus optional `edit_summary`.
 * Rejects other unexpected fields (including image payloads).
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
      key === EDIT_SUMMARY_KEY;
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
      const trimmed = summary.trim();
      editSummary = trimmed ? trimmed.slice(0, 160) : undefined;
    }
  }

  return { parameters, editSummary };
}

export function parseEditParameters(value: unknown): EditParameters {
  return parseEditResponse(value).parameters;
}

function formatInvokeError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "AI edit request failed.";
}
