import type { EditParameters } from "./EditParameters";
import type { ApplyEditsOptions } from "./render";
import { applyEdits, isIdentityEdit } from "./render";
import { yieldToUi } from "./imageDecode";
import type { Mask } from "./mask/types";
import type { MaskProvider } from "./mask/MaskProvider";

export type ExportFormat = "jpeg" | "png";

export interface ExportImageOptions {
  /** Original file bytes — decoded at full resolution for export. */
  sourceFile: File;
  params: EditParameters;
  format: ExportFormat;
  /** JPEG quality 0–1; defaults to 0.95. */
  jpegQuality?: number;
  /**
   * Optional semantic local edit. Export prefers the session-cached mask from
   * `maskProvider` (resampled to full-res) so preview and export stay consistent
   * without re-running the Segmenter. A precomputed `mask` is a fallback.
   */
  maskTarget?: string | null;
  baseParameters?: EditParameters | null;
  maskProvider?: MaskProvider | null;
  mask?: Mask | null;
}

/**
 * Decode `sourceFile` at its intrinsic resolution (no working-buffer downscale),
 * apply the current non-destructive edit parameters (optionally masked), and
 * encode to JPG/PNG bytes.
 *
 * Preview and export share the same `applyEdits` engine and the same cached
 * MaskCollection (export resamples — it does not re-infer).
 *
 * TODO: Preserve EXIF/XMP metadata from the source when practical. Canvas encode
 * strips metadata; copying EXIF into the output would need a dedicated metadata
 * pipeline and is intentionally deferred so export is not blocked.
 */
export async function renderEditedImageBytes(
  options: ExportImageOptions,
): Promise<Uint8Array> {
  const {
    sourceFile,
    params,
    format,
    jpegQuality = 0.95,
    maskTarget,
    baseParameters,
    maskProvider,
    mask: providedMask,
  } = options;
  const fullRes = await decodeFullResolutionImageData(sourceFile);
  await yieldToUi();

  const applyOptions = resolveExportMaskOptions({
    image: fullRes,
    maskTarget,
    baseParameters,
    maskProvider,
    providedMask,
  });
  await yieldToUi();

  const edited =
    !applyOptions && isIdentityEdit(params)
      ? fullRes
      : applyEdits(fullRes, params, applyOptions);
  await yieldToUi();

  const mime = format === "png" ? "image/png" : "image/jpeg";
  const quality = format === "jpeg" ? jpegQuality : undefined;
  return encodeImageData(edited, mime, quality);
}

function resolveExportMaskOptions(args: {
  image: ImageData;
  maskTarget?: string | null;
  baseParameters?: EditParameters | null;
  maskProvider?: MaskProvider | null;
  providedMask?: Mask | null;
}): ApplyEditsOptions | undefined {
  const target = args.maskTarget?.trim().toLowerCase();
  if (!target) return undefined;

  // Prefer session cache resampled to export resolution (no second inference).
  let mask: Mask | null = null;
  if (args.maskProvider) {
    try {
      mask = args.maskProvider.getCachedLabel(
        target,
        args.image.width,
        args.image.height,
      );
    } catch (error) {
      console.warn("[pixle export] cached mask lookup failed", error);
    }
  }

  if (!mask && args.providedMask) {
    mask = args.providedMask;
  }

  if (!mask) {
    // Cache miss / no object — export as a global edit (never block).
    return undefined;
  }

  return {
    mask,
    baseParameters: args.baseParameters ?? undefined,
  };
}

/** Build a sensible default export name, e.g. `vacation-edited.jpg`. */
export function defaultExportFileName(
  originalName: string | null,
  format: ExportFormat,
): string {
  const ext = format === "png" ? "png" : "jpg";
  const base = (originalName ?? "image").replace(/\.[^.]+$/, "");
  const cleaned = base.trim() || "image";
  const withoutEdited = cleaned.replace(/-edited$/i, "");
  return `${withoutEdited}-edited.${ext}`;
}

/** Infer export format from a user-chosen save path. */
export function formatFromPath(path: string): ExportFormat {
  return /\.png$/i.test(path) ? "png" : "jpeg";
}

async function decodeFullResolutionImageData(file: File): Promise<ImageData> {
  // Prefer createImageBitmap without resize so we keep the file's full pixel grid.
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return drawToImageData(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    // Fall through to HTMLImageElement path.
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadHtmlImage(url);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width < 1 || height < 1) {
      throw new Error("Image has invalid dimensions.");
    }
    return drawToImageData(image, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawToImageData(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Could not create canvas context for export.");
  }
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image for export."));
    image.src = url;
  });
}

function encodeImageData(
  imageData: ImageData,
  mime: "image/jpeg" | "image/png",
  quality?: number,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("Could not create canvas context for encoding."));
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode edited image."));
          return;
        }
        try {
          const buffer = await blob.arrayBuffer();
          resolve(new Uint8Array(buffer));
        } catch (error) {
          reject(error);
        }
      },
      mime,
      quality,
    );
  });
}
