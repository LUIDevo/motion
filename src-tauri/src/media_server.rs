//! A loopback HTTP server for handing media to the webview.
//!
//! The obvious route — Tauri's `asset://` protocol — does not work for video on
//! WebKitGTK: media is decoded in a separate process that cannot reach the
//! webview's custom-scheme handler, so the element reports NO_SOURCE without
//! ever receiving a byte. Plain HTTP over loopback is understood by every part
//! of the stack.
//!
//! It also buys correct Range handling, which matters more than it sounds:
//! scrubbing and frame-stepping an export seek constantly, and without ranges
//! each seek would re-read the file from the start.
//!
//! Only files handed out through [`register`] are reachable, each behind an
//! unguessable token. There is no path-based route, so the server cannot be
//! walked to reach anything the user hasn't opened.

use axum::extract::{Path as AxumPath, State};
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeFile;

#[derive(Clone, Default)]
pub struct MediaRegistry {
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
}

pub struct MediaServer {
    pub port: u16,
    pub registry: MediaRegistry,
}

impl MediaRegistry {
    /// Publish a file and return the token it's reachable under.
    pub fn register(&self, path: PathBuf) -> String {
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());

        // Re-publishing the same file reuses its token, so reopening a clip
        // doesn't grow the table without bound.
        if let Some((token, _)) = files.iter().find(|(_, p)| **p == path) {
            return token.clone();
        }

        let token = uuid::Uuid::new_v4().to_string();
        files.insert(token.clone(), path);
        token
    }

    fn resolve(&self, token: &str) -> Option<PathBuf> {
        self.files
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(token)
            .cloned()
    }
}

async fn serve(
    State(registry): State<MediaRegistry>,
    AxumPath(token): AxumPath<String>,
    req: Request<axum::body::Body>,
) -> impl IntoResponse {
    let Some(path) = registry.resolve(&token) else {
        return (StatusCode::NOT_FOUND, "unknown media token").into_response();
    };

    // ServeFile implements conditional and range requests properly, which is
    // the entire reason for going through HTTP rather than reading the file
    // ourselves.
    match ServeFile::new(path).oneshot(req).await {
        Ok(res) => res.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// Bind to an ephemeral loopback port and start serving.
///
/// Binding to 127.0.0.1 keeps this off the network entirely; port 0 lets the
/// OS pick a free port so two running copies can't collide.
pub async fn start() -> Result<MediaServer, String> {
    let registry = MediaRegistry::default();

    let app = Router::new()
        .route("/f/{token}", get(serve))
        // Frames are drawn into a canvas that later gets read back for export.
        // A cross-origin video would taint the canvas and make that read throw,
        // so the media has to be served CORS-enabled and requested
        // with crossOrigin set.
        .layer(CorsLayer::permissive())
        .with_state(registry.clone());

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .map_err(|e| format!("could not bind the media server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    Ok(MediaServer { port, registry })
}

/// Turn a path on disk into a URL the webview can actually play.
#[tauri::command]
pub fn media_url(server: tauri::State<'_, MediaServer>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("no such file: {path}"));
    }
    let token = server.registry.register(p);
    Ok(format!("http://127.0.0.1:{}/f/{}", server.port, token))
}
