# Pixle iOS feasibility spike

**Branch:** `cursor/ios-feasibility-spike-e51b`  
**Base:** `cursor/conversational-edit-session-3c26` (conversational EditSession + SegFormer)  
**Goal:** Determine whether Pixle’s current architecture can run reliably on a real iPhone via Tauri 2 — not ship a polished app.

## Verdict (this environment)

| Question | Answer here |
| --- | --- |
| Tauri iOS project initialised? | **Scaffolded** (plist, ios conf, mobile capability, Photos bridge). Full `tauri ios init` **not run** — Linux CLI has no `ios` subcommand. |
| Device evidence? | **None** — no macOS/Xcode/iPhone in this agent. |
| Recommendation | **A (continue with Tauri mobile) provisionally for architecture**, with **C as a likely follow-up for segmentation** if on-device SegFormer timings/memory fail. Do **not** choose B until device evidence says the WebView shell itself is the problem. |

See also: `docs/ios-blockers-initial.md`, `scripts/ios-device-test-sequence.md`.

---

## 1. Inspection summary

- **Tauri:** v2.11.x CLI / `tauri = "2"`; `#[cfg_attr(mobile, tauri::mobile_entry_point)]` already present in `lib.rs`.
- **Rust commands:** `edit_from_prompt`, `save_image_file`, (+ spike) `save_image_to_photos`.
- **React entry:** `src/main.tsx` → `App.tsx`.
- **Image load:** HTML file input → object URL placeholder → async working-buffer decode (`MAX_WORKING_EDGE` 1600).
- **Export:** full-res decode + `applyEdits` (+ mask) → JPG/PNG bytes → dialog/fs (desktop) or Photos (iOS adapter).
- **Gemini:** Rust-only via `.env`; frontend uses `ApiClient` → invoke.
- **SegFormer:** Transformers.js ONNX q8, Segmenter interface + mask cache unchanged.
- **Plugins:** dialog + fs (desktop capability); opener; mobile capability is core-only.
- **Permissions:** `Info.ios.plist` Photo Library usage + add.

---

## 2. Tauri iOS initialisation

### Done in-repo

- `src-tauri/Info.ios.plist` — Photos permission strings
- `src-tauri/tauri.ios.conf.json` — iOS bundle hints
- `src-tauri/capabilities/mobile.json` — iOS/android permissions
- `src-tauri/capabilities/default.json` — scoped to desktop platforms
- `src-tauri/ios-bridge/PhotosBridge.swift` + README
- `bundle.iOS.minimumSystemVersion` in `tauri.conf.json`

### Must run on macOS (developer machine)

```bash
# Prerequisites
xcode-select --install
# Xcode from App Store; accept license; install iOS platform
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
# CocoaPods
sudo gem install cocoapods   # or: brew install cocoapods

cd /path/to/pixle
npm install
npx tauri ios init
npm run ios:sync-bridge   # include PhotosBridge.swift in pixle_iOS (fixes undefined _pixle_save_image_to_photos)
# Set development team in Xcode or tauri.ios.conf.json
npm run ios:dev           # or: npx tauri ios dev --device
```

If the linker reports `Undefined symbols: _pixle_save_image_to_photos`, the Swift
bridge is not in the Xcode target — run `npm run ios:sync-bridge` (see
`src-tauri/ios-bridge/README.md`). Do not stub the Rust `extern "C"` to silence it.

**Apple signing:** development team ID, unique bundle id `com.pixle.app`, device registered for debug. Release/App Store not in scope.

**Do not claim device deployment works until the above succeeds on hardware.**

---

## 3. Platform adapter design

```
src/platform/
  types.ts            ImagePicker, ImageExporter, ApiClient
  detect.ts           desktop | ios | android | web
  imagePicker.ts      desktop file input vs iOS Photos accept/HEIC
  imageExporter.ts    desktop dialog/fs vs iOS Photos invoke
  apiClient.ts        Tauri Gemini (dev) + future backend stub
  fileMetadata.ts     name/MIME/HEIC helpers
  feasibilityMetrics.ts   window.__pixleFeasibility
  index.ts            factory
```

Shared `App.tsx` / engine do not embed OS branches beyond consuming `PlatformServices`.

---

## 4. Photo library input

- iOS: `<input type="file" accept="…heic…">` → system picker (PHPicker).
- Denied/cancel → empty list → no-op; explicit denied strings if bridge reports them.
- Placeholder + async prepare preserved.
- HEIC **advertised** on iOS; desktop still JPEG/PNG.
- **HEIC status:** Not device-verified. Expected: WKWebView decodes many HEICs via `createImageBitmap`/`<img>`. If decode throws, open path keeps placeholder and shows “Could not prepare that image.” If that proves common, next step is a native ImageIO decode bridge — **not** implemented in this spike.

