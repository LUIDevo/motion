mod export;
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
        .invoke_handler(tauri::generate_handler![
            export::export_begin,
            export::export_frame,
            export::export_finish,
            export::export_cleanup,
            export::ffmpeg_available,
            proxy::make_proxy,
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
