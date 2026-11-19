// Copyright 2026 Alex Degner (alex@ergofox.me)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pub mod media;

use std::time::Instant;
use tauri::{Emitter, Manager};

/// Boot timing marker for launch-performance diagnostics.
static BOOT_STARTED: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// KDE stores the active color scheme in `kdeglobals`; a scheme with "dark"
/// in its name means the dark Breeze variant is in use.
fn system_prefers_dark() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    std::fs::read_to_string(format!("{home}/.config/kdeglobals"))
        .map(|content| {
            content.lines().any(|line| {
                let line = line.trim_start();
                (line.starts_with("ColorScheme") || line.starts_with("LookAndFeelPackage"))
                    && line.to_ascii_lowercase().contains("dark")
            })
        })
        .unwrap_or(false)
}

/// The splash background colors, matching the app palette.
const SPLASH_DARK: tauri::window::Color = tauri::window::Color(35, 38, 41, 255);
const SPLASH_LIGHT: tauri::window::Color = tauri::window::Color(239, 240, 241, 255);

/// Called by the frontend as soon as the splash screen is rendered, to reveal
/// the hidden window (no blank/white flash on startup). Also hands over a
/// video path passed on the command line, if there was one: the frontend
/// listener is only registered by now, so an earlier emit would be lost.
#[tauri::command]
fn app_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    if let Some(started) = BOOT_STARTED.get() {
        eprintln!("[boot] frontend ready after {} ms", started.elapsed().as_millis());
    }
    let _ = window.show();
    if let Some(path) = app
        .state::<std::sync::Mutex<Option<String>>>()
        .lock()
        .ok()
        .and_then(|mut pending| pending.take())
    {
        let _ = app.emit("cli-open", path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = BOOT_STARTED.set(Instant::now());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_ready,
            media::audio_waveform,
            media::open_video,
            media::snapshot_video,
            media::export_video
        ])
        .setup(|app| {
            // Command line: a video path can be passed as the first argument
            // and is opened as soon as the frontend is ready.
            let cli_path = std::env::args().nth(1).and_then(|arg| {
                let path = std::path::PathBuf::from(&arg);
                let path = std::fs::canonicalize(&path).ok()?;
                if path.is_file() {
                    let _ = app.asset_protocol_scope().allow_file(&path);
                    Some(path.to_string_lossy().into_owned())
                } else {
                    None
                }
            });
            app.manage(std::sync::Mutex::new(cli_path));

            // Reveal the window immediately with a background that matches
            // the system theme, so launch never shows a blank foreign-color
            // rectangle; the splash paints as soon as the webview is up.
            if let Some(window) = app.get_webview_window("main") {
                let background = if system_prefers_dark() {
                    SPLASH_DARK
                } else {
                    SPLASH_LIGHT
                };
                let _ = window.set_background_color(Some(background));
                let _ = window.show();
            }
            if let Some(started) = BOOT_STARTED.get() {
                eprintln!("[boot] tauri setup done after {} ms", started.elapsed().as_millis());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(event) = event {
                // The regular `tauri://drag-drop` event delivery is
                // unreliable under some setups (XWayland bridging), so drag
                // and drop is bridged into the webview directly via eval.
                let script = match event {
                    tauri::DragDropEvent::Enter { .. } | tauri::DragDropEvent::Over { .. } => {
                        Some("window.__onNativeDragState && window.__onNativeDragState(true);".to_string())
                    }
                    tauri::DragDropEvent::Leave => {
                        Some("window.__onNativeDragState && window.__onNativeDragState(false);".to_string())
                    }
                    tauri::DragDropEvent::Drop { paths, .. } => {
                        if paths.is_empty() {
                            None
                        } else {
                            let payload = serde_json::to_string(paths)
                                .unwrap_or_else(|_| "[]".to_string());
                            Some(format!(
                                "window.__onNativeDrop && window.__onNativeDrop({payload});"
                            ))
                        }
                    }
                    _ => None,
                };
                if let Some(script) = script {
                    if let Some(webview) = window.get_webview_window(window.label()) {
                        let _ = webview.eval(&script);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
