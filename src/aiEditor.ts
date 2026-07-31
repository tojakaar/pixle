import {
  EDIT_SLIDER_CONFIG,
  type EditParameterKey,
  type EditParameters,
} from "./engine";

/**
 * Conversational photo-edit interface.
 *
 * The UI depends only on this function signature. Replace the mock body with an
 * OpenAI-compatible API client later — no UI changes required.
 */
export async function editFromPrompt(
  prompt: string,
  currentParameters: EditParameters,
): Promise<EditParameters> {
  // Simulate a short network round-trip so the UI can show a pending state.
  await delay(180);
  return applyMockInstructions(prompt, currentParameters);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function adjust(
  params: EditParameters,
  deltas: Partial<EditParameters>,
): EditParameters {
  const next: EditParameters = { ...params };
  for (const key of Object.keys(deltas) as EditParameterKey[]) {
    const delta = deltas[key];
    if (delta === undefined) continue;
    next[key] = clampParam(key, params[key] + delta);
  }
  return next;
}

/**
 * Lightweight keyword matcher for local development.
 * Intentionally small and deterministic — not a real language model.
 */
function applyMockInstructions(
  prompt: string,
  currentParameters: EditParameters,
): EditParameters {
  const text = prompt.trim().toLowerCase();
  if (!text) {
    return { ...currentParameters };
  }

  let next = { ...currentParameters };

  const rules: Array<{ pattern: RegExp; deltas: Partial<EditParameters> }> = [
    {
      pattern: /\b(brighter|brighten|increase exposure|more exposure|lighten)\b/,
      deltas: { exposure: 0.4 },
    },
    {
      pattern: /\b(darker|darken|decrease exposure|less exposure|dimmer)\b/,
      deltas: { exposure: -0.4 },
    },
    {
      pattern: /\b(warmer|warm(?:\s+tones?)?|increase temperature)\b/,
      deltas: { temperature: 25 },
    },
    {
      pattern: /\b(cooler|colder|cool(?:\s+tones?)?|decrease temperature)\b/,
      deltas: { temperature: -25 },
    },
    {
      pattern:
        /\b(recover(?:\s+the)?\s+highlights?|pull(?:\s+back)?\s+highlights?|fix\s+highlights?)\b/,
      deltas: { highlights: -30 },
    },
    {
      pattern: /\b(increase contrast|more contrast|boost contrast)\b/,
      deltas: { contrast: 25 },
    },
    {
      pattern: /\b(decrease contrast|less contrast|lower contrast)\b/,
      deltas: { contrast: -25 },
    },
    {
      pattern:
        /\b(more vibrant|increase saturation|more saturated|boost(?:\s+the)?\s+colors?|vibran(?:t|ce))\b/,
      deltas: { saturation: 30 },
    },
    {
      pattern:
        /\b(less vibrant|decrease saturation|desaturate|more muted|mute(?:d)?\s+colors?)\b/,
      deltas: { saturation: -30 },
    },
    {
      pattern:
        /\b(lift(?:\s+the)?\s+shadows?|open(?:\s+up)?\s+shadows?|recover(?:\s+the)?\s+shadows?)\b/,
      deltas: { shadows: 30 },
    },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      next = adjust(next, rule.deltas);
    }
  }

  return next;
}
