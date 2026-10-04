use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

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

// Called by the frontend once it has asked about unsaved maps (see the
// "quit-requested" listener in main.ts).
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// The File menu's Open Recent submenu and the paths behind its items. The
// list itself lives in the frontend (localStorage, see recentFiles.ts),
// which sends it here whenever it changes.
#[derive(Default)]
struct RecentMenu(Mutex<(Option<tauri::menu::Submenu<tauri::Wry>>, Vec<String>)>);

#[derive(Clone, serde::Serialize)]
struct MenuCommand {
    command: String,
    path: Option<String>,
}

#[tauri::command]
fn set_recent_files(app: AppHandle, paths: Vec<String>) -> tauri::Result<()> {
    use tauri::menu::MenuItem;
    let state = app.state::<RecentMenu>();
    let mut guard = state.0.lock().unwrap();
    if let Some(submenu) = &guard.0 {
        for item in submenu.items()? {
            submenu.remove(&item)?;
        }
        if paths.is_empty() {
            submenu.append(&MenuItem::new(&app, "No Recent Files", false, None::<&str>)?)?;
        }
        for (i, path) in paths.iter().enumerate() {
            let name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            submenu.append(&MenuItem::with_id(&app, format!("recent:{i}"), name, true, None::<&str>)?)?;
        }
    }
    guard.1 = paths;
    Ok(())
}

// On macOS the default menu's Quit item (⌘Q) terminates the app at once;
// tao handles only applicationWillTerminate, so nothing can stop it to ask
// about unsaved changes. It is replaced by an item that asks the frontend
// first. The default File menu holds only Close Window, so New, Open,
// Open Recent, Save and Save As go above it; each sends a "menu-command"
// event that main.ts routes to the active map.
#[cfg(target_os = "macos")]
fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
    let menu = Menu::default(app.handle())?;
    let mut submenus = menu.items()?.into_iter().filter_map(|item| match item {
        MenuItemKind::Submenu(submenu) => Some(submenu),
        _ => None,
    });
    if let Some(app_menu) = submenus.next() {
        let quit_index = app_menu.items()?.len().saturating_sub(1);
        app_menu.remove_at(quit_index)?;
        app_menu.append(&MenuItem::with_id(app, "quit", "Quit Canopy", true, Some("CmdOrCtrl+Q"))?)?;
    }
    if let Some(file_menu) = submenus.next() {
        let recent = Submenu::with_items(
            app,
            "Open Recent",
            true,
            &[&MenuItem::new(app, "No Recent Files", false, None::<&str>)?],
        )?;
        file_menu.insert_items(
            &[
                &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
                &MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?,
                &recent,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
                &MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?,
                &PredefinedMenuItem::separator(app)?,
            ],
            0,
        )?;
        app.state::<RecentMenu>().0.lock().unwrap().0 = Some(recent);
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingFile(Mutex::new(None)))
        .manage(RecentMenu::default())
        .invoke_handler(tauri::generate_handler![greet, get_pending_file, quit_app, set_recent_files])
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            install_menu(_app)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "quit" {
                let _ = app.emit("quit-requested", ());
                return;
            }
            let (command, path) = match id.strip_prefix("recent:") {
                Some(index) => {
                    let state = app.state::<RecentMenu>();
                    let guard = state.0.lock().unwrap();
                    let Some(path) = index.parse::<usize>().ok().and_then(|i| guard.1.get(i).cloned()) else {
                        return;
                    };
                    ("open-recent".to_string(), Some(path))
                }
                None if ["new", "open", "save", "save-as"].contains(&id) => (id.to_string(), None),
                None => return,
            };
            let _ = app.emit("menu-command", MenuCommand { command, path });
        })
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
