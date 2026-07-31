/** Max edge length for the in-memory working buffer (WebKit-safe). */
export const MAX_WORKING_EDGE = 2048;

export interface DecodedImage {
  /** Pixels used for preview + edits (may be downscaled). */
  working: ImageData;
  /** Intrinsic file dimensions before any downscale. */
  originalWidth: number;
  originalHeight: number;
}

/**
 * Decode a JPEG/PNG into a working ImageData capped at {@link MAX_WORKING_EDGE}.
 * Avoids creating multi‑megapixel canvases that freeze WKWebView on macOS.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    if (originalWidth < 1 || originalHeight < 1) {
      throw new Error("Image has invalid dimensions.");
    }

    const maxEdge = Math.max(originalWidth, originalHeight);
    const scale = maxEdge > MAX_WORKING_EDGE ? MAX_WORKING_EDGE / maxEdge : 1;
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not create canvas context");
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    const working = ctx.getImageData(0, 0, width, height);
    return { working, originalWidth, originalHeight };
  } finally {
    bitmap.close();
  }
}

/** Yield to the browser so the UI can paint between heavy steps. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}
