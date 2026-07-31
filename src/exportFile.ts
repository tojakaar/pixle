import { isTauri } from "@tauri-apps/api/core";
import {
  defaultExportFileName,
  formatFromPath,
  renderEditedImageBytes,
  type ExportFormat,
} from "./engine/exportImage";
import type { EditParameters } from "./engine";

export interface ExportEditedImageOptions {
  sourceFile: File;
  params: EditParameters;
  originalFileName: string | null;
}

export type ExportResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" };

/**
 * Export the currently edited image at full source resolution via the native
 * save dialog (Tauri). Falls back to a browser download outside the shell.
 */
export async function exportEditedImage(
  options: ExportEditedImageOptions,
): Promise<ExportResult> {
  const preferredFormat: ExportFormat = guessPreferredFormat(
    options.originalFileName,
  );
  const defaultName = defaultExportFileName(
    options.originalFileName,
    preferredFormat,
  );

  if (isTauri()) {
    return exportViaTauri(options, defaultName, preferredFormat);
  }

  return exportViaBrowserDownload(options, defaultName, preferredFormat);
}

async function exportViaTauri(
  options: ExportEditedImageOptions,
  defaultName: string,
  preferredFormat: ExportFormat,
): Promise<ExportResult> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    title: "Export edited image",
    defaultPath: defaultName,
    filters: [
      { name: "JPEG", extensions: ["jpg", "jpeg"] },
      { name: "PNG", extensions: ["png"] },
    ],
  });

  if (path === null) {
    return { status: "cancelled" };
  }

  const format = formatFromPath(path) || preferredFormat;
  const bytes = await renderEditedImageBytes({
    sourceFile: options.sourceFile,
    params: options.params,
    format,
    jpegQuality: 0.95,
  });

  // Dialog-selected paths are added to the fs scope; writeFile transfers bytes
  // without JSON-encoding the whole buffer. Fall back to the Rust command if
  // the chosen location is outside the predeclared fs scope.
  try {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, bytes);
  } catch {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_image_file", {
      path,
      bytes: Array.from(bytes),
    });
  }

  return { status: "saved", path };
}

async function exportViaBrowserDownload(
  options: ExportEditedImageOptions,
  defaultName: string,
  preferredFormat: ExportFormat,
): Promise<ExportResult> {
  const bytes = await renderEditedImageBytes({
    sourceFile: options.sourceFile,
    params: options.params,
    format: preferredFormat,
    jpegQuality: 0.95,
  });
  const mime = preferredFormat === "png" ? "image/png" : "image/jpeg";
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { status: "saved", path: defaultName };
}

function guessPreferredFormat(fileName: string | null): ExportFormat {
  if (fileName && /\.png$/i.test(fileName)) return "png";
  return "jpeg";
}
