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
      if (e.code === "Space") {
        e.preventDefault();
        if (st.doc.clip) st.setPlaying(!st.playing);
      } else if (e.key === "ArrowLeft") {
        st.setPlaying(false);
        st.setPlayhead(st.playhead - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === "ArrowRight") {
        st.setPlaying(false);
        st.setPlayhead(st.playhead + (e.shiftKey ? 1 : 1 / 30));
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
        st.removeBlock(st.selectedId);
      } else if (e.key === "Escape") {
        st.select(null);
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
