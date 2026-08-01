# iOS Photos bridge (spike)

`PhotosBridge.swift` implements `pixle_save_image_to_photos`, called from the
Rust command `save_image_to_photos` on `target_os = "ios"`.

## Wire-up (macOS only)

1. Install prerequisites (Xcode, CocoaPods, Rust iOS targets) — see
   `docs/ios-feasibility-spike.md`.
2. From the repo root:

   ```bash
   npx tauri ios init
   ```

3. Copy the bridge into the generated Xcode Sources group:

   ```bash
   cp src-tauri/ios-bridge/PhotosBridge.swift \
     src-tauri/gen/apple/Sources/pixle/PhotosBridge.swift
   ```

   If the Sources path differs, open `src-tauri/gen/apple/*.xcodeproj` and add
   the file to the iOS app target manually.

4. Confirm `Info.ios.plist` keys are present (repo already includes them):
   - `NSPhotoLibraryAddUsageDescription`
   - `NSPhotoLibraryUsageDescription`

5. Build / run:

   ```bash
   npx tauri ios dev
   ```

## Notes

- Image **picking** uses the HTML `<input type="file">` → system PHPicker.
  That path does not require this Swift bridge.
- Image **saving** requires this bridge (or an equivalent Photos plugin).
- Do not claim device save works until exercised on a real iPhone.
