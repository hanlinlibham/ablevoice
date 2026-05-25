// able-asr Tauri shell.
//
// Native capabilities layered on top of the webview:
//   1. System tray icon (menubar on mac) — single-click toggles main
//      window visibility so the app behaves like a menubar utility.
//   2. Global shortcut (Cmd+Shift+Space) — emits the frontend event
//      ``voice-toggle-record`` which the React side wires to its
//      push-to-talk action. Lets the user start/stop recording from
//      anywhere on the OS.
//   3. (Existing) tauri-plugin-log for dev logging.
//
// Keep this file small — config + plugin wiring only. App logic lives
// in the React frontend.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const TOGGLE_RECORD_EVENT: &str = "voice-toggle-record";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Only fire on key DOWN — releases are not reliable
                    // across keyboard layouts for global shortcuts, and
                    // toggle semantics match the in-app Space behaviour.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let toggle = Shortcut::new(
                        Some(Modifiers::SUPER | Modifiers::SHIFT),
                        Code::Space,
                    );
                    if shortcut != &toggle {
                        return;
                    }
                    log::info!("global shortcut fired → emit {}", TOGGLE_RECORD_EVENT);
                    // Show + focus window so the user sees the recording
                    // bar even when triggered from another app.
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                    let _ = app.emit(TOGGLE_RECORD_EVENT, ());
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Register Cmd+Shift+Space (SUPER = ⌘ on mac / ⊞ on win).
            let toggle =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
            app.global_shortcut().register(toggle)?;

            // System tray — menubar utility pattern. Single left-click
            // toggles window visibility; right-click → menu.
            let show_item = MenuItem::with_id(app, "show", "Show able-asr", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("able-asr · ⌘⇧Space 录音")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let is_visible = win.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