---

## 5. Mobile UI compromise

- `app--compact` when platform is ios/android.
- Image-first viewport; Ask Pixle stays docked.
- Sidebar → bottom sheet via **Adjust**; backdrop dismiss.
- 44px touch targets; Before/After already pointer-based.
- Desktop grid/sidebar **unchanged** when not compact.

---

## 6. Segmentation feasibility

- Segmenter interface, cache, global fallback, stale cancel: **preserved**.
- Metrics recorded into `__pixleFeasibility`: load / first infer / warm infer / heap sample / WASM SIMD+SAB probes.
- **On-device timings: not measured here.**
- If SegFormer is not viable on iPhone: report exact failure; evaluate smaller quantised model, Core ML, or server-side segmentation — **do not rewrite in this PR**.

---

## 7. Gemini / ApiClient

- `ApiClient` boundary added; default `createTauriGeminiApiClient()` → existing Rust command.
- Keys remain in `.env` / Rust process — **not** `VITE_*` / frontend.
- **Production mobile must not ship a reusable Gemini API key.** Future: Pixle mobile → Pixle backend → Gemini. Backend **not** built in this spike (`createPixleBackendApiClient` stub only).

---

## 8. Save to Photos

- iOS `ImageExporter` encodes **full-resolution** edited bytes (same `renderEditedImageBytes`) then `invoke("save_image_to_photos")`.
- Swift `PhotosBridge` uses `PHPhotoLibrary` add-only auth + `creationRequestForAsset`.
- Desktop path untouched (dialog + fs / `save_image_file` fallback).
- Wire-up of Swift file into Xcode Sources is **manual after `ios init`**.

---

## 9. Conversational editing

- No EditSession redesign; document undo vs conversational undo still separate.
- Mobile Changes selection uses the same `onSelectAction` handler inside the sheet.

---

## 10. Performance / device evidence

| Metric | This agent |
| --- | --- |
| App launch / picker / preview | Desktop/web only if run |
| SegFormer load/infer | Node smoke possible; **not iOS WKWebView** |
| Peak memory | Not measured on device |
| Export after edits | Desktop path checked via build/tests |

Fill device table using `scripts/ios-device-test-sequence.md`.

---

## 11. Failure handling (expected)

| Case | Behaviour |
| --- | --- |
| Pick cancel | No-op |
| HEIC unsupported / decode fail | Alert or prepare error; app usable |
| Save permission denied | Status error from bridge |
| Gemini 429/503 | Existing soft messaging |
| Segmenter unavailable | Empty masks → global edits |
| No matching region | Global fallback |
| Rapid image switch | requestId / AbortSignal |
| Export failure | Error status; dirty unchanged |

---

## 12. Desktop regression checks

Run after mobile changes:

```bash
npx tsc --noEmit
npm run build
npm run test:js
cd src-tauri && cargo check && cargo test --lib
# optional desktop smoke (needs display):
DISPLAY=:1 npm run tauri dev
```

---

## 13. Commands

```bash
# JS / TS
npm install
npx tsc --noEmit
npm run build
npm run test:js
npm run test:segformer:smoke   # optional; downloads model

# Rust
cd src-tauri
cargo check
cargo test --lib

# iOS (macOS only)
npx tauri ios init
npx tauri ios build
npx tauri ios dev --device
```

Linux note: `npx tauri ios …` fails with “unrecognized subcommand 'ios'”.

---

## 14. Files changed (high level)

- `src/platform/**` — adapters + metrics
- `src/App.tsx`, `src/App.css`, `src/main.tsx` — wire-up + compact UI
- `src/engine/mask/providers/segformerSegmenter.ts` — metrics hooks only
- `src-tauri/src/{lib,photos}.rs`, `Info.ios.plist`, `tauri.ios.conf.json`, capabilities, ios-bridge
- `docs/**`, `scripts/**`, `package.json`, `README.md`, `AGENTS.md`

---

## 15. Recommendation detail

**A. Continue with Tauri mobile** for the shell + shared React/engine, because:

- Mobile entry point already exists
- Adapters isolate picker/export/API
- Conversational + semantic architecture need not be forked

**C. Plan segmentation contingency** in parallel: if WKWebView ONNX is too slow or jetsams, move to Core ML or server-side **without** rewriting EditSession/Gemini.

**B. Switch wrapper** only if Tauri iOS WKWebView itself blocks Photos, background memory, or App Store constraints after device trials.

**D. Pause** only if signing/device access is unavailable for an extended period *and* SegFormer proves non-viable with no acceptable fallback owner.
