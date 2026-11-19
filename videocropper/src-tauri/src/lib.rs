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

use tauri::Manager;

/// Called by the frontend as soon as the splash screen is rendered, to reveal
/// the hidden window (no blank/white flash on startup).
#[tauri::command]
fn app_ready(window: tauri::WebviewWindow) {
    let _ = window.show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_ready,
            media::audio_waveform,
            media::open_video,
            media::snapshot_video,
            media::export_video
        ])
        .setup(|app| {
            // Fallback: if the frontend never calls `app_ready` (e.g. the page
            // failed to load), still show the window after a short delay.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
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
