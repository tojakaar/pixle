import Foundation
import Photos
import UIKit

/// Native Photos write bridge for the Pixle iOS spike.
///
/// Linked into the `pixle_iOS` Xcode target via:
///   - `src-tauri/ios-project.yml` (source path `../../ios-bridge`)
///   - `scripts/sync-ios-photos-bridge.mjs` (also copies into `gen/apple/Sources/`)
///
/// Rust (`src-tauri/src/photos.rs`) declares:
///   `extern "C" fn pixle_save_image_to_photos(...) -> i32`
/// The `@_cdecl` name below MUST match that symbol exactly.

@_cdecl("pixle_save_image_to_photos")
public func pixle_save_image_to_photos(
  _ bytes: UnsafePointer<UInt8>?,
  _ len: Int,
  _ format: UnsafePointer<CChar>?,
  _ outWidth: UnsafeMutablePointer<UInt32>?,
  _ outHeight: UnsafeMutablePointer<UInt32>?,
  _ errBuf: UnsafeMutablePointer<CChar>?,
  _ errBufLen: Int
) -> Int32 {
  func writeError(_ message: String) {
    guard let errBuf, errBufLen > 1 else { return }
    let cString = Array(message.utf8CString.prefix(errBufLen))
    for (i, byte) in cString.enumerated() {
      errBuf[i] = byte
    }
  }

  // `format` is reserved for future HEIC/PNG branching; JPEG/PNG both decode via UIImage.
  _ = format

  guard let bytes, len > 0 else {
    writeError("Empty image payload.")
    return 1
  }

  let data = Data(bytes: bytes, count: len)
  guard let image = UIImage(data: data) else {
    writeError("Could not decode image bytes for Photos.")
    return 2
  }

  let cgWidth = image.cgImage?.width ?? Int(image.size.width * image.scale)
  let cgHeight = image.cgImage?.height ?? Int(image.size.height * image.scale)
  outWidth?.pointee = UInt32(max(0, cgWidth))
  outHeight?.pointee = UInt32(max(0, cgHeight))

  let sema = DispatchSemaphore(value: 0)
  var saveError: String?

  // Photos APIs must be used from a context that can present the permission UI.
  // performChanges callbacks may arrive off-main; the semaphore bridges back to Rust.
  if #available(iOS 14, *) {
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      guard status == .authorized || status == .limited else {
        saveError =
          "Photos permission denied. Enable Photos access for Pixle in Settings."
        sema.signal()
        return
      }

      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.creationRequestForAsset(from: image)
      }, completionHandler: { success, error in
        if !success {
          saveError = error?.localizedDescription ?? "Photos save failed."
        }
        sema.signal()
      })
    }
  } else {
    PHPhotoLibrary.requestAuthorization { status in
      guard status == .authorized else {
        saveError =
          "Photos permission denied. Enable Photos access for Pixle in Settings."
        sema.signal()
        return
      }

      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.creationRequestForAsset(from: image)
      }, completionHandler: { success, error in
        if !success {
          saveError = error?.localizedDescription ?? "Photos save failed."
        }
        sema.signal()
      })
    }
  }

  let waitResult = sema.wait(timeout: .now() + 60)
  if waitResult == .timedOut {
    writeError("Timed out waiting for Photos save.")
    return 3
  }
  if let saveError {
    writeError(saveError)
    return 4
  }
  return 0
}
