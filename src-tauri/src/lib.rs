mod ai_editor;

use ai_editor::edit_from_prompt;

fn load_env_files() {
    // Prefer project-root `.env`, then `src-tauri/.env`. Existing process env wins.
    let _ = dotenvy::from_filename("../.env");
    let _ = dotenvy::dotenv();
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
