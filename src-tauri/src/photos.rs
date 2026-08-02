//! Photos library save adapter for the iOS feasibility spike.
//!
//! - Desktop / non-iOS: stub that returns a clear error (desktop uses dialog+fs).
//! - iOS: calls the Swift `@_cdecl("pixle_save_image_to_photos")` export.
//!
//! The Swift file lives at `ios-bridge/PhotosBridge.swift` and is compiled into
//! the `pixle_iOS` target via `ios-project.yml` (+ `npm run ios:sync-bridge`).
//! See `ios-bridge/README.md`.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotosSaveResult {
    pub width: u32,
    pub height: u32,
    pub bytes_written: usize,
    pub format: String,
}

/// Save full-resolution edited image bytes into the iOS Photos library.
#[tauri::command]
pub async fn save_image_to_photos(
    bytes: Vec<u8>,
    format: String,
    file_name: String,
) -> Result<PhotosSaveResult, String> {
    let format = format.to_ascii_lowercase();
    if !matches!(format.as_str(), "jpg" | "jpeg" | "png") {
        return Err("Photos export supports jpeg or png only.".to_string());
    }
    if bytes.is_empty() {
        return Err("Cannot save an empty image.".to_string());
    }
    if bytes.len() > 120 * 1024 * 1024 {
        return Err("Image is too large to save safely on this device.".to_string());
    }

    #[cfg(target_os = "ios")]
    {
        return ios::save_to_photos(bytes, &format, &file_name);
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (bytes, file_name);
        Err(
            "save_image_to_photos is only available on iOS. \
             On desktop, use the filesystem export dialog."
                .to_string(),
        )
    }
}

#[cfg(target_os = "ios")]
mod ios {
    use super::PhotosSaveResult;
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    extern "C" {
        /// Implemented in `ios-bridge/PhotosBridge.swift` with
        /// `@_cdecl("pixle_save_image_to_photos")`. Must be linked via the
        /// `pixle_iOS` Xcode target (see `npm run ios:sync-bridge`).
        fn pixle_save_image_to_photos(
            bytes: *const u8,
            len: usize,
            format: *const c_char,
            out_width: *mut u32,
            out_height: *mut u32,
            err_buf: *mut c_char,
            err_buf_len: usize,
        ) -> i32;
    }

    pub fn save_to_photos(
        bytes: Vec<u8>,
        format: &str,
        _file_name: &str,
    ) -> Result<PhotosSaveResult, String> {
        let format_c = CString::new(format).map_err(|_| "Invalid format".to_string())?;
        let mut width: u32 = 0;
        let mut height: u32 = 0;
        let mut err = vec![0i8; 512];

        let rc = unsafe {
            pixle_save_image_to_photos(
                bytes.as_ptr(),
                bytes.len(),
                format_c.as_ptr(),
                &mut width,
                &mut height,
                err.as_mut_ptr(),
                err.len(),
            )
        };

        if rc == 0 {
            return Ok(PhotosSaveResult {
                width,
                height,
                bytes_written: bytes.len(),
                format: format.to_string(),
            });
        }

        let message = unsafe { CStr::from_ptr(err.as_ptr()) }
            .to_string_lossy()
            .trim()
            .to_string();
        if message.is_empty() {
            Err("Photos save failed (unknown error).".to_string())
        } else {
            Err(message)
        }
    }
}
