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

use serde::{Deserialize, Serialize};
use std::os::fd::{IntoRawFd, OwnedFd};

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
