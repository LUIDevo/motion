import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useStore } from "../doc/store";
import { importRecording } from "../media/import";
import { exportVideo, pickExportPath } from "../media/export";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string; pct: number }
  | { kind: "done"; label: string }
  | { kind: "error"; label: string };

export default function Topbar() {
  const clip = useStore((s) => s.doc.clip);
  const loadClip = useStore((s) => s.loadClip);
  const setPlaying = useStore((s) => s.setPlaying);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.hist.past.length > 0);
  const canRedo = useStore((s) => s.hist.future.length > 0);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onImport = async () => {
    try {
      const c = await importRecording({
        onProxy: (p) =>
          setStatus({
            kind: "busy",
            label: "Converting for playback",
            pct: Math.round(p.fraction * 100),
          }),
      });
      if (c) {
        loadClip(c);
        setStatus({ kind: "idle" });
      } else {
        setStatus({ kind: "idle" });
      }
    } catch (err) {
      setStatus({ kind: "error", label: err instanceof Error ? err.message : String(err) });
    }
  };

  const onExport = async () => {
    const doc = useStore.getState().doc;
    if (!doc.clip) return;

    if (!isTauri()) {
      setStatus({ kind: "error", label: "Export needs the desktop app." });
      return;
    }

    const suggested = doc.clip.name.replace(/\.[^.]+$/, "") + "-motion.mp4";
    const out = await pickExportPath(suggested);
    if (!out) return;

    setPlaying(false);
    setStatus({ kind: "busy", label: "Rendering", pct: 0 });
    try {
      await exportVideo(doc, out, {
        fps: 30,
        quality: 18,
        onProgress: (done, total) =>
          setStatus({
            kind: "busy",
            label: "Rendering",
            pct: Math.round((done / total) * 100),
          }),
      });
      setStatus({ kind: "done", label: `Saved ${out.split("/").pop()}` });
    } catch (err) {
      setStatus({ kind: "error", label: String(err) });
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" />
        <span className="brand-name">Motion</span>
      </div>

      <div className="topbar-center">
        {clip ? (
          <span className="doc-title">{clip.name}</span>
        ) : (
          <span className="doc-title dim">Untitled</span>
        )}
      </div>

      <div className="topbar-right">
        {status.kind === "busy" && (
          <span className="status busy">
            {status.label} {status.pct}%
          </span>
        )}
        {status.kind === "done" && <span className="status done">{status.label}</span>}
        {status.kind === "error" && <span className="status error">{status.label}</span>}

        <button
          className="icon-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          className="icon-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷
        </button>

        <button className="ghost" onClick={onImport}>
          Import
        </button>
        <button
          className="primary-btn"
          onClick={onExport}
          disabled={!clip || status.kind === "busy"}
        >
          Export
        </button>
      </div>
    </header>
  );
}
