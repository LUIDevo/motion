import { invoke, isTauri } from "@tauri-apps/api/core";
import { mediaUrl } from "./import";
import type { Clip, CursorSample } from "../doc/types";

interface RecordingResult {
  videoPath: string;
  cursorPath: string;
  width: number;
  height: number;
  duration: number;
  cursor: CursorSample[];
}

export async function startRecording(): Promise<void> {
  if (!isTauri()) throw new Error("Recording needs the desktop app.");
  await invoke<string>("start_recording");
}

/**
 * Confirm the webview can actually play the file back, and get its duration.
 *
 * Always settles: a video element that neither loads nor errors would
 * otherwise hang the whole stop flow with no way out, which is exactly what
 * left the UI stuck on "Finishing recording".
 */
function probe(src: string, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const done = (d: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      resolve(d);
    };
    const timer = setTimeout(() => done(0), timeoutMs);

    v.preload = "metadata";
    v.muted = true;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => done(isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
    v.onerror = () => done(0);
    v.src = src;
  });
}

/**
 * Stop the capture and turn it into an editable clip.
 *
 * The cursor track is read here rather than left on disk so the document owns
 * everything the renderer needs — a follow-cursor zoom must not depend on a
 * file that could move or be deleted between sessions.
 */
export async function stopRecording(): Promise<Clip> {
  if (!isTauri()) throw new Error("Recording needs the desktop app.");

  const rec = await invoke<RecordingResult>("stop_recording");
  const src = await mediaUrl(rec.videoPath);

  const measured = await probe(src);

  return {
    src,
    path: rec.videoPath,
    name: rec.videoPath.split("/").pop() ?? "recording.webm",
    proxied: false,
    cursor: rec.cursor.length > 0 ? rec.cursor : null,
    duration: measured || rec.duration,
    width: rec.width,
    height: rec.height,
  };
}
