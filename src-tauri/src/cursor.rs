//! Cursor tracking on Hyprland.
//!
//! The ScreenCast portal is the standard way to get cursor position alongside
//! captured frames, but it only does so in `CursorMode::Metadata`, and
//! xdg-desktop-portal-hyprland advertises `Hidden | Embedded` only. So the
//! coordinates have to come from somewhere else.
//!
//! Hyprland's own IPC socket answers `cursorpos` in well under a millisecond,
//! which makes straightforward polling viable — no compositor patches, no
//! elevated privileges, no reading input devices directly.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// One cursor position, timestamped from the start of the recording.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct CursorSample {
    /// Seconds since recording start.
    pub t: f64,
    /// Position in captured-frame pixels, top-left origin.
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f32,
}

fn socket_path() -> Result<PathBuf, String> {
    let runtime = std::env::var("XDG_RUNTIME_DIR")
        .map_err(|_| "XDG_RUNTIME_DIR is not set".to_string())?;
    let sig = std::env::var("HYPRLAND_INSTANCE_SIGNATURE")
        .map_err(|_| "not running under Hyprland (no instance signature)".to_string())?;
    Ok(PathBuf::from(runtime).join("hypr").join(sig).join(".socket.sock"))
}

/// Hyprland closes the connection after answering, so each request opens its
/// own socket. At ~0.04 ms a round trip this is cheaper than any machinery to
/// avoid it would be.
fn request(cmd: &str) -> Result<String, String> {
    let mut stream = UnixStream::connect(socket_path()?)
        .map_err(|e| format!("could not reach Hyprland's IPC socket: {e}"))?;
    stream
        .write_all(cmd.as_bytes())
        .map_err(|e| format!("IPC write failed: {e}"))?;
    let mut out = String::new();
    stream
        .read_to_string(&mut out)
        .map_err(|e| format!("IPC read failed: {e}"))?;
    Ok(out)
}

pub fn monitors() -> Result<Vec<Monitor>, String> {
    let raw = request("j/monitors")?;
    serde_json::from_str(&raw).map_err(|e| format!("could not parse monitors: {e}"))
}

/// Cursor position in global compositor coordinates.
fn cursor_pos() -> Result<(f32, f32), String> {
    let raw = request("cursorpos")?;
    let (a, b) = raw
        .trim()
        .split_once(',')
        .ok_or_else(|| format!("unexpected cursorpos reply: {raw:?}"))?;
    let x = a.trim().parse::<f32>().map_err(|e| e.to_string())?;
    let y = b.trim().parse::<f32>().map_err(|e| e.to_string())?;
    Ok((x, y))
}

/// Samples the cursor on its own thread for the length of a recording.
pub struct CursorTracker {
    stop: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<CursorSample>>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl CursorTracker {
    /// Start sampling. `monitor` places the captured region in global
    /// coordinates so samples come out in frame pixels; the caller knows which
    /// output the portal handed over.
    pub fn start(monitor: Monitor, hz: u32) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let samples = Arc::new(Mutex::new(Vec::<CursorSample>::new()));

        let stop_thread = stop.clone();
        let samples_thread = samples.clone();

        let handle = std::thread::spawn(move || {
            let started = Instant::now();
            let interval = Duration::from_secs_f64(1.0 / hz.max(1) as f64);

            while !stop_thread.load(Ordering::Relaxed) {
                let tick = Instant::now();

                if let Ok((gx, gy)) = cursor_pos() {
                    // Hyprland reports logical coordinates; the captured frame
                    // is in physical pixels, so fold the monitor's scale in.
                    let x = (gx - monitor.x as f32) * monitor.scale;
                    let y = (gy - monitor.y as f32) * monitor.scale;
                    let sample = CursorSample {
                        t: started.elapsed().as_secs_f64(),
                        x,
                        y,
                    };
                    if let Ok(mut v) = samples_thread.lock() {
                        v.push(sample);
                    }
                }

                // Sleep the remainder of the tick rather than a fixed amount,
                // so a slow poll doesn't make the whole track drift late.
                if let Some(rest) = interval.checked_sub(tick.elapsed()) {
                    std::thread::sleep(rest);
                }
            }
        });

        Self {
            stop,
            samples,
            handle: Some(handle),
        }
    }

    pub fn stop(mut self) -> Vec<CursorSample> {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        let guard = self.samples.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    }
}

/// Sample the cursor for a fixed window without recording video.
///
/// Lets the cursor half of the pipeline be verified on its own, before the
/// capture and encoding work exists to test it with.
#[tauri::command]
pub async fn cursor_probe(ms: u64) -> Result<serde_json::Value, String> {
    let mons = monitors()?;
    let monitor = mons
        .into_iter()
        .next()
        .ok_or_else(|| "Hyprland reported no monitors".to_string())?;

    let name = monitor.name.clone();
    let tracker = CursorTracker::start(monitor, 120);
    tokio::time::sleep(Duration::from_millis(ms.clamp(100, 10_000))).await;
    let samples = tracker.stop();

    let moved = samples
        .first()
        .zip(samples.last())
        .map(|(a, b)| ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt())
        .unwrap_or(0.0);

    Ok(serde_json::json!({
        "monitor": name,
        "samples": samples.len(),
        "movedPx": moved.round(),
        "first": samples.first(),
        "last": samples.last(),
    }))
}
