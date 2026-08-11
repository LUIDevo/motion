use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProgress {
    /// 0.0 to 1.0. Best effort — ffmpeg's reported time can jitter.
    pub fraction: f64,
    pub stage: String,
}

/// Identity of a source file for caching. Path alone isn't enough (files get
/// overwritten), and hashing the contents of a multi-gigabyte recording to
/// decide whether to transcode it would defeat the point.
fn cache_key(path: &PathBuf) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut h);
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                dur.as_secs().hash(&mut h);
            }
        }
    }
    format!("{:016x}", h.finish())
}

/// Source duration in seconds, so transcode progress can be a real percentage.
fn probe_duration(src: &PathBuf) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1",
        ])
        .arg(src)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Transcode into something WebKitGTK can actually decode.
///
/// WebKitGTK hands decoding to GStreamer, and H.264 support is a separate
/// package that often isn't installed. VP9 in WebM is decoded by
/// gst-plugins-good, which is effectively always present, so a proxy makes
/// import work without asking anyone to install system packages.
///
/// The proxy is cached: reimporting the same untouched file is instant.
#[tauri::command]
pub async fn make_proxy(
    app: AppHandle,
    src: String,
    on_progress: Channel<ProxyProgress>,
) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    if !src_path.is_file() {
        return Err(format!("no such file: {src}"));
    }

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("proxies");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let out = dir.join(format!("{}.webm", cache_key(&src_path)));
    if out.is_file() {
        let _ = on_progress.send(ProxyProgress {
            fraction: 1.0,
            stage: "cached".into(),
        });
        return Ok(out.to_string_lossy().to_string());
    }

    let total = probe_duration(&src_path);

    tauri::async_runtime::spawn_blocking(move || {
        let _ = on_progress.send(ProxyProgress {
            fraction: 0.0,
            stage: "starting".into(),
        });

        // Written to a temp name and renamed on success, so an interrupted run
        // can never leave a half-written file that the cache would later trust.
        let tmp = out.with_extension("part.webm");

        let mut child = Command::new("ffmpeg")
            .arg("-y")
            .arg("-i")
            .arg(&src_path)
            // Audio isn't used by the compositor yet, and dropping it keeps
            // the transcode meaningfully faster.
            .arg("-an")
            .args(["-c:v", "libvpx-vp9"])
            .args(["-crf", "24", "-b:v", "0"])
            .args(["-row-mt", "1"])
            .args(["-deadline", "good", "-cpu-used", "4"])
            // Frequent keyframes keep scrubbing and frame-accurate export seeks
            // from having to decode long runs of inter frames.
            .args(["-g", "48"])
            .args(["-pix_fmt", "yuv420p"])
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(&tmp)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not run ffmpeg: {e}. Is it installed and on PATH?"))?;

        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                // ffmpeg -progress emits `key=value` lines; out_time_ms is
                // microseconds despite the name.
                if let Some(v) = line.strip_prefix("out_time_ms=") {
                    if let (Ok(us), Some(total)) = (v.trim().parse::<f64>(), total) {
                        if total > 0.0 {
                            let f = (us / 1_000_000.0 / total).clamp(0.0, 0.999);
                            let _ = on_progress.send(ProxyProgress {
                                fraction: f,
                                stage: "converting".into(),
                            });
                        }
                    }
                }
            }
        }

        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("ffmpeg exited with {status}"));
        }

        std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
        let _ = on_progress.send(ProxyProgress {
            fraction: 1.0,
            stage: "done".into(),
        });
        Ok(out.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
