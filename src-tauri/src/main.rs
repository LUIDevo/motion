#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// WebKitGTK's DMABUF renderer crashes the Wayland connection on a lot of
/// Linux setups ("Error 71 (Protocol error) dispatching to Wayland display"),
/// taking the window with it before it ever paints. Disabling it costs a
/// little compositing performance and is the standard workaround. Set before
/// GTK initialises, and only when the user hasn't already chosen a value.
#[cfg(target_os = "linux")]
fn appease_webkit() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    appease_webkit();

    motion_lib::run()
}
