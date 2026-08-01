import { perfLog, perfTime } from "./perf";

/** Absolute cap on the working-buffer long edge (export is unaffected). */
export const MAX_WORKING_EDGE = 1600;

/** Floor so tiny windows still get a usable edit buffer. */
export const MIN_WORKING_EDGE = 960;

export interface DecodedImage {
  /** Pixels used for preview + edits (may be downscaled). */
  working: ImageData;
  /** Intrinsic file dimensions before any downscale. */
  originalWidth: number;
  originalHeight: number;
  /** Long-edge cap used for this decode. */
  workingMaxEdge: number;
}

export interface PreviewSizeHint {
  /** CSS pixel width of the image viewport. */
  viewportWidth: number;
  /** CSS pixel height of the image viewport. */
  viewportHeight: number;
  /** window.devicePixelRatio (clamped internally). */
  devicePixelRatio?: number;
}

interface Size {
  width: number;
  height: number;
}

/**
 * Choose a working long-edge for the preview buffer.
 *
 * Rule: ~1.15× the longest viewport edge × DPR, clamped to
 * [MIN_WORKING_EDGE, MAX_WORKING_EDGE]. Never exceeds the source long edge.
 * Computed once per open — not on every window resize.
 */
export function computeWorkingMaxEdge(
  hint: PreviewSizeHint | null | undefined,
  sourceLongEdge?: number,
): number {
  const dpr = Math.min(2, Math.max(1, hint?.devicePixelRatio ?? 1));
  const vw = Math.max(1, hint?.viewportWidth ?? 900);
  const vh = Math.max(1, hint?.viewportHeight ?? 700);
  const displayLong = Math.max(vw, vh) * dpr;
  let edge = Math.round(displayLong * 1.15);
  edge = Math.min(MAX_WORKING_EDGE, Math.max(MIN_WORKING_EDGE, edge));
  if (sourceLongEdge && sourceLongEdge > 0) {
    edge = Math.min(edge, sourceLongEdge);
  }
  return edge;
}

/**
 * Decode a JPEG/PNG into a working ImageData capped by an adaptive long edge.
 *
 * Prefer decoding already-resized via `createImageBitmap` so we never
 * materialise a multi‑megapixel bitmap in WKWebView.
 */
export async function decodeImageFile(
  file: File,
  hint?: PreviewSizeHint | null,
): Promise<DecodedImage> {
  return withTimeout(
    decodeImageFileInner(file, hint),
    12_000,
    "Timed out opening image.",
  );
}

async function decodeImageFileInner(
  file: File,
  hint?: PreviewSizeHint | null,
): Promise<DecodedImage> {
  const endAll = perfTime("decodeImageFile total");
  const endProbe = perfTime("probeImageSize");
  const probed = await probeImageSize(file);
  endProbe();

  const sourceLong = probed
    ? Math.max(probed.width, probed.height)
    : undefined;
  const maxEdge = computeWorkingMaxEdge(hint, sourceLong);
  perfLog("workingMaxEdge", { maxEdge, probed, hint });

  if (probed) {
    const target = fitWithin(probed, maxEdge);
    try {
      const endBmp = perfTime("createImageBitmap+getImageData");
      const decoded = await decodeWithBitmapResize(file, probed, target, maxEdge);
      endBmp();
      endAll();
      return decoded;
    } catch (error) {
      perfLog("createImageBitmap failed; falling back", error);
      // Fall through to element path.
    }
    const endHtml = perfTime("htmlImage+getImageData");
    const decoded = await decodeWithHtmlImage(file, probed, target, maxEdge);
    endHtml();
    endAll();
    return decoded;
  }

  // Unknown container — last-resort path (still capped on draw).
  const endHtml = perfTime("htmlImage fallback");
  const decoded = await decodeWithHtmlImage(file, undefined, undefined, maxEdge);
  endHtml();
  endAll();
  return decoded;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function supportsBitmapOrientation(): boolean {
  // Feature-detect the options bag; older WebKit may ignore unknown keys.
  return typeof createImageBitmap === "function";
}

async function decodeWithBitmapResize(
  file: File,
  original: Size,
  target: Size,
  workingMaxEdge: number,
): Promise<DecodedImage> {
  if (!supportsBitmapOrientation()) {
    throw new Error("createImageBitmap unavailable");
  }

  // Prefer oriented + resized decode. If the options object is rejected,
  // retry with resize only, then without options.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: "high",
      });
    } catch {
      bitmap = await createImageBitmap(file);
    }
  }

  try {
    // If options were ignored and we got full-res, draw into the target size.
    const needsScale =
      bitmap.width > target.width + 1 || bitmap.height > target.height + 1;
    const drawW = needsScale ? target.width : bitmap.width;
    const drawH = needsScale ? target.height : bitmap.height;

    const canvas = document.createElement("canvas");
    canvas.width = drawW;
    canvas.height = drawH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not create canvas context");
    }
    ctx.drawImage(bitmap, 0, 0, drawW, drawH);
    const endGet = perfTime("getImageData");
    const working = ctx.getImageData(0, 0, drawW, drawH);
    endGet();
    return {
      working,
      originalWidth: original.width,
      originalHeight: original.height,
      workingMaxEdge,
    };
  } finally {
    bitmap.close();
  }
}

async function decodeWithHtmlImage(
  file: File,
  knownOriginal?: Size,
  knownTarget?: Size,
  workingMaxEdge: number = MAX_WORKING_EDGE,
): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadHtmlImage(url);
    const original = knownOriginal ?? {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    if (original.width < 1 || original.height < 1) {
      throw new Error("Image has invalid dimensions.");
    }
    const target =
      knownTarget ??
      fitWithin(original, computeWorkingMaxEdge(null, Math.max(original.width, original.height)));
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not create canvas context");
    }
    ctx.drawImage(image, 0, 0, target.width, target.height);
    return {
      working: ctx.getImageData(0, 0, target.width, target.height),
      originalWidth: original.width,
      originalHeight: original.height,
      workingMaxEdge,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image."));
    image.src = url;
  });
}

function fitWithin(size: Size, maxEdge: number): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) {
    return { width: size.width, height: size.height };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Read width/height from JPEG/PNG headers without decoding pixels.
 * Returns null when the container is unsupported or the header is incomplete.
 *
 * Note: JPEG SOF dimensions are pre-orientation; createImageBitmap with
 * `imageOrientation: "from-image"` corrects display orientation on draw.
 */
export async function probeImageSize(file: File): Promise<Size | null> {
  const bytes = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
  if (bytes.length < 24) return null;

  // PNG signature + IHDR
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    if (width > 0 && height > 0) return { width, height };
    return null;
  }

  // JPEG SOI
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      // Soften/start-of-scan/end — stop scanning
      if (marker === 0xd9 || marker === 0xda) break;
      // SOF0 / SOF1 / SOF2 carry dimensions
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      if (marker === 0x00 || marker === 0xff) {
        offset += 1;
        continue;
      }
      const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }

  return null;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

/** Yield to the browser so the UI can paint between heavy steps. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}
