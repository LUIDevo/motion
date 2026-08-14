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

/** How long a single frame's decode may take before the export gives up. */
const SEEK_TIMEOUT_MS = 15_000;

/**
 * Seek and wait for the frame to actually be decoded.
 *
 * Seeking to a time the element is already at fires no event, so that case
 * returns immediately. Everything else waits for `seeked` and *fails* on
 * timeout rather than carrying on: this used to resolve after 400ms regardless,
 * which meant a slow decode silently wrote the previous frame's pixels into the
 * export. A visibly failed render is recoverable; a file that is quietly wrong
 * in a few places is not.
 */
function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(v.currentTime - t) < 1e-4) return resolve();

    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Could not decode the source at ${t.toFixed(3)}s.`));
    };

    v.addEventListener("seeked", onSeeked);
    v.addEventListener("error", onError);
    timer = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out decoding the source at ${t.toFixed(3)}s. The file may be ` +
            `corrupt, or the codec too slow to seek in this webview.`,
        ),
      );
    }, SEEK_TIMEOUT_MS);

    v.currentTime = t;
  });
}

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
  // Every frame is read straight back out of this canvas, which is exactly the
  // access pattern this hint exists for — without it the canvas may live in
  // GPU memory and each read costs a pipeline stall.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create an export canvas.");

  // A dedicated element so scrubbing the export doesn't fight the preview.
  const v = document.createElement("video");
  // Must be set before src: it decides whether the canvas ends up tainted,
  // and a tainted canvas makes the toDataURL below throw.
  v.crossOrigin = "anonymous";
  v.src = doc.clip.src;
  v.muted = true;
  v.preload = "auto";
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("Could not decode the source video."));
  });

  await invoke("export_begin", {
    width: canvas.width,
    height: canvas.height,
    fps,
    crf: quality,
    out: outPath,
  });

  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.cancelled) throw new Error("Export cancelled.");
      const t = i / fps;
      // Cuts and speed live in the timeline mapping, so the export steps the
      // source exactly where the preview would have it.
      const hit = sourceAt(doc, t);
      if (hit) await seek(v, Math.min(hit.srcTime, doc.clip.duration - 1e-3));
      renderFrame(ctx, doc, t, v);

      // Raw RGBA straight into ffmpeg's stdin. Passing the buffer as the whole
      // argument — rather than a field of an object — is what makes Tauri send
      // it as a binary body instead of serialising it as a JSON number array.
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // A view over the same memory, not a copy — ImageData hands back a
      // clamped array and Tauri wants a plain one.
      const bytes = new Uint8Array(
        frame.data.buffer,
        frame.data.byteOffset,
        frame.data.byteLength,
      );
      await invoke("export_frame", bytes);

      opts.onProgress?.(i + 1, total);
    }

    await invoke("export_finish");
  } catch (err) {
    await invoke("export_cancel").catch(() => {});
    throw err;
  } finally {
    v.removeAttribute("src");
    v.load();
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
