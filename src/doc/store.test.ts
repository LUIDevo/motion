import { beforeEach, describe, expect, it } from "vitest";
import { emptyDoc, useStore } from "./store";
import { docDuration } from "./time";
import { emptyHistory } from "./history";
import type { Doc } from "./types";

/** A 10s clip with one segment, and whatever blocks the test needs. */
function baseDoc(blocks: Doc["blocks"] = []): Doc {
  const d = emptyDoc();
  return {
    ...d,
    clip: {
      src: "x",
      path: null,
      name: "x.mp4",
      proxied: false,
      cursor: null,
      duration: 10,
      width: 100,
      height: 100,
    },
    segments: [{ id: "a", srcStart: 0, srcEnd: 10, speed: 1 }],
    blocks,
  };
}

const zoom = (id: string, start: number, end: number) => ({
  id,
  kind: "zoom" as const,
  start,
  end,
  rampIn: 0.4,
  rampOut: 0.4,
  scale: 2,
  target: { x: 0.5, y: 0.5 },
  ease: "linear" as const,
  bounce: 0,
  followCursor: false,
  chain: false,
});

beforeEach(() => {
  useStore.setState({
    doc: baseDoc(),
    hist: emptyHistory(),
    playhead: 0,
    playing: false,
    selectedId: null,
    selectedSegmentId: null,
    inPoint: null,
    outPoint: null,
  });
});

describe("cutRange", () => {
  it("removes the marked range and closes the gap", () => {
    useStore.setState({
      doc: baseDoc(),
      inPoint: 3,
      outPoint: 7,
    });
    useStore.getState().cutRange();

    const doc = useStore.getState().doc;
    expect(doc.segments.map((s) => [s.srcStart, s.srcEnd])).toEqual([
      [0, 3],
      [7, 10],
    ]);
    expect(docDuration(doc)).toBeCloseTo(6);
    // The right half is a new segment id, so a second cut can't touch the same
    // piece twice.
    expect(doc.segments[1].id).not.toBe("a");
  });

  it("cuts across the start and end of the clip", () => {
    useStore.setState({ doc: baseDoc(), inPoint: 0, outPoint: 2 });
    useStore.getState().cutRange();
    expect(
      useStore.getState().doc.segments.map((s) => [s.srcStart, s.srcEnd]),
    ).toEqual([[2, 10]]);
  });

  it("adjusts zoom blocks: keeps, shifts, trims and drops", () => {
    useStore.setState({
      doc: baseDoc([
        zoom("before", 1, 2), // untouched
        zoom("straddle", 2, 5), // ends inside the cut -> clamp to 3
        zoom("inside", 3.5, 6.5), // fully removed
        zoom("spans", 2, 9), // spans the whole cut -> 2..5
        zoom("after", 8, 9.5), // shifts left by 4
      ]),
      inPoint: 3,
      outPoint: 7,
    });
    useStore.getState().cutRange();

    const blocks = useStore.getState().doc.blocks;
    expect(blocks.map((b) => [b.id, b.start, b.end])).toEqual([
      ["before", 1, 2],
      ["straddle", 2, 3],
      ["spans", 2, 5],
      ["after", 4, 5.5],
    ]);
  });

  it("does nothing without a valid range", () => {
    useStore.setState({ doc: baseDoc(), inPoint: null, outPoint: 4 });
    const before = useStore.getState().doc;
    useStore.getState().cutRange();
    expect(useStore.getState().doc).toBe(before); // no history entry

    useStore.setState({ doc: baseDoc(), inPoint: 4, outPoint: 4 });
    useStore.getState().cutRange();
    expect(useStore.getState().doc.segments).toHaveLength(1);
  });

  it("clears the markers after cutting", () => {
    useStore.setState({ doc: baseDoc(), inPoint: 1, outPoint: 2 });
    useStore.getState().cutRange();
    expect(useStore.getState().inPoint).toBeNull();
    expect(useStore.getState().outPoint).toBeNull();
  });

  it("is undoable", () => {
    useStore.setState({ doc: baseDoc(), inPoint: 3, outPoint: 7 });
    useStore.getState().cutRange();
    useStore.getState().undo();

    const doc = useStore.getState().doc;
    expect(doc.segments.map((s) => [s.srcStart, s.srcEnd])).toEqual([[0, 10]]);
    expect(docDuration(doc)).toBeCloseTo(10);
  });
});

describe("markers", () => {
  it("setting the in point after the out point throws the out point away", () => {
    useStore.setState({ doc: baseDoc(), playhead: 8, outPoint: 5 });
    useStore.getState().setInPoint();
    expect(useStore.getState().inPoint).toBe(8);
    expect(useStore.getState().outPoint).toBeNull();
  });

  it("setting the out point before the in point throws the in point away", () => {
    useStore.setState({ doc: baseDoc(), playhead: 1, inPoint: 5 });
    useStore.getState().setOutPoint();
    expect(useStore.getState().outPoint).toBe(1);
    expect(useStore.getState().inPoint).toBeNull();
  });
});

describe("crop", () => {
  it("crops edges through patchDoc", () => {
    useStore.getState().patchDoc({ crop: { top: 0, right: 0.1, bottom: 0, left: 0.1 } });
    expect(useStore.getState().doc.crop).toEqual({
      top: 0,
      right: 0.1,
      bottom: 0,
      left: 0.1,
    });
  });

  it("importing a clip resets the crop", () => {
    useStore.getState().patchDoc({ crop: { top: 0.2, right: 0, bottom: 0, left: 0 } });
    useStore.getState().loadClip({
      src: "y",
      path: null,
      name: "y.mp4",
      proxied: false,
      cursor: null,
      duration: 5,
      width: 640,
      height: 360,
    });
    expect(useStore.getState().doc.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
