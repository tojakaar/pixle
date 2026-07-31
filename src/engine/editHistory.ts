import type { EditParameters } from "./EditParameters";
import { DEFAULT_EDIT_PARAMETERS } from "./EditParameters";

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
  present: EditParameters = { ...DEFAULT_EDIT_PARAMETERS },
): EditHistoryState {
  return {
    past: [],
    present: { ...present },
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
    past: [...history.past, { ...history.present }],
    present: { ...next },
    future: [],
  };
}

export function undoEdit(history: EditHistoryState): EditHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: { ...previous },
    future: [{ ...history.present }, ...history.future],
  };
}

export function redoEdit(history: EditHistoryState): EditHistoryState {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, { ...history.present }],
    present: { ...next },
    future: history.future.slice(1),
  };
}

/** Reset to identity parameters, recording a history step when not already identity. */
export function resetEdit(history: EditHistoryState): EditHistoryState {
  const identity = { ...DEFAULT_EDIT_PARAMETERS };
  if (parametersEqual(history.present, identity)) {
    return history;
  }
  return commitEdit(history, identity);
}

export function parametersEqual(a: EditParameters, b: EditParameters): boolean {
  return (
    a.exposure === b.exposure &&
    a.contrast === b.contrast &&
    a.highlights === b.highlights &&
    a.shadows === b.shadows &&
    a.temperature === b.temperature &&
    a.tint === b.tint &&
    a.saturation === b.saturation
  );
}
