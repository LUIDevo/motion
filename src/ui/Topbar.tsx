import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useStore } from "../doc/store";
import { importRecording } from "../media/import";
import { exportVideo, pickExportPath } from "../media/export";
import { startRecording, stopRecording } from "../media/record";
import {
  ensureSaved,
  openProjectFile,
  projectName,
  saveProject,
} from "../media/projectFile";
import { toggleTheme, useTheme } from "../theme";

const IconUndo = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M6 4.5H9.5a3.5 3.5 0 0 1 0 7H5" strokeLinecap="round" />
    <path d="M7.5 2.5 5 4.5l2.5 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconRedo = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M10 4.5H6.5a3.5 3.5 0 0 0 0 7H11" strokeLinecap="round" />
    <path d="M8.5 2.5 11 4.5l-2.5 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconCursor = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M4.2 2.6a.6.6 0 0 1 .95-.48l7.6 5.6c.44.32.24 1.02-.3 1.06l-3.4.26-1.8 3.18a.6.6 0 0 1-1.12-.2z" />
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="4" y="4" width="8" height="8" rx="1.6" />
  </svg>
);

const IconImport = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M8 2.6v6.6" strokeLinecap="round" />
    <path d="M5.5 6.9 8 9.4l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 10.6v1.3c0 .77.63 1.4 1.4 1.4h7.2c.77 0 1.4-.63 1.4-1.4v-1.3" strokeLinecap="round" />
  </svg>
);

const IconExport = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M8 10V3.4" strokeLinecap="round" />
    <path d="M5.5 5.7 8 3.2l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 10.6v1.3c0 .77.63 1.4 1.4 1.4h7.2c.77 0 1.4-.63 1.4-1.4v-1.3" strokeLinecap="round" />
  </svg>
);

/* Shown while the app is light, offering the dark side. */
const IconMoon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M13.2 9.6A5.4 5.4 0 0 1 6.4 2.8a5.4 5.4 0 1 0 6.8 6.8z" strokeLinejoin="round" />
  </svg>
);

/* Shown while the app is dark, offering the light side. */
const IconSun = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="8" cy="8" r="3.1" />
    <path
      d="M8 1.7v1.5M8 12.8v1.5M1.7 8h1.5M12.8 8h1.5M3.7 3.7l1.05 1.05M11.25 11.25l1.05 1.05M12.3 3.7l-1.05 1.05M4.75 11.25l-1.05 1.05"
      strokeLinecap="round"
    />
  </svg>
);

const IconOpen = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path
      d="M2.2 12.2V4.4c0-.5.4-.9.9-.9h2.8l1.3 1.6h4.7c.5 0 .9.4.9.9v1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.2 12.2 3.9 7.4c.1-.4.5-.6.9-.6h9c.6 0 1 .6.8 1.2l-1.4 4.2c-.1.4-.5.6-.9.6H3.1a.9.9 0 0 1-.9-.6z"
      strokeLinejoin="round"
    />
  </svg>
);

const IconSave = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path
      d="M3.4 2.6h7l2.2 2.2v8.6c0 .3-.3.6-.6.6H3.4a.6.6 0 0 1-.6-.6V3.2c0-.3.3-.6.6-.6z"
      strokeLinejoin="round"
    />
    <path d="M5.4 2.6v3.6h4.6V2.6" strokeLinejoin="round" />
    <path d="M5.4 9.6h5.2v4.4H5.4z" strokeLinejoin="round" />
  </svg>
);

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string; pct: number }
  | { kind: "done"; label: string }
  | { kind: "recording"; label: string }
  | { kind: "finishing"; label: string }
  | { kind: "error"; label: string };

