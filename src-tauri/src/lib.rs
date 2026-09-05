// The entire Rust surface of PingAsk.
//
// RULE: this file only registers official Tauri plugins. No #[tauri::command],
// no business logic, no serde structs. Every behavior lives in TypeScript and
// reaches the OS through a plugin's JS API. See PLAN.md decision #2.
//
// One exception, below: the macOS activation policy.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // No Dock tile and no Cmd-Tab entry — PingAsk is reached by the hotkey, the
    // way Raycast is. LSUIElement in Info.plist is not enough on its own: tao
    // calls NSApp setActivationPolicy(Regular) when the app finishes launching,
    // which overrides the plist. There is no config key and no JS API for this,
    // so it is the only line of Rust here that isn't a plugin registration.
    #[cfg(target_os = "macos")]
    {
        builder = builder.setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running pingask");
}
