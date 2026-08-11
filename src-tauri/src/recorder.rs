//! Screen capture on Wayland.
//!
//! Wayland hides the global cursor position from applications, and the portal
//! only offers it in `CursorMode::Metadata` — which
//! xdg-desktop-portal-hyprland does not implement (it advertises
//! `Hidden | Embedded`). So this module does one job: get the compositor to
//! hand over a PipeWire node to capture. Cursor coordinates come from
//! Hyprland's IPC socket instead, in the `cursor` module.
//!
//! Because the cursor no longer has to be pulled out of the stream's metadata,
//! the frames themselves never need to be inspected here — GStreamer consumes
//! the node directly.
//!
//! Note on clicks: neither source reports mouse buttons. Click-triggered
//! effects need something else again and are not available from this path.

use crate::cursor::{CursorTracker, Monitor};
use serde::{Deserialize, Serialize};
use std::os::fd::{AsRawFd, IntoRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

/// What a finished recording produces: the video plus the cursor track that
/// makes it more than a screen capture.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub video_path: String,
    pub cursor_path: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    /// The cursor track itself, not just a path to it. Handing the samples
    /// back inline saves the UI a second trip through the asset protocol —
    /// one that could stall with no way to time it out.
    pub cursor: Vec<crate::cursor::CursorSample>,
}

/// A negotiated capture source, before any frames have been pulled.
pub struct CaptureSource {
    pub node_id: u32,
    /// PipeWire remote to connect on. Kept as an owned fd so it stays valid
    /// for as long as the session does.
    pub fd: OwnedFd,
    pub session: ashpd::desktop::Session<'static, ashpd::desktop::screencast::Screencast<'static>>,
}

/// Ask the compositor for a capture source.
///
/// This shows the desktop's own picker — the user chooses the screen or window
/// and grants access. We never see anything they didn't select.
pub async fn negotiate() -> Result<CaptureSource, String> {
    use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
    use ashpd::desktop::PersistMode;

    let proxy = Screencast::new().await.map_err(|e| format!("portal unavailable: {e}"))?;
    let session = proxy
        .create_session()
        .await
        .map_err(|e| format!("could not open a capture session: {e}"))?;

    // `Metadata` would deliver cursor position alongside the frames, but
    // xdg-desktop-portal-hyprland advertises only `Hidden | Embedded` and
    // rejects the request outright rather than downgrading. So the cursor is
    // painted into the capture here, and its coordinates come separately from
    // Hyprland's IPC socket — see the `cursor` module.
    proxy
        .select_sources(
            &session,
            CursorMode::Embedded,
            SourceType::Monitor.into(),
            false,
            None,
            PersistMode::DoNot,
        )
        .await
        .map_err(|e| format!("could not select a capture source: {e}"))?;

    let response = proxy
        .start(&session, None)
        .await
        .map_err(|e| format!("capture was not started: {e}"))?
        .response()
        .map_err(|e| format!("capture was cancelled or refused: {e}"))?;

    let stream = response
        .streams()
        .first()
        .ok_or_else(|| "the portal returned no streams".to_string())?;
    let node_id = stream.pipe_wire_node_id();

    let fd = proxy
        .open_pipe_wire_remote(&session)
        .await
        .map_err(|e| format!("could not open the PipeWire remote: {e}"))?;

    Ok(CaptureSource { node_id, fd, session })
}

/// Probe the capture path end to end without recording anything.
///
/// Exists so the portal, the cursor mode and the compositor's picker can be
/// verified independently of the encoding work.
#[tauri::command]
pub async fn capture_probe() -> Result<String, String> {
    let source = negotiate().await?;
    let raw = source.fd.into_raw_fd();
    let msg = format!("node {} on pipewire fd {}", source.node_id, raw);
    // Dropping the session tells the portal we're done and revokes access.
    drop(source.session);
    // SAFETY: `raw` came from an OwnedFd we consumed above and has not been
    // closed by anything else, so this is the sole owner closing it once.
    unsafe { libc::close(raw) };
    Ok(msg)
}

