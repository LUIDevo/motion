import { describe, expect, it } from "vitest";
import { emptyDoc } from "./store";
import { parseProject, serializeDoc } from "./project";
import type { Doc } from "./types";

/** A doc with everything populated, as the app would produce mid-project. */
function richDoc(): Doc {
  const d = emptyDoc();
  return {
    ...d,
    output: { width: 1280, height: 720 },
    clip: {
      src: "blob:http://localhost/deadbeef", // must never survive serialization
      path: "/home/user/demo.mp4",
      name: "demo.mp4",
      proxied: true,
      cursor: [
        { t: 0.1, x: 120, y: 40 },
        { t: 0.4, x: 300, y: 90 },
      ],
      duration: 12.5,
      width: 1280,
      height: 720,
    },
    segments: [
      { id: "a", srcStart: 0, srcEnd: 6, speed: 1 },
      { id: "b", srcStart: 6, srcEnd: 12.5, speed: 0.5 },
    ],
    background: { kind: "radial", from: "#FFFFFF", to: "#DFE2E6" },
    frame: { padding: 0.1, radius: 24, shadowBlur: 60, shadowOpacity: 0.3, shadowY: 20 },
    blocks: [
      {
        id: "z1",
        kind: "zoom",
        start: 1,
        end: 4,
        rampIn: 0.6,
        rampOut: 0.6,
        scale: 2.2,
        target: { x: 0.3, y: 0.7 },
        ease: "spring",
        bounce: 0.4,
        followCursor: true,
        chain: false,
      },
    ],
    zoomDefaults: { scale: 2, duration: 3, ramp: 0.8, ease: "easeOut", bounce: 0.2 },
    cursorStyle: {
      enabled: true,
      highlightSize: 0.08,
      highlightOpacity: 0.5,
      color: "#ff8800",
      trail: 0.5,
      trailWidth: 0.02,
      trailOpacity: 0.6,
    },
    cursorSmoothing: 0.3,
  };
}

describe("serializeDoc", () => {
  it("round-trips an empty document exactly", () => {
    const doc = emptyDoc();
    const parsed = parseProject(serializeDoc(doc));
    expect(parsed.doc).toEqual(doc);
    expect(parsed.sourcePath).toBeNull();
  });

  it("round-trips a full document exactly when src is already empty", () => {
    const doc = richDoc();
    // The in-memory doc carries a runtime handle; serialise as if it were
    // already reloaded (src cleared) and compare to that same shape.
    const ready = { ...doc, clip: { ...doc.clip!, src: "" } };
    expect(parseProject(serializeDoc(ready)).doc).toEqual(ready);
  });

  it("never writes clip.src, but keeps the path", () => {
    const doc = richDoc();
    const text = serializeDoc(doc);
    expect(text).not.toContain("blob:");
    expect(text).toContain("/home/user/demo.mp4");

    const parsed = parseProject(text);
    expect(parsed.doc.clip?.src).toBe("");
    expect(parsed.doc.clip?.path).toBe("/home/user/demo.mp4");
    expect(parsed.sourcePath).toBe("/home/user/demo.mp4");
  });

  it("does not mutate the document it serialises", () => {
    const doc = richDoc();
    serializeDoc(doc);
    expect(doc.clip?.src).toBe("blob:http://localhost/deadbeef");
  });

  it("writes a version-1 envelope and pretty-prints", () => {
    const text = serializeDoc(emptyDoc());
    expect(JSON.parse(text).version).toBe(1);
    expect(text).toMatch(/\n {2}"doc"/); // indented, diff-friendly
  });
});

