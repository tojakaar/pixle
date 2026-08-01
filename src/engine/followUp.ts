import type { EditAction, EditSession } from "./editSession";
import { getActiveAction } from "./editSession";

/**
 * Local resolution of clear conversational follow-ups.
 * Ambiguous prompts return null so Gemini (with session context) can decide
 * — or ask for clarification.
 */

export type FollowUpKind =
  | "amplify"
  | "reduce"
  | "undo"
  | "redo"
  | "warmer"
  | "cooler";

export interface ResolvedFollowUp {
  kind: FollowUpKind;
  /** Scale for amplify/reduce relative to the active action delta. */
  factor?: number;
  /** Temperature nudge for warmer/cooler relative follow-ups. */
  temperatureDelta?: number;
  action: EditAction;
}

const AMPLIFY_PATTERNS: Array<{ re: RegExp; factor: number }> = [
  {
    re: /^(a little more|a bit more|slightly more|slightly stronger)\.?$/i,
    factor: 1.25,
  },
  {
    re: /^(much more|a lot more|way more|much stronger)\.?$/i,
    factor: 1.6,
  },
  {
    re: /^(more|stronger|make it stronger|make it more|push it more)\.?$/i,
    factor: 1.35,
  },
];

const REDUCE_PATTERNS: Array<{ re: RegExp; factor: number }> = [
  {
    re: /^(not that much|too much|a bit less|a little less|slightly less|slightly softer)\.?$/i,
    factor: 0.65,
  },
  {
    re: /^(much less|way less|a lot less|much softer)\.?$/i,
    factor: 0.4,
  },
  {
    re: /^(less|softer|make it softer|pull it back|ease off|tone it down)\.?$/i,
    factor: 0.7,
  },
];

const UNDO_RE = /^(undo that|undo|undo it|revert that|take that back)\.?$/i;
const REDO_RE = /^(redo that|redo|redo it|put that back)\.?$/i;

const WARMER_RE =
  /^(warmer|make it warmer|a bit warmer|slightly warmer)\.?$/i;
const COOLER_RE =
  /^(cooler|make it cooler|cool it|cool it instead|cool them|cool them slightly|a bit cooler|slightly cooler)\.?$/i;

const FOLLOW_UP_HINT =
  /^(more|less|warmer|cooler|stronger|softer|undo|redo|not that much|a little more|only that)\b/i;

/**
 * Try to resolve a follow-up against the active EditAction without calling Gemini.
 * Returns null when the prompt needs the model (or clarification).
 */
export function tryResolveFollowUp(
  prompt: string,
  session: EditSession,
): ResolvedFollowUp | null {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  if (UNDO_RE.test(trimmed)) {
    const action = session.actions[session.actions.length - 1];
    if (!action) return null;
    return { kind: "undo", action };
  }

  if (REDO_RE.test(trimmed)) {
    const action = session.redoStack[session.redoStack.length - 1];
    if (!action) return null;
    return { kind: "redo", action };
  }

  const active = getActiveAction(session);
  if (!active) return null;

  for (const { re, factor } of AMPLIFY_PATTERNS) {
    if (re.test(trimmed)) {
      return { kind: "amplify", factor, action: active };
    }
  }
  for (const { re, factor } of REDUCE_PATTERNS) {
    if (re.test(trimmed)) {
      return { kind: "reduce", factor, action: active };
    }
  }

  if (WARMER_RE.test(trimmed)) {
    return { kind: "warmer", temperatureDelta: 12, action: active };
  }
  if (COOLER_RE.test(trimmed)) {
    const slight = /slightly/i.test(trimmed);
    return {
      kind: "cooler",
      temperatureDelta: slight ? -8 : -12,
      action: active,
    };
  }

  return null;
}

/** True when the prompt looks like a relative follow-up. */
export function looksLikeFollowUp(prompt: string): boolean {
  return FOLLOW_UP_HINT.test(prompt.trim());
}
