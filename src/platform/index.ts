import { createTauriGeminiApiClient } from "./apiClient";
import { detectPlatform, detectPlatformSync } from "./detect";
import { describeFile } from "./fileMetadata";
import {
  createDesktopImageExporter,
  createIosImageExporter,
  createWebImageExporter,
} from "./imageExporter";
import {
  createDesktopImagePicker,
  createIosImagePicker,
  createWebImagePicker,
} from "./imagePicker";
import type { PlatformServices, PixlePlatform } from "./types";

export type {
  ApiClient,
  FileMetadata,
  ImageExporter,
  ImagePicker,
  ImagePickResult,
  PlatformServices,
  PixlePlatform,
} from "./types";
export { describeFile } from "./fileMetadata";
export { resolvePickedFile } from "./imagePicker";
export {
  addFeasibilityNote,
  getFeasibilitySnapshot,
  markAppShellStart,
  probeWasmCapabilities,
  recordAppLaunch,
  recordFeasibilityMetric,
  sampleJsHeap,
  setFeasibilityPlatform,
} from "./feasibilityMetrics";

let cached: PlatformServices | null = null;

export function getPlatformServicesSync(): PlatformServices {
  if (cached) return cached;
  cached = buildServices(detectPlatformSync());
  return cached;
}

export async function getPlatformServices(): Promise<PlatformServices> {
  const platform = await detectPlatform();
  cached = buildServices(platform);
  return cached;
}

function buildServices(platform: PixlePlatform): PlatformServices {
  const apiClient = createTauriGeminiApiClient();

  if (platform === "ios") {
    return {
      platform,
      imagePicker: createIosImagePicker(),
      imageExporter: createIosImageExporter(),
      apiClient,
      describeFile,
    };
  }

  if (platform === "web") {
    return {
      platform,
      imagePicker: createWebImagePicker(),
      imageExporter: createWebImageExporter(),
      apiClient,
      describeFile,
    };
  }

  // desktop + android (android out of scope; desktop adapters for now)
  return {
    platform,
    imagePicker: createDesktopImagePicker(),
    imageExporter: createDesktopImageExporter(),
    apiClient,
    describeFile,
  };
}
