use tauri::{Manager, Window};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

#[tauri::command]
async fn ask_ai(question: String, api_key: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-3.5-turbo",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a helpful assistant that provides concise, direct answers. Keep responses brief and to the point, ideally under 100 words. Focus on actionable information."
                },
                {
                    "role": "user",
                    "content": question
                }
            ],
            "max_tokens": 200,
            "temperature": 0.7
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let answer = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("No response received")
        .to_string();

    Ok(answer)
}

#[tauri::command]
fn toggle_window(window: Window) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_window(window: Window) {
    let _ = window.hide();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![ask_ai, toggle_window, hide_window])
        .setup(|app| {
            let handle = app.handle().clone();

            // Register global shortcut Cmd+Shift+Space (or Ctrl+Shift+Space on Windows/Linux)
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["CmdOrCtrl+Shift+Space"])?
                    .with_handler(move |_app, shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(window) = handle.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(),
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
