use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Frames are staged on disk rather than held in memory: a minute of 1080p at
/// 60fps is far more than we want resident, and ffmpeg reads a numbered
/// sequence happily.
fn session_root(dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(dir);
    let base = std::env::temp_dir().join("motion-export");
    // Every path handed back to us later is checked against the staging root
    // so a malformed or crafted `dir` can't point writes or deletes at
    // arbitrary parts of the filesystem.
    if !path.starts_with(&base) {
        return Err("invalid export session".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn export_begin() -> Result<String, String> {
    let dir = std::env::temp_dir()
        .join("motion-export")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_frame(dir: String, index: u32, data: String) -> Result<(), String> {
    let root = session_root(&dir)?;
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    let path = root.join(format!("{index:06}.jpg"));
    fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_finish(dir: String, fps: u32, crf: u32, out: String) -> Result<String, String> {
    let root = session_root(&dir)?;
    let pattern = root.join("%06d.jpg");

    let status = Command::new("ffmpeg")
        .arg("-y")
        .args(["-framerate", &fps.to_string()])
        .arg("-i")
        .arg(&pattern)
        // yuv420p needs even dimensions; odd-sized captures are common enough
        // that rounding here is cheaper than rejecting the export.
        .args(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"])
        .args(["-c:v", "libx264"])
        .args(["-preset", "medium"])
        .args(["-crf", &crf.to_string()])
        .args(["-pix_fmt", "yuv420p"])
        // Widely compatible playback: move the index to the front so the file
        // streams instead of needing a full download to start.
        .args(["-movflags", "+faststart"])
        .arg(&out)
        .status()
        .map_err(|e| format!("could not run ffmpeg: {e}. Is it installed and on PATH?"))?;

    if !status.success() {
        return Err(format!("ffmpeg exited with {status}"));
    }
    Ok(out)
}

#[tauri::command]
pub fn export_cleanup(dir: String) -> Result<(), String> {
    let root = session_root(&dir)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reports whether ffmpeg is reachable so the UI can say so before the user
/// sits through an export.
#[tauri::command]
pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