describe("parseProject", () => {
  it("fills every field an older file predates", () => {
    // A file written before cursorStyle, cursorSmoothing, block easing,
    // bounce, followCursor and chain existed — plus a clip missing most of
    // its fields.
    const text = JSON.stringify({
      version: 1,
      doc: {
        output: { width: 640 },
        clip: { path: "/old/recording.webm", duration: 3 },
        segments: [{ srcStart: 0, srcEnd: 3 }],
        blocks: [
          { start: 0.5, end: 2, scale: 3, target: { x: 0.25 } },
        ],
      },
    });
    const { doc } = parseProject(text);

    // document-level late fields
    expect(doc.cursorSmoothing).toBe(0.22);
    expect(doc.cursorStyle.enabled).toBe(false);

    // clip gaps
    expect(doc.clip?.src).toBe("");
    expect(doc.clip?.path).toBe("/old/recording.webm");
    expect(doc.clip?.name).toBe("Recording");
    expect(doc.clip?.cursor).toBeNull();
    expect(doc.clip?.proxied).toBe(false);

    // segments get ids and a sane speed
    expect(doc.segments).toHaveLength(1);
    expect(doc.segments[0].speed).toBe(1);
    expect(doc.segments[0].id).toBeTruthy();

    // block late fields, with the editor's feel
    const block = doc.blocks[0];
    expect(block.ease).toBe("spring");
    expect(block.bounce).toBe(0.3);
    expect(block.followCursor).toBe(false);
    expect(block.chain).toBe(false);
    expect(block.target.y).toBe(0.5);

    // nested defaults for missing top-level fields
    expect(doc.background).toEqual(emptyDoc().background);
    expect(doc.frame).toEqual(emptyDoc().frame);
    expect(doc.zoomDefaults).toEqual(emptyDoc().zoomDefaults);
  });

  it("fills partial nested values without clobbering present ones", () => {
    const { doc } = parseProject(
      JSON.stringify({
        version: 1,
        doc: {
          frame: { radius: 40 }, // only one of five fields
          zoomDefaults: { ease: "linear" },
          blocks: [{ start: 0, end: 5, rampIn: 9 }], // ramp wider than the block
        },
      }),
    );
    expect(doc.frame.radius).toBe(40);
    expect(doc.frame.padding).toBe(emptyDoc().frame.padding);
    expect(doc.zoomDefaults.ease).toBe("linear");
    expect(doc.blocks[0].rampIn).toBe(2.5); // clamped to half the block
    expect(doc.blocks[0].rampOut).toBe(0.5);
  });

  it("sorts cursor samples and drops zero-length segments and blocks", () => {
    const { doc } = parseProject(
      JSON.stringify({
        version: 1,
        doc: {
          clip: {
            path: "/x.mp4",
            cursor: [
              { t: 2, x: 5, y: 5 },
              { t: 1, x: 1, y: 1 },
            ],
          },
          segments: [{ id: "keep", srcStart: 0, srcEnd: 2 }, { id: "drop", srcStart: 3, srcEnd: 3 }],
          blocks: [{ start: 0, end: 0 }],
        },
      }),
    );
    expect(doc.clip?.cursor?.map((s) => s.t)).toEqual([1, 2]);
    expect(doc.segments.map((s) => s.id)).toEqual(["keep"]);
    expect(doc.blocks).toHaveLength(0);
  });

  it("coerces junk values: wrong types default, out-of-range values clamp", () => {
    const { doc } = parseProject(
      JSON.stringify({
        version: 1,
        doc: {
          output: { width: "wide", height: -5 },
          cursorSmoothing: "fast",
          blocks: [{ start: 1, end: 2, target: "nowhere", scale: 0.5 }],
        },
      }),
    );
    expect(doc.output.width).toBe(1920); // wrong type -> default
    expect(doc.output.height).toBe(1); // out of range -> clamped to minimum
    expect(doc.cursorSmoothing).toBe(0.22);
    expect(doc.blocks[0].scale).toBe(1); // below 1 clamps, never an inverted zoom
    expect(doc.blocks[0].target).toEqual({ x: 0.5, y: 0.5 });
  });

  it("fills the crop field added after the first format shipped", () => {
    const { doc } = parseProject(JSON.stringify({ version: 1, doc: {} }));
    expect(doc.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });

    const cropped = parseProject(
      JSON.stringify({
        version: 1,
        doc: { crop: { top: 0.2, right: -1, bottom: 3, left: 0.1 } },
      }),
    ).doc;
    expect(cropped.crop).toEqual({ top: 0.2, right: 0, bottom: 1, left: 0.1 });
  });
});

describe("parseProject validation", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseProject("this is not json")).toThrow(/not a project/i);
  });

  it("throws on a non-object file", () => {
    expect(() => parseProject('"just a string"')).toThrow(/expected an object/i);
    expect(() => parseProject("[1,2,3]")).toThrow(/expected an object/i);
  });

  it("throws when version is missing, invalid, or newer than supported", () => {
    expect(() => parseProject("{}")).toThrow(/version/i);
    expect(() => parseProject('{"version": 0, "doc": {}}')).toThrow(/version/i);
    expect(() => parseProject('{"version": 1.5, "doc": {}}')).toThrow(/version/i);
    expect(() => parseProject('{"version": 99, "doc": {}}')).toThrow(/newer/i);
  });

  it("throws when there is no document inside", () => {
    expect(() => parseProject('{"version": 1}')).toThrow(/no document/i);
  });
});
