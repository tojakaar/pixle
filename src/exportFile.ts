import { isTauri } from "@tauri-apps/api/core";
import {
  defaultExportFileName,
  formatFromPath,
  renderEditedImageBytes,
  type ExportFormat,
} from "./engine/exportImage";
import type { EditParameters, Mask, MaskProvider } from "./engine";

export interface ExportEditedImageOptions {
  sourceFile: File;
  params: EditParameters;
  originalFileName: string | null;
  /** Semantic local-edit fields — export reuses the same MaskProvider. */
  maskTarget?: string | null;
  baseParameters?: EditParameters | null;
  maskProvider?: MaskProvider | null;
  mask?: Mask | null;
}

export type ExportResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" };

export type ExportDestination =
  | { status: "chosen"; path: string; format: ExportFormat }
  | { status: "cancelled" }
  | { status: "browser"; format: ExportFormat; defaultName: string };

/**
 * Export the currently edited image at full source resolution via the native
 * save dialog (Tauri). Falls back to a browser download outside the shell.
 */
export async function exportEditedImage(
  options: ExportEditedImageOptions,
): Promise<ExportResult> {
  const destination = await chooseExportDestination(options);
  if (destination.status === "cancelled") {
    return { status: "cancelled" };
  }
  return writeExport(options, destination);
}

/**
 * Open the save dialog (or resolve the browser download target) without doing
 * any heavy encode/write work. Callers should keep the UI interactive here —
 * only the subsequent write phase should set an exporting/disabled flag.
 */
export async function chooseExportDestination(
  options: ExportEditedImageOptions,
): Promise<ExportDestination> {
  const preferredFormat: ExportFormat = guessPreferredFormat(
    options.originalFileName,
  );
  const defaultName = defaultExportFileName(
    options.originalFileName,
    preferredFormat,
  );

  if (!isTauri()) {
    return { status: "browser", format: preferredFormat, defaultName };
  }

  try {
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

    return {
      status: "chosen",
      path,
      format: formatFromPath(path) || preferredFormat,
    };
  } finally {
    // Native dialogs can leave WKWebView/GTK webviews without input focus or
    // with a stuck pointer grab. Restore interactivity before continuing.
    await restoreWebviewInteractivity();
  }
}

/** Encode + write/download after a destination has been chosen. */
export async function writeExport(
  options: ExportEditedImageOptions,
  destination: Exclude<ExportDestination, { status: "cancelled" }>,
): Promise<ExportResult> {
  if (destination.status === "browser") {
    return exportViaBrowserDownload(
      options,
      destination.defaultName,
      destination.format,
    );
  }

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

  // Dialog-selected paths are added to the fs scope; writeFile transfers bytes
  // without JSON-encoding the whole buffer. Fall back to the Rust command if
  // the chosen location is outside the predeclared fs scope.
  try {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(destination.path, bytes);
  } catch {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_image_file", {
      path: destination.path,
      bytes: Array.from(bytes),
    });
  }

  return { status: "saved", path: destination.path };
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
    maskTarget: options.maskTarget,
    baseParameters: options.baseParameters,
    maskProvider: options.maskProvider,
    mask: options.mask,
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

/** Best-effort focus/pointer recovery after a native dialog closes. */
async function restoreWebviewInteractivity(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFocus();
  } catch {
    // Outside Tauri or window API unavailable — fall through to DOM nudge.
  }

  try {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
    window.focus();
  } catch {
    // Ignore DOM focus failures in non-browser test environments.
  }
}
