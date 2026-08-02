import type { PixlePlatform } from "./types";

/**
 * Best-effort host detection. Prefer Tauri OS plugin when available; fall back
 * to userAgent for WKWebView / browser previews.
 */
export async function detectPlatform(): Promise<PixlePlatform> {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      // Avoid a hard dependency on @tauri-apps/plugin-os for this spike.
      // UA / touch heuristics distinguish iOS WKWebView from desktop Tauri.
      if (isLikelyIosWebView()) return "ios";
      if (isLikelyAndroidWebView()) return "android";
      return "desktop";
    }
  } catch {
    // Outside Tauri.
  }

  if (isLikelyIosWebView()) return "ios";
  if (isLikelyAndroidWebView()) return "android";
  return "web";
}

export function detectPlatformSync(): PixlePlatform {
  if (typeof window === "undefined") return "web";
  // Synchronous path used before async OS probe resolves.
  try {
    const w = window as Window & {
      __TAURI_INTERNALS__?: unknown;
      __TAURI__?: unknown;
    };
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) {
      if (isLikelyIosWebView()) return "ios";
      if (isLikelyAndroidWebView()) return "android";
      return "desktop";
    }
  } catch {
    // ignore
  }
  if (isLikelyIosWebView()) return "ios";
  if (isLikelyAndroidWebView()) return "android";
  return "web";
}

function isLikelyIosWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPhone/iPad; also iPadOS desktop-class UA with touch.
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}

function isLikelyAndroidWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}
