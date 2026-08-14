import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyHistory } from "../doc/history";
import { serializeDoc } from "../doc/project";
import { emptyDoc, useStore } from "../doc/store";
import type { Clip, Doc } from "../doc/types";
import { clipFromPath, importRecording } from "./import";
import { openProject } from "./project";

vi.mock("./import", () => ({
  clipFromPath: vi.fn(),
  importRecording: vi.fn(),
}));

const clipFromPathMock = vi.mocked(clipFromPath);
const importRecordingMock = vi.mocked(importRecording);

const SRC = "http://127.0.0.1:49152/f/token";

/** What clipFromPath/importRecording would return for a playable file. */
const handle = (path: string, over: Partial<Clip> = {}): Clip => ({
  src: SRC,
  path,
  name: path.split("/").pop() ?? path,
  proxied: false,
  cursor: null,
  duration: 10,
  width: 1280,
  height: 720,
  ...over,
});

/** A loaded project: clip has `src: ""` (never persisted) and a real path. */
function docWithClip(path: string, cursor = false): Doc {
  const d = emptyDoc();
  d.clip = {
    src: "",
    path,
    name: "rec.webm",
    proxied: false,
    cursor: cursor ? [{ t: 0.5, x: 10, y: 20 }] : null,
    duration: 10,
    width: 1280,
    height: 720,
  };
  d.segments = [{ id: "a", srcStart: 0, srcEnd: 10, speed: 1 }];
  return d;
}

beforeEach(() => {
  useStore.setState({
    doc: emptyDoc(),
    dirty: false,
    hist: emptyHistory(),
    playhead: 0,
    playing: false,
    selectedId: null,
    selectedSegmentId: null,
    inPoint: null,
    outPoint: null,
  });
  clipFromPathMock.mockReset();
  importRecordingMock.mockReset();
});

describe("openProject", () => {
  it("relinks a source still on disk, keeping what the project persisted", async () => {
    clipFromPathMock.mockResolvedValue(handle("/videos/rec.webm"));

    await openProject(serializeDoc(docWithClip("/videos/rec.webm", true)));

    expect(clipFromPathMock).toHaveBeenCalledWith("/videos/rec.webm", {});
    expect(importRecordingMock).not.toHaveBeenCalled();
    const clip = useStore.getState().doc.clip;
    expect(clip?.src).toBe(SRC);
    expect(clip?.path).toBe("/videos/rec.webm");
    // The cursor track lives in the project, not in the handle — relinking
    // must not drop it.
    expect(clip?.cursor).toEqual([{ t: 0.5, x: 10, y: 20 }]);
  });

  it("keeps the proxy flag when the handle is a transcode", async () => {
    clipFromPathMock.mockResolvedValue(handle("/videos/rec.webm", { proxied: true }));

    await openProject(serializeDoc(docWithClip("/videos/rec.webm")));

    expect(useStore.getState().doc.clip?.proxied).toBe(true);
  });

  it("offers to locate a source that no longer resolves", async () => {
    clipFromPathMock.mockRejectedValue(new Error("no such file: /gone/rec.webm"));
    importRecordingMock.mockResolvedValue(null); // user declines
    const onMissing = vi.fn();

    await openProject(serializeDoc(docWithClip("/gone/rec.webm")), {
      onMissingSource: onMissing,
    });

    expect(onMissing).toHaveBeenCalledWith("/gone/rec.webm");
    expect(importRecordingMock).toHaveBeenCalled();
    // Declining still opens the project — the edits are the point, and the
    // clip stays unlinked until it can be found.
    expect(useStore.getState().doc.clip?.src).toBe("");
  });

  it("relinks when the located file is the same recording, keeping the cursor track", async () => {
    clipFromPathMock.mockRejectedValue(new Error("no such file"));
    importRecordingMock.mockResolvedValue(handle("/moved/rec.webm"));

    await openProject(serializeDoc(docWithClip("/moved/rec.webm", true)));

    const clip = useStore.getState().doc.clip;
    expect(clip?.src).toBe(SRC);
    expect(clip?.cursor).toEqual([{ t: 0.5, x: 10, y: 20 }]);
  });

  it("replaces the clip when a different file is located", async () => {
    clipFromPathMock.mockRejectedValue(new Error("no such file"));
    importRecordingMock.mockResolvedValue(handle("/new/rec.webm", { duration: 5 }));

    await openProject(serializeDoc(docWithClip("/old/rec.webm")));

    const clip = useStore.getState().doc.clip;
    expect(clip?.path).toBe("/new/rec.webm");
    expect(clip?.duration).toBe(5);
    expect(clip?.cursor).toBeNull();
  });

  it("opens a project without a clip untouched", async () => {
    await openProject(serializeDoc(emptyDoc()));

    expect(clipFromPathMock).not.toHaveBeenCalled();
    expect(importRecordingMock).not.toHaveBeenCalled();
    expect(useStore.getState().doc.clip).toBeNull();
  });

  it("starts a fresh undo stack and a clean document", async () => {
    // Leave an undo entry behind, as a previous project would.
    useStore.getState().patchDoc({ crop: { top: 0.1, right: 0, bottom: 0, left: 0 } });
    expect(useStore.getState().hist.past.length).toBeGreaterThan(0);

    clipFromPathMock.mockResolvedValue(handle("/videos/rec.webm"));
    await openProject(serializeDoc(docWithClip("/videos/rec.webm")));

    const after = useStore.getState();
    expect(after.hist.past).toHaveLength(0);
    expect(after.hist.future).toHaveLength(0);
    expect(after.playhead).toBe(0);
    expect(after.dirty).toBe(false);
  });

  it("propagates a parse error without touching the current document", async () => {
    const before = useStore.getState().doc;
    await expect(openProject("this is not a project")).rejects.toThrow(/not a project/i);
    expect(useStore.getState().doc).toBe(before);
  });
});
