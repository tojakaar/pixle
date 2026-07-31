/** Max edge length for the in-memory working buffer (WebKit-safe + fast). */
export const MAX_WORKING_EDGE = 1600;

export interface DecodedImage {
  /** Pixels used for preview + edits (may be downscaled). */
  working: ImageData;
  /** Intrinsic file dimensions before any downscale. */
  originalWidth: number;
  originalHeight: number;
}

interface Size {
  width: number;
  height: number;
}

/**
 * Decode a JPEG/PNG into a working ImageData capped at {@link MAX_WORKING_EDGE}.
 *
 * Prefer decoding already-resized via `createImageBitmap` options so we never
 * materialise a multi‑megapixel bitmap in WKWebView (the previous hang source).
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  return withTimeout(decodeImageFileInner(file), 12_000, "Timed out opening image.");
}

async function decodeImageFileInner(file: File): Promise<DecodedImage> {
  const probed = await probeImageSize(file);
  if (probed) {
    const target = fitWithin(probed, MAX_WORKING_EDGE);
    try {
      return await decodeWithBitmapResize(file, probed, target);
    } catch {
      // Fall through to element path.
    }
    return decodeWithHtmlImage(file, probed, target);
  }

  // Unknown container — last-resort path (still capped on draw).
  return decodeWithHtmlImage(file);
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

async function decodeWithBitmapResize(
  file: File,
  original: Size,
  target: Size,
): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: "medium",
  });
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not create canvas context");
    }
    ctx.drawImage(bitmap, 0, 0);
    return {
      working: ctx.getImageData(0, 0, width, height),
      originalWidth: original.width,
      originalHeight: original.height,
    };
  } finally {
    bitmap.close();
  }
}

async function decodeWithHtmlImage(
  file: File,
  knownOriginal?: Size,
  knownTarget?: Size,
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
    const target = knownTarget ?? fitWithin(original, MAX_WORKING_EDGE);
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
