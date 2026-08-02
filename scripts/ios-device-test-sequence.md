# iOS device test sequence (manual)

Run on **macOS + Xcode**. Do not treat simulator timings as device proof.

## Prerequisites

- [ ] macOS with Xcode (iOS SDK)
- [ ] Apple development team / signing configured
- [ ] `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`
- [ ] CocoaPods (`sudo gem install cocoapods` or Homebrew)
- [ ] `.env` with `GEMINI_API_KEY` for local device AI only (never ship in release)
- [ ] `npm install`
- [ ] `npx tauri ios init` (once)
- [ ] `npm run ios:sync-bridge` (includes PhotosBridge.swift in `pixle_iOS`)

## Build / run

```bash
npm install
npx tauri ios init          # first time only, macOS
npm run ios:sync-bridge     # required — fixes undefined _pixle_save_image_to_photos
npm run ios:dev             # or: npx tauri ios dev --device
```

## Sequence

1. **Cold launch** — note time to interactive UI; inspect `window.__pixleFeasibility`.
2. **Photos open** — pick a large recent JPEG (12MP+). Confirm placeholder appears immediately, then editable preview.
3. **Portrait + landscape** — open one of each; confirm orientation correct.
4. **HEIC** — open a native HEIC. If decode fails, record exact error (see spike report HEIC section).
5. **Global edit** — Ask Pixle: `darken the sky` (may be semantic). Also try a clear global: `make it warmer`.
6. **Semantic follow-ups** — `a little more` → `make the trees greener` → `not that much` → `undo that` → `redo that`.
7. **Changes tab** — open Adjust sheet → Changes; tap an action; confirm intensity binds; touch must not clear selection oddly.
8. **Before/After** — hold and tap-toggle on touch.
9. **Segmentation** — watch status “Segmenting…”; record `segformer_load_ms`, `segformer_first_infer_ms`, `segformer_warm_infer_ms` from `__pixleFeasibility`.
10. **Cached semantic edit** — second sky/trees edit after masks ready; compare latency.
11. **Export** — Save to Photos; verify dimensions match source (not preview); open in Photos app.
12. **Permission denial** — Settings → Pixle → Photos off; confirm open/save errors are clean and app stays usable.
13. **Rapid image switching** — open 5 images quickly; no freeze/crash; latest wins.
14. **Background/foreground** — background during segmentation and during export; resume.
15. **Memory** — note any jetsam/crash; sample `__pixleFeasibility.metrics.peak_js_heap_mb` if present.
16. **Gemini errors** — throttle/disable network briefly for 429/503 soft messages.

## Record

Paste `JSON.stringify(window.__pixleFeasibility, null, 2)` into the spike report device section.
