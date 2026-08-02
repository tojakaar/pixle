import { isTauri } from "@tauri-apps/api/core";
import {
  chooseExportDestination as desktopChooseDestination,
  writeExport as desktopWriteExport,
  type ExportDestination,
  type ExportEditedImageOptions,
  type ExportResult,
} from "../exportFile";
import {
  defaultExportFileName,
  renderEditedImageBytes,
  type ExportFormat,
} from "../engine/exportImage";
import { recordFeasibilityMetric } from "./feasibilityMetrics";
import type { ImageExporter } from "./types";

export function createDesktopImageExporter(): ImageExporter {
  return {
    id: "desktop-dialog-fs",
    chooseDestination: desktopChooseDestination,
    write: desktopWriteExport,
  };
}

export function createWebImageExporter(): ImageExporter {
  return createDesktopImageExporter();
}

/**
 * iOS exporter — encodes full-resolution edited bytes (same engine as desktop)
 * and saves into the Photos library via the Rust `save_image_to_photos` command.
 *
 * Does not use the preview canvas. Destination dialog is skipped; Photos is
 * the fixed sink for the spike.
 */
export function createIosImageExporter(): ImageExporter {
  return {
    id: "ios-photos-library",
    async chooseDestination(options) {
      const preferredFormat: ExportFormat = guessPreferredFormat(
        options.originalFileName,
      );
      const defaultName = defaultExportFileName(
        options.originalFileName,
        preferredFormat,
      );
      // Fixed Photos destination — no filesystem save panel on iOS spike.
      return {
        status: "chosen",
        path: `photos://${defaultName}`,
        format: preferredFormat,
      };
    },
    async write(options, destination) {
      if (destination.status === "browser") {
        // Should not happen on iOS Tauri — keep a safe fallback.
        return desktopWriteExport(options, destination);
      }

      const t0 = performance.now();
      const bytes = await renderEditedImageBytes({
        sourceFile: options.sourceFile,
        params: options.params,
        format: destination.format,
        jpegQuality: 0.95,
        maskTarget: options.maskTarget,
        baseParameters: options.baseParameters,
        maskProvider: options.maskProvider,
        mask: options.mask,
      });
      const encodeMs = performance.now() - t0;

      if (!isTauri()) {
        return desktopWriteExport(options, {
          status: "browser",
          format: destination.format,
          defaultName: defaultExportFileName(
            options.originalFileName,
            destination.format,
          ),
        });
      }

      const saveStart = performance.now();
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{
          width?: number;
          height?: number;
          bytesWritten?: number;
        } | null>("save_image_to_photos", {
          bytes: Array.from(bytes),
          format: destination.format,
          fileName: defaultExportFileName(
            options.originalFileName,
            destination.format,
          ),
        });
        const saveMs = performance.now() - saveStart;
        recordFeasibilityMetric("export_encode_ms", encodeMs);
        recordFeasibilityMetric("export_save_ms", saveMs);
        if (result?.width && result?.height) {
          recordFeasibilityMetric("export_width", result.width);
          recordFeasibilityMetric("export_height", result.height);
        }
        recordFeasibilityMetric("export_bytes", bytes.byteLength);
        return {
          status: "saved",
          path: result
            ? `Photos (${result.width ?? "?"}×${result.height ?? "?"})`
            : "Photos",
        };
      } catch (error) {
        const message = formatSaveError(error);
        if (/cancel/i.test(message)) {
          return { status: "cancelled" };
        }
        throw new Error(message);
      }
    },
  };
}

function guessPreferredFormat(fileName: string | null): ExportFormat {
  if (fileName && /\.png$/i.test(fileName)) return "png";
  return "jpeg";
}

function formatSaveError(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Could not save the image to Photos.";
}

/** Re-export types for App convenience. */
export type { ExportDestination, ExportEditedImageOptions, ExportResult };
