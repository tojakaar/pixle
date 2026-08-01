import { isAbortError, openLog } from "./openLog";
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

export interface DecodeImageOptions {
  hint?: PreviewSizeHint | null;
  /** Abort when a newer open request supersedes this decode. */
  signal?: AbortSignal;
  /** Stable open request id for race logs. */
  requestId?: number;
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

function throwIfAborted(signal: AbortSignal | undefined, requestId: number): void {
  if (signal?.aborted) {
    openLog(requestId, "decode aborted");
    throw new DOMException("Image open aborted", "AbortError");
  }
}

/**
 * Serialize createImageBitmap / heavy decode work so overlapping opens do not
 * pile up decoder pressure in WKWebView. Newer requests still abort older ones
 * via AbortSignal; this only prevents concurrent bitmap construction.
 */
let decodeTail: Promise<unknown> = Promise.resolve();

function enqueueDecode<T>(task: () => Promise<T>): Promise<T> {
  const run = decodeTail.then(task, task);
  decodeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Decode a JPEG/PNG into a working ImageData capped by an adaptive long edge.
 *
 * Prefer decoding already-resized via `createImageBitmap` so we never
 * materialise a multi‑megapixel bitmap in WKWebView.
 */
export async function decodeImageFile(
  file: File,
  hintOrOptions?: PreviewSizeHint | null | DecodeImageOptions,
): Promise<DecodedImage> {
  const options: DecodeImageOptions =
    hintOrOptions &&
    typeof hintOrOptions === "object" &&
    ("hint" in hintOrOptions ||
      "signal" in hintOrOptions ||
      "requestId" in hintOrOptions)
      ? (hintOrOptions as DecodeImageOptions)
      : { hint: hintOrOptions as PreviewSizeHint | null | undefined };

  const requestId = options.requestId ?? 0;
  const signal = options.signal;

  return enqueueDecode(async () => {
    throwIfAborted(signal, requestId);
    return withTimeout(
      decodeImageFileInner(file, options.hint, signal, requestId),
      12_000,
      "Timed out opening image.",
      signal,
      requestId,
    );
  });
}

async function decodeImageFileInner(
  file: File,
  hint: PreviewSizeHint | null | undefined,
  signal: AbortSignal | undefined,
  requestId: number,
): Promise<DecodedImage> {
  const endAll = perfTime("decodeImageFile total");
  openLog(requestId, "decode start", { name: file.name, size: file.size });

  throwIfAborted(signal, requestId);
  const endProbe = perfTime("probeImageSize");
  const probed = await probeImageSize(file);
  endProbe();
  throwIfAborted(signal, requestId);

  const sourceLong = probed
    ? Math.max(probed.width, probed.height)
    : undefined;
  const maxEdge = computeWorkingMaxEdge(hint, sourceLong);
  openLog(requestId, "workingMaxEdge", { maxEdge, probed, hint });

  if (probed) {
    const target = fitWithin(probed, maxEdge);
    try {
      const endBmp = perfTime("createImageBitmap+getImageData");
      const decoded = await decodeWithBitmapResize(
        file,
        probed,
        target,
        maxEdge,
        signal,
        requestId,
      );
      endBmp();
      endAll();
      openLog(requestId, "decode end (bitmap)", {
        w: decoded.working.width,
        h: decoded.working.height,
      });
      return decoded;
    } catch (error) {
      if (isAbortError(error)) throw error;
      openLog(requestId, "createImageBitmap failed; falling back", error);
      perfLog("createImageBitmap failed; falling back", error);
    }

    throwIfAborted(signal, requestId);
    const endHtml = perfTime("htmlImage+getImageData");
    const decoded = await decodeWithHtmlImage(
      file,
      probed,
      target,
      maxEdge,
      signal,
      requestId,
    );
    endHtml();
    endAll();
    openLog(requestId, "decode end (html fallback)", {
      w: decoded.working.width,
      h: decoded.working.height,
    });
    return decoded;
  }

  throwIfAborted(signal, requestId);
  const endHtml = perfTime("htmlImage fallback");
  const decoded = await decodeWithHtmlImage(
    file,
    undefined,
    undefined,
    maxEdge,
    signal,
    requestId,
  );
  endHtml();
  endAll();
  openLog(requestId, "decode end (html unknown)", {
    w: decoded.working.width,
    h: decoded.working.height,
  });
  return decoded;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  signal: AbortSignal | undefined,
  requestId: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Image open aborted", "AbortError"));
      return;
    }

    const timer = window.setTimeout(() => {
      openLog(requestId, "decode timeout");
      reject(new Error(message));
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Image open aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function supportsBitmapOrientation(): boolean {
  return typeof createImageBitmap === "function";
}

function closeBitmapSafe(bitmap: ImageBitmap | null | undefined, requestId: number): void {
  if (!bitmap) return;
  try {
    bitmap.close();
    openLog(requestId, "ImageBitmap.close()");
  } catch (error) {
    openLog(requestId, "ImageBitmap.close() failed", error);
  }
}

async function decodeWithBitmapResize(
  file: File,
  original: Size,
  target: Size,
  workingMaxEdge: number,
  signal: AbortSignal | undefined,
  requestId: number,
): Promise<DecodedImage> {
  if (!supportsBitmapOrientation()) {
    throw new Error("createImageBitmap unavailable");
  }

  throwIfAborted(signal, requestId);
  openLog(requestId, "createImageBitmap start", target);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    throwIfAborted(signal, requestId);
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: "high",
      });
    } catch {
      throwIfAborted(signal, requestId);
      bitmap = await createImageBitmap(file);
    }
  }

  openLog(requestId, "createImageBitmap resolved", {
    w: bitmap.width,
    h: bitmap.height,
  });

  // Newer open won — release this bitmap and stop before getImageData.
  if (signal?.aborted) {
    closeBitmapSafe(bitmap, requestId);
    throw new DOMException("Image open aborted", "AbortError");
  }

  try {
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
    throwIfAborted(signal, requestId);
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
    closeBitmapSafe(bitmap, requestId);
  }
}

async function decodeWithHtmlImage(
  file: File,
  knownOriginal: Size | undefined,
  knownTarget: Size | undefined,
  workingMaxEdge: number,
  signal: AbortSignal | undefined,
  requestId: number,
): Promise<DecodedImage> {
  throwIfAborted(signal, requestId);
  const url = URL.createObjectURL(file);
  openLog(requestId, "html decode object URL created");
  try {
    const image = await loadHtmlImage(url, signal);
    throwIfAborted(signal, requestId);
    const original = knownOriginal ?? {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    if (original.width < 1 || original.height < 1) {
      throw new Error("Image has invalid dimensions.");
    }
    const target =
      knownTarget ??
      fitWithin(
        original,
        computeWorkingMaxEdge(
          null,
          Math.max(original.width, original.height),
        ),
      );
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not create canvas context");
    }
    ctx.drawImage(image, 0, 0, target.width, target.height);
    throwIfAborted(signal, requestId);
    return {
      working: ctx.getImageData(0, 0, target.width, target.height),
      originalWidth: original.width,
      originalHeight: original.height,
      workingMaxEdge,
    };
  } finally {
    try {
      URL.revokeObjectURL(url);
      openLog(requestId, "html decode object URL revoked");
    } catch {
      // ignore
    }
  }
}

function loadHtmlImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Image open aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const onAbort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(new DOMException("Image open aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Failed to decode image."));
    };
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
      if (marker === 0xd9 || marker === 0xda) break;
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
