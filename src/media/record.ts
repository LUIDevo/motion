import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { Clip, CursorSample } from "../doc/types";

interface RecordingResult {
  videoPath: string;
  cursorPath: string;
  width: number;
  height: number;
  duration: number;
}

export async function startRecording(): Promise<void> {
  if (!isTauri()) throw new Error("Recording needs the desktop app.");
  await invoke<string>("start_recording");
}

/** Read a probe of the video to get its true duration. The recorder reports
 *  wall-clock elapsed time, which includes the moment before the first frame
 *  arrives and so runs slightly long. */
function probe(src: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve(isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
      v.src = "";
    };
    v.onerror = () => resolve(0);
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
  const src = convertFileSrc(rec.videoPath);

  let cursor: CursorSample[] | null = null;
  try {
    const res = await fetch(convertFileSrc(rec.cursorPath));
    cursor = (await res.json()) as CursorSample[];
  } catch {
    // A missing or unreadable track only costs follow-cursor, so the recording
    // is still worth loading.
    cursor = null;
  }

  const measured = await probe(src);

  return {
    src,
    path: rec.videoPath,
    name: rec.videoPath.split("/").pop() ?? "recording.webm",
    proxied: false,
    cursor,
    duration: measured || rec.duration,
    width: rec.width,
    height: rec.height,
  };
}
