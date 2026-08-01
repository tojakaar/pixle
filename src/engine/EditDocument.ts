import type { EditParameters } from "./EditParameters";
import {
  DEFAULT_EDIT_PARAMETERS,
  cloneEditParameters,
  parametersEqual,
} from "./EditParameters";

/**
 * One undo/redo snapshot.
 *
 * Global edits: `maskTarget` is null and `parameters` apply to the whole image.
 * Local semantic edits: `parameters` apply under `maskTarget`; `baseParameters`
 * describe the outside. Mask bitmaps are NOT stored here — they are regenerated
 * via the Segmenter from the label so history stays cheap and model-agnostic.
 */
export interface EditDocument {
  parameters: EditParameters;
  /** Semantic label such as "sky", or null for a global edit. */
  maskTarget: string | null;
  /** Outside-mask baseline when `maskTarget` is set. */
  baseParameters: EditParameters | null;
}

export function createGlobalEditDocument(
  parameters: EditParameters = DEFAULT_EDIT_PARAMETERS,
): EditDocument {
  return {
    parameters: cloneEditParameters(parameters),
    maskTarget: null,
    baseParameters: null,
  };
}

export function createLocalEditDocument(
  parameters: EditParameters,
  maskTarget: string,
  baseParameters: EditParameters,
): EditDocument {
  return {
    parameters: cloneEditParameters(parameters),
    maskTarget: maskTarget.trim().toLowerCase() || null,
    baseParameters: cloneEditParameters(baseParameters),
  };
}

export function cloneEditDocument(doc: EditDocument): EditDocument {
  return {
    parameters: cloneEditParameters(doc.parameters),
    maskTarget: doc.maskTarget,
    baseParameters: doc.baseParameters
      ? cloneEditParameters(doc.baseParameters)
      : null,
  };
}

export function editDocumentsEqual(a: EditDocument, b: EditDocument): boolean {
  if ((a.maskTarget ?? null) !== (b.maskTarget ?? null)) return false;
  if (!parametersEqual(a.parameters, b.parameters)) return false;
  if (a.baseParameters === null && b.baseParameters === null) return true;
  if (a.baseParameters === null || b.baseParameters === null) return false;
  return parametersEqual(a.baseParameters, b.baseParameters);
}

/** Parameters to show in sliders / send to Gemini as the editable baseline. */
export function documentEditParameters(doc: EditDocument): EditParameters {
  return doc.parameters;
}

/**
 * Parameters representing the photo's global grade.
 * For local edits this is the outside baseline.
 */
export function documentGlobalParameters(doc: EditDocument): EditParameters {
  if (doc.maskTarget && doc.baseParameters) {
    return doc.baseParameters;
  }
  return doc.parameters;
}
