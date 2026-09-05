use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Holds the path of a .canopy file the OS launched us with (double-click),
// so the frontend can pick it up once on startup instead of racing the
// "file-opened" event against its own listener being registered.
struct PendingFile(Mutex<Option<String>>);

#[tauri::command]
fn get_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingFile(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet, get_pending_file])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // macOS delivers the double-clicked file here, both on cold
            // start and when the app is already running.
            if let RunEvent::Opened { urls } = event {
                let Some(path) = urls.into_iter().find_map(|url| url.to_file_path().ok()) else {
                    return;
                };
                let path = path.to_string_lossy().to_string();
                app_handle.state::<PendingFile>().0.lock().unwrap().replace(path.clone());
                let _ = app_handle.emit("file-opened", path);
            }
        });
}
