import {
  DESKTOP_IMAGE_ACCEPT,
  IOS_IMAGE_ACCEPT,
  isJpegOrPng,
  isSupportedMobileStill,
} from "./fileMetadata";
import type { ImagePickResult, ImagePicker } from "./types";

/**
 * Desktop picker — keeps the existing hidden `<input type="file">` flow.
 * The App triggers the input; this adapter only validates / describes policy.
 */
export function createDesktopImagePicker(): ImagePicker {
  return {
    id: "desktop-file-input",
    acceptAttribute: DESKTOP_IMAGE_ACCEPT,
    supportsHeic: false,
    async pickImage(options) {
      if (!options?.triggerFileInput) {
        return {
          status: "error",
          message: "Desktop image picker requires a file input trigger.",
        };
      }
      options.triggerFileInput();
      // Selection arrives via the input change handler — treat as deferred.
      return { status: "cancelled" };
    },
    acceptsFile(file) {
      return isJpegOrPng(file);
    },
  };
}

/**
 * iOS picker — PHPicker via `<input type="file" accept="image/*">`.
 * Modern iOS does not require full library read permission for the picker UI;
 * denied/cancelled states surface as empty FileList (treated as cancel).
 */
export function createIosImagePicker(): ImagePicker {
  return {
    id: "ios-photo-library",
    acceptAttribute: IOS_IMAGE_ACCEPT,
    supportsHeic: true,
    async pickImage(options) {
      if (!options?.triggerFileInput) {
        return {
          status: "error",
          message: "iOS image picker requires a file input trigger.",
        };
      }
      try {
        options.triggerFileInput();
        return { status: "cancelled" };
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Could not open the photo library.";
        // Permission hard-failures are rare with PHPicker; surface cleanly.
        if (/permission|denied|not authorized/i.test(message)) {
          return { status: "denied", message };
        }
        return { status: "error", message };
      }
    },
    acceptsFile(file) {
      return isSupportedMobileStill(file);
    },
  };
}

export function createWebImagePicker(): ImagePicker {
  return createDesktopImagePicker();
}

/** Validate a FileList selection against the active picker policy. */
export function resolvePickedFile(
  picker: ImagePicker,
  fileList: FileList | null,
): ImagePickResult {
  const file = fileList?.[0];
  if (!file) return { status: "cancelled" };
  if (!picker.acceptsFile(file)) {
    if (picker.supportsHeic) {
      return {
        status: "error",
        message: "Please choose a JPEG, PNG, or HEIC image.",
      };
    }
    return {
      status: "error",
      message: "Please choose a JPEG or PNG image.",
    };
  }
  return { status: "picked", file };
}
