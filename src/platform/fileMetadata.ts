import type { FileMetadata } from "./types";

export function describeFile(file: File): FileMetadata {
  const name = file.name || "image";
  const extension = extensionOf(name);
  const type = (file.type || "").toLowerCase();
  const isHeic =
    type === "image/heic" ||
    type === "image/heif" ||
    extension === "heic" ||
    extension === "heif";

  return {
    name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    extension,
    isHeic,
  };
}

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/** Shared accept list used by HTML file inputs across platforms. */
export const DESKTOP_IMAGE_ACCEPT =
  "image/jpeg,image/png,.jpg,.jpeg,.png";

/**
 * iOS PHPicker / WKWebView file input. HEIC is advertised; decode still goes
 * through createImageBitmap / HTMLImageElement (see docs/ios-feasibility-spike.md).
 */
export const IOS_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif";

export function isJpegOrPng(file: File): boolean {
  const meta = describeFile(file);
  return (
    meta.type === "image/jpeg" ||
    meta.type === "image/png" ||
    meta.extension === "jpg" ||
    meta.extension === "jpeg" ||
    meta.extension === "png"
  );
}

export function isSupportedMobileStill(file: File): boolean {
  const meta = describeFile(file);
  return isJpegOrPng(file) || meta.isHeic;
}
