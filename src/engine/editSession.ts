import type { EditParameters } from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  SCALAR_EDIT_KEYS,
  HSL_COLOR_NAMES,
  clampHslChannel,
  clampScalarParam,
  cloneEditParameters,
} from "./EditParameters";
import { diffParameters, type ParameterChange } from "./editDiff";
import type { Mask } from "./mask/types";

/**
 * One AI (or Look) edit in the current image session.
 * Stores parameters + mask reference — never rendered image buffers.
 */
export interface EditAction {
  id: string;
  /** Semantic target, or null for a global edit. */
  target: string | null;
  /** UI title, e.g. "Sky", "Vegetation", "Global". */
  targetLabel: string;
  /** Grade applied under the mask (or globally). */
  parameters: EditParameters;
  /** Outside-mask baseline when local; null when global. */
  baseParameters: EditParameters | null;
  /** Snapshot before this action (intensity / amplify baseline). */
  beforeParameters: EditParameters;
  /** Resolved mask label when local; null when global. */
  maskLabel: string | null;
  /**
   * Soft mask from the MaskProvider cache (shared reference).
   * Never a rendered photo. May be null for global edits.
   */
  mask: Mask | null;
  timestamp: number;
  summary: string;
  prompt: string;
}

/** Conversational editing session for the currently open image. */
export interface EditSession {
  /** Matches App openRequestId — opening another image starts fresh. */
  imageKey: number;
  actions: EditAction[];
  /** Selected action for follow-ups / Changes highlight. */
  activeActionId: string | null;
  /** Conversational redo stack ("redo that"). */
  redoStack: EditAction[];
}

/** Compact context sent to Gemini — not the full image history. */
export interface EditSessionContext {
  activeAction: EditActionSummary | null;
  recentActions: EditActionSummary[];
}

export interface EditActionSummary {
  id: string;
  target: string | null;
  targetLabel: string;
  summary: string;
  /** Key parameter deltas for this action only. */
  changes: Array<{ key: string; label: string; formatted: string }>;
}

export function createEditSession(imageKey: number): EditSession {
  return {
    imageKey,
    actions: [],
    activeActionId: null,
    redoStack: [],
  };
}

