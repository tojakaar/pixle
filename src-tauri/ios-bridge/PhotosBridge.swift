import Foundation
import Photos
import UIKit

/// Minimal Swift bridge for the Pixle iOS feasibility spike.
///
/// After `npx tauri ios init` on macOS, copy this file into:
///   src-tauri/gen/apple/Sources/pixle/
/// (or the Sources group shown in the generated Xcode project) and ensure it
/// is a member of the iOS app target. The Rust command `save_image_to_photos`
/// calls `pixle_save_image_to_photos` below.
///
/// Permissions (Info.ios.plist):
///   NSPhotoLibraryAddUsageDescription — required to write
///   NSPhotoLibraryUsageDescription — optional read (picker uses PHPicker)

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
    let data = Array(message.utf8CString.prefix(errBufLen))
    for (i, byte) in data.enumerated() {
      errBuf[i] = byte
    }
  }

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

  PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
    guard status == .authorized || status == .limited else {
      saveError = "Photos permission denied. Enable Photos access for Pixle in Settings."
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
