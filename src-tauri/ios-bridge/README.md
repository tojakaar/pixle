# iOS Photos bridge

`PhotosBridge.swift` exports the C symbol `pixle_save_image_to_photos`, which the
Rust command `save_image_to_photos` (`src-tauri/src/photos.rs`) calls on iOS.

## Why the linker failed

Rust compiled with:

```rust
extern "C" { fn pixle_save_image_to_photos(...); }
```

but the Swift file was only stored under `ios-bridge/` and was **not** a member
of the generated `pixle_iOS` Xcode target — so the final app link reported:

```text
Undefined symbols for architecture arm64: "_pixle_save_image_to_photos"
```

## Durable inclusion

1. **Custom XcodeGen template** — `src-tauri/ios-project.yml` adds
   `../../ios-bridge` as a Sources entry and links `Photos.framework`.
   Configured via `bundle.iOS.template` in `tauri.conf.json` /
   `tauri.ios.conf.json`.

2. **Sync script** — for an already-generated `gen/apple` tree:

   ```bash
   npm run ios:sync-bridge
   ```

   This copies the Swift file into `gen/apple/Sources/`, patches `project.yml`
   if needed, and regenerates the Xcode project with `xcodegen` when available.

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

## Verify the symbol is in the target

In Xcode: target `pixle_iOS` → Build Phases → Compile Sources must list
`PhotosBridge.swift` (from Sources and/or PixleBridge group).

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
