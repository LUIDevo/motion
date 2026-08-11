mod export;
mod proxy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            export::export_begin,
            export::export_frame,
            export::export_finish,
            export::export_cleanup,
            export::ffmpeg_available,
            proxy::make_proxy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running motion");
}
