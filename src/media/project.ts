import { parseProject } from "../doc/project";
import { useStore } from "../doc/store";
import { clipFromPath, importRecording, type ImportHooks } from "./import";

export interface OpenProjectHooks extends ImportHooks {
  /** Fired when the persisted source can't be linked — missing from disk, or
   *  unplayable even after the proxy fallback — right before the user is
   *  offered the picker to locate it. Lets the UI explain what's happening. */
  onMissingSource?: (path: string) => void;
}

/**
 * Open a project file into the editor.
 *
 * `text` is the raw file contents; the file-dialog layer owns reading it. The
 * parsed document plus the persisted source path come back from parseProject,
 * and the source is then relinked:
 *
 *  - still on disk → a live playback handle (with the proxy fallback when the
 *    webview can't decode it). Everything the project persisted about the clip
 *    — the cursor track included — is kept; only the runtime `src` changes.
 *  - gone (or unplayable) → the user is offered the import picker to locate
 *    it. Locating the same file just relinks; a different file replaces the
 *    clip, because the old source's contents — and with them the meaning of
 *    the persisted cursor samples — are gone. Declining still opens the
 *    project, with the clip unlinked rather than refusing to open at all.
 *
 * The document lands via `openDoc`, so the load starts a fresh undo stack.
 * Parsing errors propagate to the caller, which should keep the current
 * document untouched.
 */
export async function openProject(
  text: string,
  path: string | null = null,
  hooks: OpenProjectHooks = {},
): Promise<void> {
  const { doc, sourcePath } = parseProject(text);
  const state = useStore.getState();

  let clip = doc.clip;
  if (clip && sourcePath) {
    try {
      const handle = await clipFromPath(sourcePath, hooks);
      clip = { ...clip, src: handle.src, proxied: handle.proxied };
    } catch {
      hooks.onMissingSource?.(sourcePath);
      const located = await importRecording(hooks);
      if (located) {
        clip =
          located.path === sourcePath
            ? { ...clip, src: located.src, proxied: located.proxied }
            : located;
      }
    }
  }

  state.openDoc(clip ? { ...doc, clip } : doc, path);
}
