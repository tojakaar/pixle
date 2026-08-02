/**
 * Lightweight feasibility metrics for the iOS spike.
 * Exposed on `window.__pixleFeasibility` for on-device inspection.
 */

export type FeasibilityMetricName =
  | "app_launch_ms"
  | "placeholder_ms"
  | "preview_ready_ms"
  | "segformer_load_ms"
  | "segformer_first_infer_ms"
  | "segformer_warm_infer_ms"
  | "first_global_edit_ms"
  | "first_semantic_edit_ms"
  | "cached_semantic_edit_ms"
  | "export_encode_ms"
  | "export_save_ms"
  | "export_width"
  | "export_height"
  | "export_bytes"
  | "wasm_simd"
  | "wasm_threads"
  | "shared_array_buffer"
  | "peak_js_heap_mb";

export interface FeasibilitySnapshot {
  platform: string;
  recordedAt: string;
  metrics: Record<string, number | boolean | string>;
  notes: string[];
}

const metrics: Record<string, number | boolean | string> = {};
const notes: string[] = [];
let platformLabel = "unknown";

export function setFeasibilityPlatform(platform: string): void {
  platformLabel = platform;
  publish();
}

export function recordFeasibilityMetric(
  name: FeasibilityMetricName | string,
  value: number | boolean | string,
): void {
  metrics[name] = value;
  publish();
}

export function addFeasibilityNote(note: string): void {
  notes.push(note);
  publish();
}

export function getFeasibilitySnapshot(): FeasibilitySnapshot {
  return {
    platform: platformLabel,
    recordedAt: new Date().toISOString(),
    metrics: { ...metrics },
    notes: [...notes],
  };
}

export function probeWasmCapabilities(): void {
  const sab =
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined";
  recordFeasibilityMetric("shared_array_buffer", sab);

  // WebAssembly.validate for SIMD opcode prefix — best-effort.
  let simd = false;
  try {
    // v128.const i32x4 — minimal SIMD module
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
      0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
      0x41, 0x00, 0xfd, 0x0c, 0x00, 0x0b,
    ]);
    simd = WebAssembly.validate(bytes);
  } catch {
    simd = false;
  }
  recordFeasibilityMetric("wasm_simd", simd);

  // Cross-origin isolated + SAB is the usual threads prerequisite.
  const threads =
    sab &&
    typeof (globalThis as { crossOriginIsolated?: boolean })
      .crossOriginIsolated === "boolean"
      ? Boolean(
          (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
        )
      : false;
  recordFeasibilityMetric("wasm_threads", threads);

  if (!sab) {
    addFeasibilityNote(
      "SharedArrayBuffer unavailable — ONNX WASM proxy/threads will fall back to main-thread or single-worker mode.",
    );
  }
  if (!simd) {
    addFeasibilityNote(
      "WASM SIMD probe failed — SegFormer inference may be slower or fail to initialise.",
    );
  }
}

export function sampleJsHeap(): void {
  try {
    const mem = (
      performance as Performance & {
        memory?: { usedJSHeapSize?: number };
      }
    ).memory;
    if (mem?.usedJSHeapSize) {
      recordFeasibilityMetric(
        "peak_js_heap_mb",
        Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10,
      );
    }
  } catch {
    // performance.memory is Chromium-only; WKWebView may omit it.
  }
}

function publish(): void {
  if (typeof window === "undefined") return;
  (
    window as Window & { __pixleFeasibility?: FeasibilitySnapshot }
  ).__pixleFeasibility = getFeasibilitySnapshot();
}

/** Mark app shell start for launch timing. */
export function markAppShellStart(): number {
  const t0 = performance.now();
  if (typeof window !== "undefined") {
    (
      window as Window & { __pixleAppShellStart?: number }
    ).__pixleAppShellStart = t0;
  }
  return t0;
}

export function recordAppLaunch(): void {
  if (typeof window === "undefined") return;
  const start = (window as Window & { __pixleAppShellStart?: number })
    .__pixleAppShellStart;
  if (typeof start === "number") {
    recordFeasibilityMetric("app_launch_ms", performance.now() - start);
  }
}
