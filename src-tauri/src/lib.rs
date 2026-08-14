use tauri::Manager;

mod export;
mod media_server;
mod project;
mod proxy;
#[cfg(target_os = "linux")]
mod cursor;
#[cfg(target_os = "linux")]
mod recorder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(recorder::RecorderState::default())
        .manage(export::ExportState::default())
        .setup(|app| {
            // The webview loads media over loopback HTTP, so the server has to
            // exist before any clip can be opened.
            let server = tauri::async_runtime::block_on(media_server::start())
                .map_err(|e| std::io::Error::other(e))?;
            app.manage(server);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            export::export_begin,
            export::export_frame,
            export::export_finish,
            export::export_cancel,
            export::ffmpeg_available,
            proxy::make_proxy,
            media_server::media_url,
            project::project_open,
            project::project_save,
            #[cfg(target_os = "linux")]
            recorder::capture_probe,
            #[cfg(target_os = "linux")]
            cursor::cursor_probe,
            #[cfg(target_os = "linux")]
            recorder::start_recording,
            #[cfg(target_os = "linux")]
            recorder::stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running motion");
}
