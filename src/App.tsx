import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import Topbar from "./ui/Topbar";
import Library from "./ui/Library";
import Stage from "./ui/Stage";
import Inspector from "./ui/Inspector";
import Timeline from "./ui/Timeline";
import { useStore } from "./doc/store";
import {
  ensureSaved,
  openProjectFile,
  projectName,
  saveProject,
  saveProjectAs,
} from "./media/projectFile";

export default function App() {
  const dirty = useStore((s) => s.dirty);
  const name = projectName(useStore((s) => s.projectPath));

  // Keyboard shortcuts live at the app root so they work regardless of which
  // panel has focus — except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;

      const st = useStore.getState();

      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        st.redo();
        return;
      }

      // Before the bare-key handlers below, which claim "s" for Split — without
      // this, Ctrl+S would cut the clip in half instead of saving it.
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void (e.shiftKey ? saveProjectAs() : saveProject()).catch(() => {});
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        void (async () => {
          if (await ensureSaved()) await openProjectFile();
        })().catch(() => {});
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (st.doc.clip) st.setPlaying(!st.playing);
      } else if (e.key === "ArrowLeft") {
        st.setPlaying(false);
        st.setPlayhead(st.playhead - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === "ArrowRight") {
        st.setPlaying(false);
        st.setPlayhead(st.playhead + (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === "s" || e.key === "S") {
        if (st.doc.clip) {
          st.setPlaying(false);
          st.splitAt(st.playhead);
        }
      } else if (e.key === "i" || e.key === "I") {
        if (st.doc.clip) {
          st.setPlaying(false);
          st.setInPoint();
        }
      } else if (e.key === "o" || e.key === "O") {
        if (st.doc.clip) {
          st.setPlaying(false);
          st.setOutPoint();
        }
      } else if (e.key === "x" || e.key === "X") {
        if (st.doc.clip) {
          st.setPlaying(false);
          st.cutRange();
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (st.selectedId) st.removeBlock(st.selectedId);
        else if (st.selectedSegmentId) st.removeSegment(st.selectedSegmentId);
      } else if (e.key === "Escape") {
        st.select(null);
        st.selectSegment(null);
        st.clearMarkers();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Closing the window is the one way to lose work that no undo can recover,
  // so it asks. Tauri's close request is cancellable, which the browser's
  // beforeunload is not — there we can only fall back to the generic prompt.
  useEffect(() => {
    if (!isTauri()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (useStore.getState().dirty) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const stop = await win.onCloseRequested(async (e) => {
        if (!useStore.getState().dirty) return;
        e.preventDefault();
        if (await ensureSaved()) await win.destroy();
      });
      if (disposed) stop();
      else unlisten = stop;
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // The title is where a desktop app says which file you're in and whether it
  // is safe to close.
  useEffect(() => {
    const title = name ? `${dirty ? "• " : ""}${name} — Motion` : "Motion";
    document.title = title;
    if (isTauri()) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      );
    }
  }, [name, dirty]);

  return (
    <div className="app">
      <Topbar />
      <div className="body">
        <Library />
        <Stage />
        <Inspector />
      </div>
      <Timeline />
    </div>
  );
}
