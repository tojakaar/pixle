import type { EditParameters, HslAdjustments } from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  HSL_COLOR_NAMES,
  SCALAR_EDIT_KEYS,
  cloneEditParameters,
} from "./EditParameters";

/**
 * Parameter-state history for non-destructive edits.
 * Stores EditParameters snapshots only — never full image buffers.
 */
export interface EditHistoryState {
  past: EditParameters[];
  present: EditParameters;
  future: EditParameters[];
}

export function createEditHistory(
  present: EditParameters = cloneEditParameters(DEFAULT_EDIT_PARAMETERS),
): EditHistoryState {
  return {
    past: [],
    present: cloneEditParameters(present),
    future: [],
  };
}

export function canUndo(history: EditHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditHistoryState): boolean {
  return history.future.length > 0;
}

/** Push a new present state after a successful edit (clears redo). */
export function commitEdit(
  history: EditHistoryState,
  next: EditParameters,
): EditHistoryState {
  return {
    past: [...history.past, cloneEditParameters(history.present)],
    present: cloneEditParameters(next),
    future: [],
  };
}

export function undoEdit(history: EditHistoryState): EditHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: cloneEditParameters(previous),
    future: [cloneEditParameters(history.present), ...history.future],
  };
}

export function redoEdit(history: EditHistoryState): EditHistoryState {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, cloneEditParameters(history.present)],
    present: cloneEditParameters(next),
    future: history.future.slice(1),
  };
}

/** Reset to identity parameters, recording a history step when not already identity. */
export function resetEdit(history: EditHistoryState): EditHistoryState {
  const identity = cloneEditParameters(DEFAULT_EDIT_PARAMETERS);
  if (parametersEqual(history.present, identity)) {
    return history;
  }
  return commitEdit(history, identity);
}

function hslEqual(a: HslAdjustments, b: HslAdjustments): boolean {
  for (const name of HSL_COLOR_NAMES) {
    const aa = a[name];
    const bb = b[name];
    if (
      aa.hue !== bb.hue ||
      aa.saturation !== bb.saturation ||
      aa.luminance !== bb.luminance
    ) {
      return false;
    }
  }
  return true;
}

export function parametersEqual(a: EditParameters, b: EditParameters): boolean {
  for (const key of SCALAR_EDIT_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return hslEqual(a.hsl, b.hsl);
}