/// A recording in flight. Held in Tauri state between start and stop.
pub struct Active {
    child: Child,
    tracker: CursorTracker,
    video_path: PathBuf,
    monitor: Monitor,
    started: Instant,
    /// Drained on a thread. A piped stream with no reader fills its buffer and
    /// then blocks the writer — which stalls the whole capture pipeline — so
    /// this is not optional bookkeeping.
    log: Arc<Mutex<Vec<String>>>,
    /// Kept alive for the duration: dropping it revokes the portal grant and
    /// the PipeWire node disappears mid-recording.
    _session: ashpd::desktop::Session<'static, ashpd::desktop::screencast::Screencast<'static>>,
}

#[derive(Default)]
pub struct RecorderState(pub Mutex<Option<Active>>);

#[derive(Clone, Copy, PartialEq)]
pub enum Encoder {
    /// NVENC. A desktop-sized capture is far more than a software encoder can
    /// keep up with in realtime, and falling behind doesn't degrade quality —
    /// it stalls the capture outright.
    Nvenc,
    /// Software fallback. Fine at modest resolutions; will struggle above 1080p.
    Vp8,
}

impl Encoder {
    fn container_ext(self) -> &'static str {
        match self {
            Encoder::Nvenc => "mp4",
            Encoder::Vp8 => "webm",
        }
    }
}

