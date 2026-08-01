import type { EditParameters } from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  cloneEditParameters,
  parametersEqual,
} from "./EditParameters";
import type { EditDocument } from "./EditDocument";
import {
  cloneEditDocument,
  createGlobalEditDocument,
  editDocumentsEqual,
} from "./EditDocument";

/**
 * Document-state history for non-destructive edits.
 * Stores EditDocument snapshots (parameters + optional semantic mask target) —
 * never full image buffers or mask bitmaps.
 */
export interface EditHistoryState {
  past: EditDocument[];
  present: EditDocument;
  future: EditDocument[];
}

export function createEditHistory(
  present: EditParameters | EditDocument = createGlobalEditDocument(),
): EditHistoryState {
  const doc =
    "maskTarget" in present && "parameters" in present
      ? cloneEditDocument(present)
      : createGlobalEditDocument(present);
  return {
    past: [],
    present: doc,
    future: [],
  };
}

export function canUndo(history: EditHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditHistoryState): boolean {
  return history.future.length > 0;
}

/** Push a new present document after a successful edit (clears redo). */
export function commitEdit(
  history: EditHistoryState,
  next: EditParameters | EditDocument,
): EditHistoryState {
  const doc =
    "maskTarget" in next && "parameters" in next
      ? cloneEditDocument(next)
      : createGlobalEditDocument(next);
  return {
    past: [...history.past, cloneEditDocument(history.present)],
    present: doc,
    future: [],
  };
}

export function undoEdit(history: EditHistoryState): EditHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: cloneEditDocument(previous),
    future: [cloneEditDocument(history.present), ...history.future],
  };
}

export function redoEdit(history: EditHistoryState): EditHistoryState {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, cloneEditDocument(history.present)],
    present: cloneEditDocument(next),
    future: history.future.slice(1),
  };
}

/** Reset to identity parameters, recording a history step when not already identity. */
export function resetEdit(history: EditHistoryState): EditHistoryState {
  const identity = createGlobalEditDocument(
    cloneEditParameters(DEFAULT_EDIT_PARAMETERS),
  );
  if (editDocumentsEqual(history.present, identity)) {
    return history;
  }
  return commitEdit(history, identity);
}

export { parametersEqual, editDocumentsEqual };
