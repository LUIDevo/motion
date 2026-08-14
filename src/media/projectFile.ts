import { invoke, isTauri } from "@tauri-apps/api/core";
import { serializeDoc } from "../doc/project";
import { useStore } from "../doc/store";
import { openProject, type OpenProjectHooks } from "./project";

/**
 * The file-dialog layer for projects.
 *
 * Everything below the dialogs is already split: `doc/project.ts` turns a
 * document into text and back, `media/project.ts` relinks the source, and the
 * Rust side owns the bytes. This module exists only to join them to the native
 * pickers and to the store's notion of "which file am I".
 */

const EXT = "motion";

/** Extension is appended rather than assumed: the save dialog returns whatever
 *  the user typed, and the Rust side refuses anything that isn't a project. */
function withExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${EXT}`) ? path : `${path}.${EXT}`;
}

/** Basename without the extension — what a window title wants. */
export function projectName(path: string | null): string | null {
  if (!path) return null;
  const base = path.split("/").pop() ?? path;
  return base.replace(new RegExp(`\\.${EXT}$`, "i"), "");
}

async function pickSavePath(suggested: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const p = await save({
    defaultPath: suggested,
    filters: [{ name: "Motion project", extensions: [EXT] }],
  });
  return p ? withExtension(p) : null;
}

async function pickOpenPath(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Motion project", extensions: [EXT] }],
  });
  return typeof p === "string" ? p : null;
}

/** What a never-saved document should be called, taken from the clip so a
 *  project lands next to the recording it was made from. */
function suggestedName(): string {
  const clip = useStore.getState().doc.clip;
  if (!clip) return `untitled.${EXT}`;
  return `${clip.name.replace(/\.[^.]+$/, "")}.${EXT}`;
}

async function writeTo(path: string): Promise<void> {
  const text = serializeDoc(useStore.getState().doc);
  await invoke("project_save", { path, text });
  useStore.getState().markSaved(path);
}

/**
 * Save to the current file, asking for one the first time.
 *
 * Returns whether the document ended up on disk, so callers that only proceed
 * when the work is safe — closing the window, opening another project — can
 * tell a completed save from a cancelled dialog.
 */
export async function saveProject(): Promise<boolean> {
  if (!isTauri()) throw new Error("Saving needs the desktop app.");

  const existing = useStore.getState().projectPath;
  if (existing) {
    await writeTo(existing);
    return true;
  }
  return saveProjectAs();
}

export async function saveProjectAs(): Promise<boolean> {
  if (!isTauri()) throw new Error("Saving needs the desktop app.");

  const path = await pickSavePath(useStore.getState().projectPath ?? suggestedName());
  if (!path) return false;
  await writeTo(path);
  return true;
}

/**
 * Gate an action that would discard the current document.
 *
 * Returns whether to proceed. The dialog offers save-or-not rather than a
 * three-way, and cancellation is expressed through the save itself: backing
 * out of the file picker aborts the whole operation, which is what someone
 * hitting Escape there means.
 */
export async function ensureSaved(): Promise<boolean> {
  if (!useStore.getState().dirty) return true;
  if (!isTauri()) return true;

  const { ask } = await import("@tauri-apps/plugin-dialog");
  const wantsSave = await ask("Save your changes first?", {
    title: "Unsaved changes",
    kind: "warning",
  });
  if (!wantsSave) return true;
  return saveProject();
}

/**
 * Open a project, replacing the current document.
 *
 * The read and the parse happen before anything is replaced, so a corrupt or
 * unreadable file leaves the editor exactly as it was rather than half-loading
 * over the top of work in progress.
 */
export async function openProjectFile(hooks: OpenProjectHooks = {}): Promise<boolean> {
  if (!isTauri()) throw new Error("Opening needs the desktop app.");

  const path = await pickOpenPath();
  if (!path) return false;

  const text = await invoke<string>("project_open", { path });
  await openProject(text, path, hooks);
  return true;
}
