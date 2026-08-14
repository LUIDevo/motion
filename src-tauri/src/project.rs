use std::fs;
use std::path::Path;

/// Project files are a `.motion` JSON envelope around the document. The
/// webview owns the actual (de)serialisation (`serializeDoc`/`parseProject`);
/// these two commands are just thin file I/O so the UI never touches the
/// filesystem itself.
///
/// No sandbox is needed: paths come from the native file dialog, not from
/// anything a file could influence. The one guard that does stay is the
/// extension — a dialog filter is a suggestion, not a guarantee, and a
/// malformed path should be refused rather than silently written somewhere
/// unexpected.
fn project_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if !p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("motion"))
    {
        return Err(format!("not a motion project: {path} (expected a .motion file)"));
    }
    Ok(p)
}

/// Read a project file back as text.
#[tauri::command]
pub fn project_open(path: String) -> Result<String, String> {
    let p = project_path(&path)?;
    fs::read_to_string(p).map_err(|e| format!("could not read {path}: {e}"))
}

/// Write project text to disk, creating any parent directories that don't
/// exist yet (the save dialog can hand back a fresh folder).
#[tauri::command]
pub fn project_save(path: String, text: String) -> Result<(), String> {
    let p = project_path(&path)?;
    if let Some(dir) = p.parent() {
        if !dir.as_os_str().is_empty() {
            fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
        }
    }
    fs::write(p, text).map_err(|e| format!("could not write {path}: {e}"))
}
