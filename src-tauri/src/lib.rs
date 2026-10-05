mod media;
mod motion;
mod proxy;

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Whether a native backdrop (Mica on Windows 11, vibrancy on macOS) was applied,
/// so the UI knows if it can draw translucent surfaces.
struct Backdrop(bool);

#[derive(Serialize)]
struct PlatformInfo {
    os: &'static str,
    vibrancy: bool,
}

#[tauri::command]
fn platform_info(backdrop: tauri::State<Backdrop>) -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
        vibrancy: backdrop.0,
    }
}

/// Keeps the native window chrome / backdrop in sync with the in-app theme.
/// `None` follows the OS setting.
#[tauri::command]
fn set_window_theme(window: WebviewWindow, dark: Option<bool>) {
    let _ = window.set_theme(dark.map(|d| if d { tauri::Theme::Dark } else { tauri::Theme::Light }));
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_mica(&window, dark);
    }
}

/// Lets the UI write to the terminal log in development builds.
#[tauri::command]
fn debug_log(message: String) {
    #[cfg(debug_assertions)]
    eprintln!("[ui] {message}");
    #[cfg(not(debug_assertions))]
    let _ = message;
}

fn apply_backdrop(window: &WebviewWindow) -> bool {
    #[cfg(target_os = "windows")]
    {
        return window_vibrancy::apply_mica(window, None).is_ok();
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
        return window_vibrancy::apply_vibrancy(
            window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .is_ok();
    }
    #[allow(unreachable_code)]
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("proxy", proxy::handle)
        .manage(motion::MotionState::default())
        .setup(|app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Cadence")
                .inner_size(1320.0, 860.0)
                .min_inner_size(980.0, 640.0)
                .center()
                .transparent(true)
                // Native file-drop handling swallows HTML5 drag & drop on Windows,
                // which the queue and playlists use.
                .disable_drag_drop_handler();

            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            #[cfg(target_os = "windows")]
            let builder = builder.decorations(false).additional_browser_args(
                // Tauri's defaults, plus: let audio start without a click, and keep
                // Chromium from registering its own media session (we drive SMTC ourselves).
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling,MediaSessionService --autoplay-policy=no-user-gesture-required",
            );

            let window = builder.build()?;
            let backdrop = apply_backdrop(&window);
            app.manage(Backdrop(backdrop));
            media::init(app.handle(), &window);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            set_window_theme,
            debug_log,
            media::media_set_metadata,
            media::media_set_playback,
            motion::motion_artwork,
            motion::motion_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cadence");
}