export default function Topbar() {
  const theme = useTheme();
  const clip = useStore((s) => s.doc.clip);
  const crop = useStore((s) => s.doc.crop);
  const loadClip = useStore((s) => s.loadClip);
  const setPlaying = useStore((s) => s.setPlaying);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.hist.past.length > 0);
  const canRedo = useStore((s) => s.hist.future.length > 0);
  const dirty = useStore((s) => s.dirty);
  const projectPath = useStore((s) => s.projectPath);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [recording, setRecording] = useState(false);
  const [showError, setShowError] = useState(false);

  const name = projectName(projectPath);

  const onSave = async () => {
    try {
      if (await saveProject()) setStatus({ kind: "done", label: "Saved" });
    } catch (err) {
      setStatus({ kind: "error", label: err instanceof Error ? err.message : String(err) });
    }
  };

  const onOpen = async () => {
    // A project carries its own edits; losing unsaved ones to a file dialog is
    // the kind of thing you only forgive an app once.
    if (!(await ensureSaved())) return;
    try {
      setStatus({ kind: "idle" });
      await openProjectFile({
        onProxy: (p) =>
          setStatus({
            kind: "busy",
            label: "Converting for playback",
            pct: Math.round(p.fraction * 100),
          }),
        onMissingSource: (path) =>
          setStatus({
            kind: "busy",
            label: `Can't find ${path.split("/").pop()} — locate it`,
            pct: 0,
          }),
      });
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", label: err instanceof Error ? err.message : String(err) });
    }
  };

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

  const onRecord = async () => {
    if (recording) {
      // Flip out of the recording state before awaiting, so the button stops
      // offering to stop something that's already stopping.
      setRecording(false);
      setStatus({ kind: "finishing", label: "Finishing recording" });
      try {
        const clip = await stopRecording();
        loadClip(clip);
        setStatus({
          kind: "done",
          label: clip.cursor
            ? `Recorded ${clip.duration.toFixed(1)}s · ${clip.cursor.length} cursor samples`
            : `Recorded ${clip.duration.toFixed(1)}s (no cursor track)`,
        });
      } catch (err) {
        setStatus({ kind: "error", label: String(err) });
      }
      return;
    }

    setStatus({ kind: "busy", label: "Waiting for the screen picker", pct: 0 });
    try {
      await startRecording();
      setRecording(true);
      setStatus({ kind: "recording", label: "Recording" });
    } catch (err) {
      setStatus({ kind: "error", label: String(err) });
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
        <span className="brand-name">Motion</span>
      </div>

      {/* The chip names the *project* now that there is one to name. The clip
          moves to the meta line: which recording is loaded matters, but it is
          no longer what the document is called. */}
      <div className="topbar-center">
        <div className="doc-chip">
          <span className={name ? "doc-title" : "doc-title dim"}>
            {name ?? "Untitled"}
          </span>
          {dirty && <span className="doc-dirty" title="Unsaved changes" />}
          <span className="doc-meta">
            {clip ? (
              <>
                {clip.name} · {clip.width}×{clip.height}
                {crop.left + crop.right + crop.top + crop.bottom > 0 && " · cropped"}
                {clip.cursor ? " · cursor" : ""}
              </>
            ) : (
              "No recording"
            )}
          </span>
        </div>
      </div>

      <div className="topbar-right">
        {status.kind === "busy" && (
          <span className="status busy">
            {status.label} {status.pct}%
          </span>
        )}
        {status.kind === "recording" && (
          <span className="status rec">{status.label}</span>
        )}
        {status.kind === "finishing" && (
          <span className="status busy">{status.label}…</span>
        )}
        {status.kind === "done" && <span className="status done">{status.label}</span>}
        {/* A one-line summary in the bar, the rest on demand. Recorder failures
            arrive with the encoder's log attached, and collapsing that to its
            first line threw away the only part that said what went wrong. */}
        {status.kind === "error" && (
          <>
            <button
              className="status error"
              onClick={() => setShowError(true)}
              title="Show the full error"
            >
              {status.label.split("\n")[0]}
              {status.label.includes("\n") && <span className="status-more">details</span>}
            </button>
            {showError && (
              <div className="error-sheet" onClick={() => setShowError(false)}>
                <div className="error-body" onClick={(e) => e.stopPropagation()}>
                  <div className="error-head">
                    <h3>Something went wrong</h3>
                    <button className="ghost" onClick={() => setShowError(false)}>
                      Close
                    </button>
                  </div>
                  <pre>{status.label}</pre>
                  <button
                    className="wide-btn"
                    onClick={() => void navigator.clipboard?.writeText(status.label)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Project file actions, joined for the same reason as undo/redo:
            one concern, two directions. */}
        <div className="btn-group">
          <button onClick={onOpen} title="Open a project (Ctrl+O)">
            <IconOpen />
          </button>
          <button
            onClick={onSave}
            disabled={!dirty && !!projectPath}
            title={projectPath ? "Save (Ctrl+S)" : "Save as… (Ctrl+S)"}
          >
            <IconSave />
          </button>
        </div>

        <span className="tb-divider" />

        {/* Undo and redo are one control with two directions, so they're
            joined rather than sitting apart like unrelated actions. */}
        <div className="btn-group">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <IconUndo />
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            <IconRedo />
          </button>
        </div>

        <span className="tb-divider" />

        <button
          className="icon-btn"
          onClick={() => toggleTheme()}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>

        <button
          className={recording ? "rec-btn active" : "rec-btn"}
          onClick={onRecord}
          title={recording ? "Stop recording" : "Record the screen and cursor"}
        >
          {recording ? <IconStop /> : <IconCursor />}
          {recording ? "Stop" : "Record"}
        </button>
        <button className="ghost" onClick={onImport}>
          <IconImport />
          Import
        </button>
        <button
          className="primary-btn"
          onClick={onExport}
          disabled={!clip || status.kind === "busy"}
        >
          <IconExport />
          Export
        </button>
      </div>
    </header>
  );
}
