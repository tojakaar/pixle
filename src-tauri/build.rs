fn main() {
    tauri_build::build();

    // Tauri keeps `crate-type = ["staticlib", "cdylib", "rlib"]` so Android still
    // gets a shared library. On Apple iOS targets, `cargo build --lib` therefore
    // also links a cdylib. That link happens in the Xcode "Build Rust Code" phase
    // *before* `PhotosBridge.swift` is compiled into the app target.
    //
    // Rust references `pixle_save_image_to_photos` via `extern "C"` (see
    // `src/photos.rs`); Swift exports the real implementation with
    // `@_cdecl("pixle_save_image_to_photos")`. Allow that single undefined
    // symbol while linking the iOS cdylib so cargo can finish and emit
    // `libpixle_lib.a`. The final app link still requires the Swift file to be a
    // Compile Sources member of `pixle_iOS` (ios-project.yml / ios:sync-bridge).
    //
    // This is not a stub — the Photos write path remains the Swift bridge.
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-U,_pixle_save_image_to_photos");
    }
}
