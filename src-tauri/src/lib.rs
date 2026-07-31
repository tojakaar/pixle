mod ai_editor;

use ai_editor::edit_from_prompt;
use std::path::{Path, PathBuf};

fn load_env_files() {
    // Resolve from the Cargo package dir so keys load even when the process
    // cwd is not `src-tauri/` (common with `tauri dev` on macOS).
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../.env"),
        manifest_dir.join(".env"),
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
    ];

    for path in candidates {
        if path.is_file() {
            // Keep the first successful load; later files do not override.
            if dotenvy::from_path(&path).is_ok() {
                break;
            }
        }
    }
}

/// Fallback binary write for export. Prefer the fs plugin from the frontend;
/// this remains available if a caller needs an unconstrained absolute path.
#[tauri::command]
fn save_image_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
        return Err("Export path must end with .jpg, .jpeg, or .png.".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("Export folder does not exist: {}", parent.display()));
        }
    }
    std::fs::write(&target, bytes).map_err(|e| format!("Failed to save image: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env_files();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![edit_from_prompt, save_image_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
