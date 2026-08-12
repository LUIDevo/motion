import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { Clip } from "../doc/types";

const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "m4v", "avi"];

export interface ProxyProgress {
  fraction: number;
  stage: string;
}

/**
 * Resolve a path on disk to a URL the webview can play.
 *
 * Deliberately not `convertFileSrc`: WebKitGTK decodes media in a separate
 * process that can't reach the asset protocol's custom scheme, so an
 * asset:// video never loads at all.
 */
export async function mediaUrl(path: string): Promise<string> {
  return invoke<string>("media_url", { path });
}

/** Thrown when the webview can't decode a file but ffmpeg probably can. */
class CodecError extends Error {}

/**
 * Turn a MediaError into something that says what actually went wrong.
 *
 * The common case on Linux is a perfectly valid H.264 mp4 that the webview
 * cannot decode, because WebKitGTK delegates to GStreamer and the H.264
 * decoder ships in a separate package. That surfaces as a bare failure, which
 * is useless on its own — and is recoverable by transcoding, so it gets its
 * own error type.
 */
function mediaError(v: HTMLVideoElement, src: string): Error {
  const err = v.error;
  const detail = err?.message ? ` (${err.message})` : "";

  if (!err || err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return new CodecError(`This build of WebKit can't decode the file${detail}`);
  }
  if (err.code === MediaError.MEDIA_ERR_DECODE) {
    return new CodecError(`The file failed to decode${detail}`);
  }
  if (err.code === MediaError.MEDIA_ERR_NETWORK) {
    return new Error(`Could not read the file from disk: ${src}${detail}`);
  }
  return new Error(`Could not open the video.${detail}`);
}

/** Read duration and pixel dimensions without showing the element. */
function probe(src: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => {
      resolve({
        duration: v.duration,
        width: v.videoWidth || 1920,
        height: v.videoHeight || 1080,
      });
      v.src = "";
    };
    v.onerror = () => reject(mediaError(v, src));
    v.src = src;
  });
}

async function fromBrowser(): Promise<Clip | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const src = URL.createObjectURL(file);
      try {
        const meta = await probe(src);
        resolve({ src, path: null, name: file.name, proxied: false, cursor: null, ...meta });
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

export interface ImportHooks {
  /** Called when a transcode starts, so the UI can explain the wait. */
  onProxy?: (p: ProxyProgress) => void;
}

/**
 * Pick a recording to work on. Uses the native dialog under Tauri and a plain
 * file input in the browser, so `npm run dev` stays usable for UI work without
 * booting the whole desktop shell.
 *
 * If the webview can't decode the file, it's transcoded to a VP9 proxy rather
 * than refused — the editor never has to care which codec the source was in.
 */
export async function importRecording(hooks: ImportHooks = {}): Promise<Clip | null> {
  if (!isTauri()) return fromBrowser();

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Video", extensions: VIDEO_EXT }],
  });
  if (typeof picked !== "string") return null;

  const name = picked.split("/").pop() ?? picked;

  // Fast path: if the webview plays it, use the original and skip transcoding.
  try {
    const direct = await mediaUrl(picked);
    const meta = await probe(direct);
    return { src: direct, path: picked, name, proxied: false, cursor: null, ...meta };
  } catch (err) {
    if (!(err instanceof CodecError)) throw err;
  }

  const channel = new Channel<ProxyProgress>();
  channel.onmessage = (p) => hooks.onProxy?.(p);

  const proxyPath = await invoke<string>("make_proxy", {
    src: picked,
    onProgress: channel,
  });

  const proxySrc = await mediaUrl(proxyPath);
  const meta = await probe(proxySrc);
  return { src: proxySrc, path: picked, name, proxied: true, cursor: null, ...meta };
}
