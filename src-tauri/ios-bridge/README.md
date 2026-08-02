# iOS Photos bridge

`PhotosBridge.swift` exports the C symbol `pixle_save_image_to_photos`, which the
Rust command `save_image_to_photos` (`src-tauri/src/photos.rs`) calls on iOS.

## Why the linker failed

Rust compiles with:

```rust
extern "C" { fn pixle_save_image_to_photos(...); }
```

Two things broke the iOS simulator build:

1. **Cargo cdylib link** (Xcode “Build Rust Code”) — Apple rejects unresolved
   externs while linking the cdylib crate type, producing
   `error: linking with \`cc\` failed` / undefined `_pixle_save_image_to_photos`
   *before* any Swift is compiled. Fixed in `src-tauri/build.rs` by allowing
   that one symbol (`-Wl,-U,_pixle_save_image_to_photos`). Not a stub.
2. **Final app link** — `PhotosBridge.swift` must be a Compile Sources member of
   `pixle_iOS` so the real `@_cdecl` export is present.

## Durable inclusion

1. **`build.rs`** — allows the undefined symbol for iOS cdylibs only.
2. **Custom XcodeGen template** — `src-tauri/ios-project.yml` adds
   `../../ios-bridge` as a Sources entry and links `Photos.framework`.
   Configured via `bundle.iOS.template` in `tauri.conf.json` /
   `tauri.ios.conf.json`.
3. **Sync script** — for an already-generated `gen/apple` tree:

   ```bash
   npm run ios:sync-bridge
   ```

   Patches `project.yml` if needed and regenerates with `xcodegen`.

## Commands (macOS)

```bash
# First-time or after wiping gen/apple:
npx tauri ios init
npm run ios:sync-bridge   # safe even right after init

# Everyday:
npm run ios:dev           # syncs bridge then `tauri ios dev`
# or:
npm run ios:sync-bridge && npx tauri ios dev
```

## Verify the Swift export

The Swift entry must use the exact C name Rust expects:

```swift
@_cdecl("pixle_save_image_to_photos")
public func pixle_save_image_to_photos(
  _ bytes: UnsafePointer<UInt8>?,
  _ len: Int,
  _ format: UnsafePointer<CChar>?,
  _ outWidth: UnsafeMutablePointer<UInt32>?,
  _ outHeight: UnsafeMutablePointer<UInt32>?,
  _ errBuf: UnsafeMutablePointer<CChar>?,
  _ errBufLen: Int
) -> Int32 { ... }
```

In Xcode: target `pixle_iOS` → Build Phases → Compile Sources must list
`PhotosBridge.swift` (PixleBridge group from `../../ios-bridge`).

Or after a simulator build:

```bash
nm -g "src-tauri/gen/apple/build/..."  # or the app binary
# expect: T _pixle_save_image_to_photos
```

## Notes

- Do not stub out `pixle_save_image_to_photos` to silence the linker.
- Desktop builds never call this symbol (`#[cfg(target_os = "ios")]`).
- Image picking still uses the HTML file input / PHPicker and does not need
  this bridge.