export function targetDisplayLabel(target: string | null): string {
  if (!target) return "Global";
  const key = target.trim().toLowerCase();
  const labels: Record<string, string> = {
    sky: "Sky",
    person: "Person",
    vegetation: "Vegetation",
    water: "Water",
    buildings: "Buildings",
    ground: "Ground",
    background: "Background",
    trees: "Vegetation",
    grass: "Vegetation",
    flowers: "Vegetation",
    face: "Person",
    skin: "Person",
    clouds: "Sky",
    mountains: "Ground",
  };
  if (labels[key]) return labels[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

let actionSeq = 0;

export function createEditAction(input: {
  target: string | null;
  parameters: EditParameters;
  baseParameters: EditParameters | null;
  beforeParameters: EditParameters;
  mask: Mask | null;
  summary: string;
  prompt: string;
}): EditAction {
  actionSeq += 1;
  const target = input.target?.trim().toLowerCase() || null;
  return {
    id: `action-${Date.now()}-${actionSeq}`,
    target,
    targetLabel: targetDisplayLabel(target),
    parameters: cloneEditParameters(input.parameters),
    baseParameters: input.baseParameters
      ? cloneEditParameters(input.baseParameters)
      : null,
    beforeParameters: cloneEditParameters(input.beforeParameters),
    maskLabel: target,
    mask: input.mask,
    timestamp: Date.now(),
    summary: input.summary.trim() || targetDisplayLabel(target),
    prompt: input.prompt,
  };
}

export function getActiveAction(session: EditSession): EditAction | null {
  if (!session.activeActionId) {
    return session.actions.length > 0
      ? session.actions[session.actions.length - 1]!
      : null;
  }
  return (
    session.actions.find((a) => a.id === session.activeActionId) ??
    (session.actions.length > 0
      ? session.actions[session.actions.length - 1]!
      : null)
  );
}

export function appendEditAction(
  session: EditSession,
  action: EditAction,
): EditSession {
  return {
    ...session,
    actions: [...session.actions, action],
    activeActionId: action.id,
    redoStack: [],
  };
}

export function selectEditAction(
  session: EditSession,
  actionId: string,
): EditSession {
  if (!session.actions.some((a) => a.id === actionId)) return session;
  return { ...session, activeActionId: actionId };
}

/** Remove the last action for conversational "undo that" (keeps document undo separate). */
export function conversationalUndo(session: EditSession): {
  session: EditSession;
  undone: EditAction | null;
} {
  if (session.actions.length === 0) {
    return { session, undone: null };
  }
  const undone = session.actions[session.actions.length - 1]!;
  const actions = session.actions.slice(0, -1);
  return {
    session: {
      ...session,
      actions,
      activeActionId:
        actions.length > 0 ? actions[actions.length - 1]!.id : null,
      redoStack: [...session.redoStack, undone],
    },
    undone,
  };
}

export function conversationalRedo(session: EditSession): {
  session: EditSession;
  redone: EditAction | null;
} {
  if (session.redoStack.length === 0) {
    return { session, redone: null };
  }
  const redone = session.redoStack[session.redoStack.length - 1]!;
  const redoStack = session.redoStack.slice(0, -1);
  const actions = [...session.actions, redone];
  return {
    session: {
      ...session,
      actions,
      activeActionId: redone.id,
      redoStack,
    },
    redone,
  };
}

/**
 * Scale the delta of an action beyond 0…1 (amplify / reduce).
 * Only keys that moved in the original action are rewritten; others stay at `after`.
 */
export function scaleActionParameters(
  before: EditParameters,
  after: EditParameters,
  factor: number,
): EditParameters {
  const changes = diffParameters(before, after);
  if (changes.length === 0) {
    return cloneEditParameters(after);
  }

  const changedKeys = new Set(changes.map((c) => c.key));
  const next = cloneEditParameters(after);

  for (const key of SCALAR_EDIT_KEYS) {
    if (!changedKeys.has(key)) continue;
    const value = before[key] + (after[key] - before[key]) * factor;
    next[key] = clampScalarParam(key, value);
  }

  for (const color of HSL_COLOR_NAMES) {
    for (const channel of ["hue", "saturation", "luminance"] as const) {
      const key = `hsl.${color}.${channel}`;
      if (!changedKeys.has(key)) continue;
      const value =
        before.hsl[color][channel] +
        (after.hsl[color][channel] - before.hsl[color][channel]) * factor;
      next.hsl[color][channel] = clampHslChannel(channel, value);
    }
  }

  return next;
}

export function summarizeAction(action: EditAction): EditActionSummary {
  const changes = diffParameters(action.beforeParameters, action.parameters);
  return {
    id: action.id,
    target: action.target,
    targetLabel: action.targetLabel,
    summary: action.summary,
    changes: changes.slice(0, 8).map((c) => ({
      key: c.key,
      label: c.label,
      formatted: c.formatted,
    })),
  };
}

/** Compact session payload for Gemini — active action + a few recent peers. */
export function buildSessionContext(
  session: EditSession,
  limit = 5,
): EditSessionContext {
  const active = getActiveAction(session);
  const recent = session.actions.slice(-limit).map(summarizeAction);
  return {
    activeAction: active ? summarizeAction(active) : null,
    recentActions: recent,
  };
}

/** Group actions for the Changes tab visual history. */
export interface ActionHistoryGroup {
  targetLabel: string;
  target: string | null;
  actions: Array<EditAction & { changes: ParameterChange[] }>;
}

export function groupActionsForHistory(
  actions: EditAction[],
): ActionHistoryGroup[] {
  const order: string[] = [];
  const map = new Map<string, ActionHistoryGroup>();

  for (const action of actions) {
    const key = action.target ?? "__global__";
    if (!map.has(key)) {
      order.push(key);
      map.set(key, {
        targetLabel: action.targetLabel,
        target: action.target,
        actions: [],
      });
    }
    map.get(key)!.actions.push({
      ...action,
      changes: diffParameters(action.beforeParameters, action.parameters),
    });
  }

  return order.map((key) => map.get(key)!);
}

export function actionIntensitySession(action: EditAction): {
  before: EditParameters;
  after: EditParameters;
  intensity: number;
} {
  return {
    before: cloneEditParameters(action.beforeParameters),
    after: cloneEditParameters(action.parameters),
    intensity: 100,
  };
}

export { DEFAULT_EDIT_PARAMETERS };
