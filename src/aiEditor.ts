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

/**
 * Conversational photo-edit interface.
 *
 * Calls the Tauri/Rust backend, which talks to an OpenAI-compatible API using
 * server-side environment variables. The API key never enters the frontend.
 * Image understanding is provided as compact local `ImageAnalysis` metadata —
 * never full-resolution pixels.
 * The UI depends only on this function signature.
 */
export async function editFromPrompt(
  prompt: string,
  currentParameters: EditParameters,
  imageAnalysis: ImageAnalysis,
): Promise<EditParameters> {
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

  return parseEditParameters(raw);
}

/**
 * Validate LLM/backend JSON before applying it to the UI.
 * Rejects non-objects, missing keys, non-numeric values, and unexpected fields
 * (including any attempt to return image payloads).
 */
export function parseEditParameters(value: unknown): EditParameters {
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
    if (!EDIT_PARAMETER_KEYS.includes(key as EditParameterKey)) {
      throw new Error(`Unexpected field \`${key}\` in EditParameters.`);
    }
  }

  const result = {} as EditParameters;
  for (const key of EDIT_PARAMETER_KEYS) {
    const rawValue = record[key];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(`Field \`${key}\` must be a finite number.`);
    }
    result[key] = clampParam(key, rawValue);
  }

  return result;
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
