import type {
  EditParameters,
  EditSessionContext,
  ImageAnalysis,
} from "../engine";
import type { EditFromPromptResult } from "../aiEditor";
import type {
  ExportDestination,
  ExportEditedImageOptions,
  ExportResult,
} from "../exportFile";

/** Runtime host — shared UI/engine must not branch on OS details elsewhere. */
export type PixlePlatform = "desktop" | "ios" | "android" | "web";

export type ImagePickResult =
  | { status: "picked"; file: File }
  | { status: "cancelled" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string };

export interface ImagePicker {
  readonly id: string;
  /** MIME / extension accept string for a hidden file input, if used. */
  acceptAttribute: string;
  /** Whether HEIC/HEIF is advertised as supported by this picker. */
  supportsHeic: boolean;
  /**
   * Open the platform image picker. Implementations may use a provided
   * `<input type="file">` click helper for HTML-based flows.
   */
  pickImage(options?: {
    triggerFileInput?: () => void;
  }): Promise<ImagePickResult>;
  /** True when `file` is an accepted still-image payload for this platform. */
  acceptsFile(file: File): boolean;
}

export interface ImageExporter {
  readonly id: string;
  chooseDestination(
    options: ExportEditedImageOptions,
  ): Promise<ExportDestination>;
  write(
    options: ExportEditedImageOptions,
    destination: Exclude<ExportDestination, { status: "cancelled" }>,
  ): Promise<ExportResult>;
}

/**
 * Transport boundary for conversational edits.
 * Production mobile must route through a Pixle backend — never ship a
 * reusable Gemini API key inside the app binary or frontend JS.
 */
export interface ApiClient {
  readonly id: string;
  editFromPrompt(
    prompt: string,
    currentParameters: EditParameters,
    imageAnalysis: ImageAnalysis,
    sessionContext?: EditSessionContext | null,
  ): Promise<EditFromPromptResult>;
}

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  /** Best-effort extension without the leading dot. */
  extension: string;
  /** True when the name/MIME looks like HEIC/HEIF. */
  isHeic: boolean;
}

export interface PlatformServices {
  platform: PixlePlatform;
  imagePicker: ImagePicker;
  imageExporter: ImageExporter;
  apiClient: ApiClient;
  describeFile(file: File): FileMetadata;
}
