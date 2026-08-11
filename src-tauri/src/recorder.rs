//! Screen capture on Wayland.
//!
//! Wayland deliberately hides the global cursor position from applications, so
//! there is no polling API to fall back on. The only supported route to real
//! cursor coordinates is the xdg-desktop-portal ScreenCast interface asked to
//! deliver the cursor as *metadata* rather than painted into the frames. That
//! choice is what makes follow-cursor zoom possible, and it's also why we have
//! to consume the PipeWire stream ourselves instead of handing the node to
//! ffmpeg and walking away.
//!
//! Note on clicks: the portal reports where the cursor is, never what its
//! buttons are doing. Click-triggered effects need a different source and are
//! not available from this path.

use serde::{Deserialize, Serialize};
use std::os::fd::{IntoRawFd, OwnedFd};

/// One cursor position, timestamped from the start of the recording.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct CursorSample {
    /// Seconds since recording start.
    pub t: f64,
    /// Position in captured-frame pixels.
    pub x: f32,
    pub y: f32,
}

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

    // Metadata is the whole point: it keeps the cursor out of the pixels and
    // delivers its position alongside each frame. Compositors that don't
    // support it will reject this call rather than silently downgrade.
    proxy
        .select_sources(
            &session,
            CursorMode::Metadata,
            SourceType::Monitor | SourceType::Window,
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
/// verified independently of the PipeWire and encoding work.
#[tauri::command]
pub async fn capture_probe() -> Result<String, String> {
    let source = negotiate().await?;
    let raw = source.fd.into_raw_fd();
    let msg = format!("node {} on pipewire fd {}", source.node_id, raw);
    // Dropping the session tells the portal we're done and revokes access.
    drop(source.session);
    // SAFETY: `raw` came from an OwnedFd we consumed above and has not been
    // closed by anything else, so this is the sole owner closing it once.
    unsafe { libc_close(raw) };
    Ok(msg)
}

unsafe fn libc_close(fd: i32) {
    unsafe extern "C" {
        fn close(fd: i32) -> i32;
    }
    unsafe { close(fd) };
}
