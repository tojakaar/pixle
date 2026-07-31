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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env_files();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![edit_from_prompt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