fn element_exists(name: &str) -> bool {
    Command::new("gst-inspect-1.0")
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn pick_encoder() -> Encoder {
    if element_exists("nvh264enc") {
        Encoder::Nvenc
    } else {
        Encoder::Vp8
    }
}

/// Build the capture pipeline.
///
/// The queue directly after the source is the important part, and its absence
/// is what stalled earlier captures: without somewhere to buffer, a slow
/// encoder applies backpressure straight to `pipewiresrc`, which stops pulling
/// from the compositor and never recovers. `leaky=downstream` makes a
/// struggling encoder drop frames instead — a dropped frame costs a moment of
/// smoothness, a stall costs the entire recording.
fn build_pipeline(fd: i32, node: u32, out: &Path, fps: u32, enc: Encoder) -> Vec<String> {
    let mut a: Vec<String> = vec![
        // -e makes gst-launch send EOS on SIGINT, which is what finalises the
        // container index. Killing it any other way leaves an unplayable file.
        "-e".into(),
        "pipewiresrc".into(),
        format!("fd={fd}"),
        format!("path={node}"),
        "!".into(),
        "queue".into(),
        "leaky=downstream".into(),
        "max-size-buffers=16".into(),
        "max-size-bytes=0".into(),
        "max-size-time=0".into(),
        "!".into(),
        "videoconvert".into(),
        "!".into(),
        "videorate".into(),
        "drop-only=true".into(),
        "!".into(),
        format!("video/x-raw,framerate={fps}/1"),
        "!".into(),
    ];

    match enc {
        Encoder::Nvenc => a.extend([
            "nvh264enc".into(),
            "preset=low-latency-hq".into(),
            "bitrate=24000".into(),
            "!".into(),
            "h264parse".into(),
            "!".into(),
            "mp4mux".into(),
            "faststart=true".into(),
        ]),
        Encoder::Vp8 => a.extend([
            "vp8enc".into(),
            "deadline=1".into(),
            "cpu-used=12".into(),
            "threads=8".into(),
            "target-bitrate=12000000".into(),
            "!".into(),
            "webmmux".into(),
        ]),
    }

    a.extend([
        "!".into(),
        "filesink".into(),
        format!("location={}", out.display()),
    ]);
    a
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, RecorderState>,
) -> Result<String, String> {
    if state.0.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("already recording".into());
    }

    let monitor = crate::cursor::monitors()?
        .into_iter()
        .next()
        .ok_or_else(|| "Hyprland reported no monitors".to_string())?;

    let source = negotiate().await?;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let encoder = pick_encoder();
    let video_path = dir.join(format!("recording-{stamp}.{}", encoder.container_ext()));

    // gst-launch is a separate process, so the PipeWire fd has to survive
    // exec. ashpd hands us a CLOEXEC fd; dup() produces a copy without that
    // flag, which the child then inherits.
    let owned = source.fd;
    let dup_fd = unsafe { libc::dup(owned.as_raw_fd()) };
    if dup_fd < 0 {
        return Err("could not duplicate the PipeWire fd".into());
    }

    let args = build_pipeline(dup_fd, source.node_id, &video_path, 30, encoder);
    let mut child = Command::new("gst-launch-1.0")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run gst-launch-1.0: {e}"))?;

    // Drain stderr continuously. Keeping only the tail bounds memory while
    // still leaving enough context to explain a failed capture.
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(err) = child.stderr.take() {
        let sink = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Ok(mut v) = sink.lock() {
                    if v.len() >= 200 {
                        v.remove(0);
                    }
                    v.push(line);
                }
            }
        });
    }

    // Our copy has been inherited by the child; close ours so the fd isn't
    // leaked for the life of the app.
    unsafe { libc::close(dup_fd) };
    drop(owned);

    let tracker = CursorTracker::start(monitor.clone(), 120);

    *state.0.lock().map_err(|e| e.to_string())? = Some(Active {
        child,
        tracker,
        video_path: video_path.clone(),
        monitor,
        started: Instant::now(),
        log,
        _session: source.session,
    });

    Ok(video_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, RecorderState>) -> Result<Recording, String> {
    let active = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "not recording".into())
        .map_err(|e: String| e)?;

    let Active {
        mut child,
        tracker,
        video_path,
        monitor,
        started,
        log,
        _session,
    } = active;

    let elapsed = started.elapsed().as_secs_f64();

    // SIGINT rather than kill: with `-e` this makes gst-launch flush EOS
    // through the muxer so the WebM gets a usable index.
    unsafe { libc::kill(child.id() as i32, libc::SIGINT) };
    let _ = child.wait().map_err(|e| e.to_string())?;

    let samples = tracker.stop();

    let (width, height) = probe_dimensions(&video_path).unwrap_or((
        (monitor.width as f32 * monitor.scale) as u32,
        (monitor.height as f32 * monitor.scale) as u32,
    ));

    // The portal may hand over a different resolution than the monitor's own
    // (scaling, or a compositor that caps capture size). Cursor samples were
    // computed in monitor pixels, so rescale them onto the frame we actually
    // got — otherwise the zoom target drifts off by the ratio.
    let mon_w = monitor.width as f32 * monitor.scale;
    let mon_h = monitor.height as f32 * monitor.scale;
    let sx = if mon_w > 0.0 { width as f32 / mon_w } else { 1.0 };
    let sy = if mon_h > 0.0 { height as f32 / mon_h } else { 1.0 };

    let scaled: Vec<_> = samples
        .into_iter()
        .map(|s| crate::cursor::CursorSample {
            t: s.t,
            x: s.x * sx,
            y: s.y * sy,
        })
        .collect();

    let cursor_path = video_path.with_extension("cursor.json");
    std::fs::write(
        &cursor_path,
        serde_json::to_vec(&scaled).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // A capture that stalls still leaves a valid but nearly empty file, which
    // would otherwise load as a working clip and look like an editor bug.
    // Compare against how long we were actually recording and refuse it.
    let captured = probe_duration(&video_path).unwrap_or(0.0);
    if elapsed > 2.0 && captured < elapsed * 0.5 {
        let tail = log
            .lock()
            .map(|v| v.iter().rev().take(12).cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        return Err(format!(
            "capture stalled: recorded {elapsed:.1}s but only {captured:.1}s of video was \
             written to {}.\n\ngst-launch said:\n{tail}",
            video_path.display()
        ));
    }

    Ok(Recording {
        video_path: video_path.to_string_lossy().to_string(),
        cursor_path: cursor_path.to_string_lossy().to_string(),
        width,
        height,
        // The file's own duration is the honest one; wall-clock includes the
        // time before the first frame ever arrived.
        duration: if captured > 0.0 { captured } else { elapsed },
        cursor: scaled,
    })
}

fn probe_duration(path: &Path) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

fn probe_dimensions(path: &Path) -> Option<(u32, u32)> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
        ])
        .arg(path)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (w, h) = text.trim().split_once(',')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}
