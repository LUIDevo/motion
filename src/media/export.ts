import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Doc } from "../doc/types";
import { docDuration, sourceAt } from "../doc/time";
import { renderFrame } from "../render/renderer";

export interface ExportOptions {
  fps: number;
  quality: number; // ffmpeg CRF: lower is better
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
}

/**
 * Seek and wait for the frame to actually be decoded. Seeking to a time the
 * element is already at fires nothing, so the timeout keeps the export from
 * hanging on a no-op seek.
 */
function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", finish);
      resolve();
    };
    v.addEventListener("seeked", finish);
    setTimeout(finish, 400);
    v.currentTime = t;
  });
}

const stripDataUrl = (s: string) => s.slice(s.indexOf(",") + 1);

/**
 * Render the timeline frame by frame and hand each one to ffmpeg.
 *
 * Deliberately not a realtime capture of the preview: stepping the source
 * manually means the output is deterministic and independent of how fast the
 * machine can paint, so a heavy composition can't drop frames in the file.
 */
export async function exportVideo(
  doc: Doc,
  outPath: string,
  opts: ExportOptions,
): Promise<void> {
  if (!isTauri()) throw new Error("Export needs the desktop app (ffmpeg runs natively).");
  if (!doc.clip) throw new Error("Nothing to export.");

  const { fps, quality } = opts;
  const total = Math.max(1, Math.floor(docDuration(doc) * fps));

  const canvas = document.createElement("canvas");
  canvas.width = doc.output.width;
  canvas.height = doc.output.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create an export canvas.");

  // A dedicated element so scrubbing the export doesn't fight the preview.
  const v = document.createElement("video");
  v.src = doc.clip.src;
  v.muted = true;
  v.preload = "auto";
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("Could not decode the source video."));
  });

  const dir = await invoke<string>("export_begin");

  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.cancelled) throw new Error("Export cancelled.");
      const t = i / fps;
      // Cuts and speed live in the timeline mapping, so the export steps the
      // source exactly where the preview would have it.
      const hit = sourceAt(doc, t);
      if (hit) await seek(v, Math.min(hit.srcTime, doc.clip.duration - 1e-3));
      renderFrame(ctx, doc, t, v);
      const data = stripDataUrl(canvas.toDataURL("image/jpeg", 0.95));
      await invoke("export_frame", { dir, index: i, data });
      opts.onProgress?.(i + 1, total);
    }

    await invoke("export_finish", { dir, fps, crf: quality, out: outPath });
  } finally {
    v.removeAttribute("src");
    v.load();
    await invoke("export_cleanup", { dir }).catch(() => {});
  }
}

export async function pickExportPath(suggested: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const p = await save({
    defaultPath: suggested,
    filters: [{ name: "MP4 video", extensions: ["mp4"] }],
  });
  return p ?? null;
}
