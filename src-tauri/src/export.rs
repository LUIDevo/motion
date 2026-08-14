//! Export: raw frames streamed straight into ffmpeg.
//!
//! The previous design staged every frame as a numbered JPEG in a temp
//! directory and ran ffmpeg over the sequence at the end. That cost a JPEG
//! encode and a base64 round-trip through the IPC bridge per frame, wrote
//! hundreds of megabytes of intermediates, and — because JPEG is lossy — threw
//! away quality *before* h264 ever saw the picture.
//!
//! Now ffmpeg is started once and the canvas is written to its stdin as raw
//! RGBA. Frames arrive over Tauri's raw IPC body rather than as JSON, so the
//! bytes are never text. Nothing touches the disk except the finished file, and
//! the only lossy step is the final encode.

use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request};
use tauri::State;

/// An export in progress. Holding stdin separately from the child is what lets
/// `finish` close the pipe — ffmpeg treats EOF as "no more frames" and only
/// then writes the trailer.
struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    /// Bytes each frame must be, so a mismatched buffer is caught here rather
    /// than silently shearing the video into diagonal garbage.
    frame_bytes: usize,
    written: u64,
}

#[derive(Default)]
pub struct ExportState(Mutex<Option<Session>>);

/// Start ffmpeg and hold it open for frames.
///
/// `width`/`height` are the canvas dimensions the frames will arrive at. They
/// are rounded up to even numbers by the scale filter because yuv420p cannot
/// represent odd dimensions, and odd-sized captures are common enough that
/// rounding beats refusing.
#[tauri::command]
pub fn export_begin(
    state: State<'_, ExportState>,
    width: u32,
    height: u32,
    fps: u32,
    crf: u32,
    out: String,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("an export is already running".into());
    }

    if width == 0 || height == 0 {
        return Err("export dimensions must be non-zero".into());
    }

    let mut child = Command::new("ffmpeg")
        .arg("-y")
        // Describing the input exactly is mandatory for rawvideo: the stream
        // carries no header, so ffmpeg cannot infer any of this.
        .args(["-f", "rawvideo"])
        .args(["-pix_fmt", "rgba"])
        .args(["-s", &format!("{width}x{height}")])
        .args(["-r", &fps.to_string()])
        .args(["-i", "-"])
        .args(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"])
        .args(["-c:v", "libx264"])
        .args(["-preset", "medium"])
        .args(["-crf", &crf.to_string()])
        .args(["-pix_fmt", "yuv420p"])
        // Widely compatible playback: move the index to the front so the file
        // streams instead of needing a full download to start.
        .args(["-movflags", "+faststart"])
        .arg(&out)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not run ffmpeg: {e}. Is it installed and on PATH?"))?;

    let stdin = child.stdin.take().ok_or("ffmpeg gave us no stdin")?;
    *slot = Some(Session {
        child,
        stdin: Some(stdin),
        frame_bytes: width as usize * height as usize * 4,
        written: 0,
    });
    Ok(())
}

/// Write one frame. The body is raw RGBA, straight off the canvas.
#[tauri::command]
pub fn export_frame(state: State<'_, ExportState>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("export_frame expects a raw body".into());
    };

    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let session = slot.as_mut().ok_or("no export is running")?;

    if bytes.len() != session.frame_bytes {
        return Err(format!(
            "frame is {} bytes, expected {}",
            bytes.len(),
            session.frame_bytes
        ));
    }

    let stdin = session.stdin.as_mut().ok_or("export is already finishing")?;

    // A broken pipe means ffmpeg died — usually a bad argument or a full disk.
    // Reported here rather than swallowed, or the export would appear to work
    // and produce a truncated file.
    stdin.write_all(bytes).map_err(|e| {
        format!("ffmpeg stopped accepting frames: {e}")
    })?;
    session.written += 1;
    Ok(())
}

/// Close the pipe and wait for ffmpeg to write the trailer.
#[tauri::command]
pub fn export_finish(state: State<'_, ExportState>) -> Result<u64, String> {
    let mut session = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("no export is running")?;

    if session.written == 0 {
        let _ = session.child.kill();
        let _ = session.child.wait();
        return Err("no frames were rendered".into());
    }

    // Dropping stdin is the EOF. Without it ffmpeg waits for more frames and
    // the file never gets its index.
    drop(session.stdin.take());

    let status = session.child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("ffmpeg exited with {status}"));
    }
    Ok(session.written)
}

/// Abandon an export. Safe to call when nothing is running, so the frontend can
/// use it as an unconditional cleanup.
#[tauri::command]
pub fn export_cancel(state: State<'_, ExportState>) -> Result<(), String> {
    let Some(mut session) = state.0.lock().map_err(|e| e.to_string())?.take() else {
        return Ok(());
    };
    drop(session.stdin.take());
    let _ = session.child.kill();
    let _ = session.child.wait();
    Ok(())
}

/// Reports whether ffmpeg is reachable so the UI can say so before the user
/// sits through an export.
#[tauri::command]
pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
