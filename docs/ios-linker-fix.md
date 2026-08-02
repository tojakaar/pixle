# iOS linker fix: `_pixle_save_image_to_photos`

## Exact cause

Rust (`src-tauri/src/photos.rs`) compiles an `extern "C"` reference to
`pixle_save_image_to_photos` on `target_os = "ios"`.

The Swift implementation (`src-tauri/ios-bridge/PhotosBridge.swift`) correctly
exports that name with:

```swift
@_cdecl("pixle_save_image_to_photos")
```

But the Swift file was **not a member of the generated `pixle_iOS` Xcode
target**. It lived only under `ios-bridge/` with a manual copy instruction that
was never applied to `gen/apple` (and would be wiped on re-init anyway).

So the Rust staticlib built, then the final app link failed:

```text
Undefined symbols for architecture arm64:
  "_pixle_save_image_to_photos", referenced from:
      ... pixle_lib::photos::ios::save_to_photos ...
ld: symbol(s) not found for architecture arm64
```

Not an ABI mismatch, missing `@_cdecl`, or wrong symbol spelling — **missing
target membership / compile of the Swift translation unit**.

## Fix

1. Custom XcodeGen template `src-tauri/ios-project.yml` adds source
   `../../ios-bridge` and `Photos.framework`.
2. `bundle.iOS.template` + `frameworks: ["Photos"]` in Tauri config.
3. `npm run ios:sync-bridge` copies the Swift file into `gen/apple/Sources/`,
   patches an existing `project.yml`, and regenerates via `xcodegen`.

## macOS rebuild

```bash
npm run ios:sync-bridge
npm run ios:dev
# or: npx tauri ios dev
```

If `gen/apple` was created before this fix, sync (or re-init) is required once.
