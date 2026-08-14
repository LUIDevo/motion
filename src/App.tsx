import { useEffect } from "react";
import Topbar from "./ui/Topbar";
import Library from "./ui/Library";
import Stage from "./ui/Stage";
import Inspector from "./ui/Inspector";
import Timeline from "./ui/Timeline";
import { useStore } from "./doc/store";

export default function App() {
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
