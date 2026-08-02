# iOS linker fix: `_pixle_save_image_to_photos`

## Exact cause

Rust (`src-tauri/src/photos.rs`) compiles an `extern "C"` reference to
`pixle_save_image_to_photos` on `target_os = "ios"`.

The Swift implementation (`src-tauri/ios-bridge/PhotosBridge.swift`) correctly
exports that name with:

```swift
@_cdecl("pixle_save_image_to_photos")
```

Two separate link stages were involved:

### 1. Rust/cargo cdylib link (the reported failure)

`Cargo.toml` uses `crate-type = ["staticlib", "cdylib", "rlib"]` (required for
Android). On Apple iOS targets, `cargo build --lib` therefore also links a
**cdylib**. That runs in Xcode’s **Build Rust Code** phase *before* any app
Swift sources are compiled.

Apple’s linker rejects unresolved externs for cdylibs, so rustc reports:

```text
error: linking with `cc` failed
Undefined symbols for architecture arm64:
  "_pixle_save_image_to_photos", referenced from:
      ... pixle_lib::photos::ios::save_to_photos ...
ld: symbol(s) not found for architecture arm64
clang: error: linker command failed with exit code 1
```

This is **not** an ABI mismatch, missing `@_cdecl`, or wrong symbol spelling.
The real Swift export simply is not available yet at cargo link time.

### 2. Final Xcode app link

Even after cargo succeeds, the app link still needs `PhotosBridge.swift` as a
Compile Sources member of `pixle_iOS`. Otherwise the staticlib’s undefined
reference never gets a definition.

## Fix

1. **`src-tauri/build.rs`** — for `*apple-ios*` targets, emit
   `cargo:rustc-cdylib-link-arg=-Wl,-U,_pixle_save_image_to_photos` so the iOS
   cdylib may leave that one symbol undefined. This is **not** a stub; the
   Photos write path remains the Swift bridge.
2. **Custom XcodeGen template** `src-tauri/ios-project.yml` — adds source
   `../../ios-bridge` and `Photos.framework`.
3. **`bundle.iOS.template` + `frameworks: ["Photos"]`** in Tauri config.
4. **`npm run ios:sync-bridge`** — patches an existing `gen/apple/project.yml`
   and regenerates via `xcodegen` (avoids double-compiling the Swift file).

## macOS rebuild

```bash
npm run ios:sync-bridge
npm run ios:dev
# or: npx tauri ios dev
```

If `gen/apple` was created before the template landed, sync (or re-init) once.
