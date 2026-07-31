import { invoke } from "@tauri-apps/api/core";
import {
  EDIT_SLIDER_CONFIG,
  type EditParameterKey,
  type EditParameters,
  type ImageAnalysis,
} from "./engine";

const EDIT_PARAMETER_KEYS: EditParameterKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "temperature",
  "tint",
  "saturation",
];

/** Optional model note; never applied as an image parameter. */
const EDIT_SUMMARY_KEY = "edit_summary";

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

  for (const key of EDIT_PARAMETER_KEYS) {
    if (!(key in record)) {
      throw new Error(`Missing required field \`${key}\`.`);
    }
  }

  for (const key of keys) {
    const allowed =
      EDIT_PARAMETER_KEYS.includes(key as EditParameterKey) ||
      key === EDIT_SUMMARY_KEY;
    if (!allowed) {
      throw new Error(`Unexpected field \`${key}\` in EditParameters.`);
    }
  }

  const parameters = {} as EditParameters;
  for (const key of EDIT_PARAMETER_KEYS) {
    const rawValue = record[key];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(`Field \`${key}\` must be a finite number.`);
    }
    parameters[key] = clampParam(key, rawValue);
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

function clampParam(key: EditParameterKey, value: number): number {
  const { min, max, step } = EDIT_SLIDER_CONFIG[key];
  const clamped = Math.min(max, Math.max(min, value));
  if (step >= 1) {
    return Math.round(clamped);
  }
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number(clamped.toFixed(decimals));
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
