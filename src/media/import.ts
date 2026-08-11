import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Clip } from "../doc/types";

const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "m4v"];

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
    v.onerror = () => reject(new Error(`Could not read video: ${src}`));
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
