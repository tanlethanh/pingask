use tauri::{Emitter, Manager, Window};
use tauri_plugin_global_shortcut::ShortcutState;
use futures_util::StreamExt;

#[tauri::command]
async fn ask_ai(question: String, api_key: String, window: Window) -> Result<(), String> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                {
                    "role": "system",
                    "content": "Give concise answers. For quick facts/commands: just the super short, concise, essential answer. For 'how to' questions: real short brief steps (max 100 words)."
                },
                {
                    "role": "user",
                    "content": question
                }
            ],
            "max_tokens": 100,
            "temperature": 0,
            "stream": true
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    return Ok(());
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        let _ = window.emit("ai-response-chunk", content);
                    }
                }
            }
        }
    }

    Ok(())
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
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![ask_ai, toggle_window, hide_window])
        .setup(|app| {
            let handle = app.handle().clone();

            // Register global shortcut Cmd+Shift+Space (or Ctrl+Shift+Space on Windows/Linux)
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["CmdOrCtrl+Shift+Space"])?
                    .with_handler(move |_app, _shortcut, event| {
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
