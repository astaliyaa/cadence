//! OS "Now Playing" integration: SMTC on Windows, MPNowPlayingInfoCenter on macOS,
//! MPRIS on Linux. Media keys and the OS overlay are forwarded to the UI as
//! `media-control` events.

use serde::Serialize;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub struct Controls(MediaControls);
// Only ever touched from synchronous commands, which Tauri runs on the main thread.
unsafe impl Send for Controls {}

pub struct Media(Mutex<Option<Controls>>);

#[derive(Clone, Serialize)]
struct ControlEvent {
    kind: &'static str,
    value: Option<f64>,
}

pub fn init(app: &AppHandle, window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    let hwnd = window.hwnd().ok().map(|h| h.0 as *mut std::ffi::c_void);
    #[cfg(not(target_os = "windows"))]
    let hwnd = {
        let _ = window;
        None
    };

    let config = PlatformConfig {
        dbus_name: "cadence",
        display_name: "Cadence",
        hwnd,
    };

    let controls = match MediaControls::new(config) {
        Ok(mut controls) => {
            let handle = app.clone();
            let attached = controls.attach(move |event| {
                let (kind, value) = match event {
                    MediaControlEvent::Play => ("play", None),
                    MediaControlEvent::Pause => ("pause", None),
                    MediaControlEvent::Toggle => ("toggle", None),
                    MediaControlEvent::Next => ("next", None),
                    MediaControlEvent::Previous => ("previous", None),
                    MediaControlEvent::Stop => ("stop", None),
                    MediaControlEvent::SetPosition(MediaPosition(pos)) => {
                        ("seek", Some(pos.as_secs_f64()))
                    }
                    MediaControlEvent::Seek(dir) => ("seekBy", Some(signed(dir, 10.0))),
                    MediaControlEvent::SeekBy(dir, by) => {
                        ("seekBy", Some(signed(dir, by.as_secs_f64())))
                    }
                    MediaControlEvent::SetVolume(v) => ("volume", Some(v)),
                    MediaControlEvent::Raise => ("raise", None),
                    _ => return,
                };
                if kind == "raise" {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
                let _ = handle.emit("media-control", ControlEvent { kind, value });
            });
            match attached {
                Ok(()) => Some(Controls(controls)),
                Err(e) => {
                    eprintln!("media controls: attach failed: {e:?}");
                    None
                }
            }
        }
        Err(e) => {
            eprintln!("media controls unavailable: {e:?}");
            None
        }
    };

    app.manage(Media(Mutex::new(controls)));
}

fn signed(dir: SeekDirection, secs: f64) -> f64 {
    match dir {
        SeekDirection::Forward => secs,
        SeekDirection::Backward => -secs,
    }
}

#[tauri::command]
pub fn media_set_metadata(
    state: tauri::State<Media>,
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    duration: Option<f64>,
) {
    if let Some(c) = state.0.lock().unwrap().as_mut() {
        let _ = c.0.set_metadata(MediaMetadata {
            title: Some(&title),
            artist: Some(&artist),
            album: Some(&album),
            cover_url: cover_url.as_deref(),
            duration: duration.filter(|d| d.is_finite() && *d > 0.0).map(Duration::from_secs_f64),
        });
    }
}

#[tauri::command]
pub fn media_set_playback(state: tauri::State<Media>, status: String, position: Option<f64>) {
    let progress = position
        .filter(|p| p.is_finite() && *p >= 0.0)
        .map(|p| MediaPosition(Duration::from_secs_f64(p)));
    let playback = match status.as_str() {
        "playing" => MediaPlayback::Playing { progress },
        "paused" => MediaPlayback::Paused { progress },
        _ => MediaPlayback::Stopped,
    };
    if let Some(c) = state.0.lock().unwrap().as_mut() {
        let _ = c.0.set_playback(playback);
    }
}
