# Initial iOS blockers (pre-implementation inspection)

Inspected branch: `cursor/conversational-edit-session-3c26` (includes SegFormer + EditSession).

## Environment of this spike agent

| Item | Status |
| --- | --- |
| Host OS | Linux (Cursor Cloud VM) |
| `npx tauri ios` | **Unavailable** — CLI binary on Linux exposes `android` only |
| Xcode / iOS Simulator | **Not available** |
| Physical iPhone | **Not available** |
| Desktop Tauri | Available (WebKitGTK) |

Therefore: this PR scaffolds iOS readiness and adapters; it **cannot** claim device deployment or on-device performance.

## Likely blockers

1. **Tooling gate** — `tauri ios init/dev/build` requires macOS + Xcode + signing. Must be run locally by a developer with an Apple team.
2. **Photos write path** — desktop uses `@tauri-apps/plugin-dialog` + `plugin-fs`. iOS Photos write needs a native bridge (`ios-bridge/PhotosBridge.swift`); not optional for “Save to Photos”.
3. **Photos read path** — current UI uses `<input type="file">`. On iOS this maps to PHPicker (good). Full `NSPhotoLibraryUsageDescription` still listed for completeness; Add usage is required for save.
4. **HEIC** — desktop accept filter was JPEG/PNG only. iOS must advertise HEIC; decode depends on WKWebView `createImageBitmap` / `HTMLImageElement`. Failure mode must be explicit, not silent.
5. **SegFormer ONNX/WASM** — Transformers.js model (~q8) downloads/caches in-webview. Risks: no SharedArrayBuffer / threads, weak SIMD, multi-second first infer, memory pressure / jetsam on large working buffers + model.
6. **Full-res export memory** — export decodes intrinsic resolution into ImageData then re-encodes. Large phone JPEGs can spike memory on-device.
7. **API keys** — Gemini stays in Rust `.env` today (good for desktop/dev). A production App Store binary must not embed a reusable Gemini key; needs Pixle backend later.
8. **Desktop dialog plugins on mobile** — `dialog`/`fs` capabilities are desktop-scoped; mobile capability omits them on purpose.
9. **UI density** — desktop sidebar + hover affordances are not phone-native; spike uses a bottom sheet without redesigning the editor.

## Non-goals confirmed

- No edit-engine rewrite
- No Gemini provider replacement
- No segmentation model replacement in this PR
- No new editing features
- Separate branch from the segmentation / conversational PRs
