import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Clip } from "../doc/types";

const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "m4v"];

/**
 * Turn a MediaError into something that says what to actually do about it.
 *
 * The common case on Linux is a perfectly valid H.264 mp4 that the webview
 * cannot decode, because WebKitGTK delegates to GStreamer and the H.264
 * decoder ships in a separate package. That surfaces as a bare "decode failed",
 * which is useless on its own.
 */
function describeMediaError(v: HTMLVideoElement, src: string): string {
  const err = v.error;
  const detail = err?.message ? ` (${err.message})` : "";

  if (!err || err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return (
      "This video's codec can't be decoded here. WebKitGTK uses GStreamer, " +
      "and H.264 support lives in a separate package — install it with " +
      "`sudo pacman -S gst-libav` (Arch) or `gstreamer1.0-libav` (Debian/Ubuntu), " +
      `then reopen the file.${detail}`
    );
  }
  if (err.code === MediaError.MEDIA_ERR_DECODE) {
    return `The file decoded partway then failed — it may be truncated.${detail}`;
  }
  if (err.code === MediaError.MEDIA_ERR_NETWORK) {
    return `Could not read the file from disk: ${src}${detail}`;
  }
  return `Could not open the video.${detail}`;
}

/** Read duration and pixel dimensions without showing the element. */
function probe(src: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve({
        duration: v.duration,
        width: v.videoWidth || 1920,
        height: v.videoHeight || 1080,
      });
      v.src = "";
    };
    v.onerror = () => reject(new Error(describeMediaError(v, src)));
    v.src = src;
  });
}

async function fromBrowser(): Promise<Clip | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const src = URL.createObjectURL(file);
      const meta = await probe(src);
      resolve({ src, path: null, name: file.name, ...meta });
    };
    input.click();
  });
}

/**
 * Pick a recording to work on. Uses the native dialog under Tauri and a plain
 * file input in the browser, so `npm run dev` stays usable for UI work without
 * booting the whole desktop shell.
 */
export async function importRecording(): Promise<Clip | null> {
  if (!isTauri()) return fromBrowser();

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Video", extensions: VIDEO_EXT }],
  });
  if (typeof picked !== "string") return null;

  const src = convertFileSrc(picked);
  const meta = await probe(src);
  const name = picked.split("/").pop() ?? picked;
  return { src, path: picked, name, ...meta };
}
