import { create } from "zustand";
import type { Block, Clip, Doc, Segment, ZoomBlock } from "./types";
import { docDuration, segmentLength, segmentOffset, sourceAt } from "./time";

export { docDuration } from "./time";

export const emptyDoc = (): Doc => ({
  version: 1,
  output: { width: 1920, height: 1080 },
  clip: null,
  segments: [],
  background: { kind: "linear", from: "#EDEDED", to: "#DCDCDC", angle: 120 },
  frame: {
    padding: 0.07,
    radius: 18,
    shadowBlur: 70,
    shadowOpacity: 0.22,
    shadowY: 26,
  },
  blocks: [],
});

const uid = () => Math.random().toString(36).slice(2, 10);

const MIN_SEGMENT = 0.2;

/**
 * Editing the video track changes where every later moment sits on the
 * timeline. Zoom blocks are stored in timeline time, so without this they'd
 * silently slide off the thing they were aimed at whenever you trimmed.
 * Blocks that started inside the edited region are dropped rather than
 * stretched, since there's no honest place to put them.
 */
function shiftBlocks(blocks: Block[], from: number, delta: number): Block[] {
  if (delta === 0) return blocks;

  const moved = blocks
    .map((b) =>
      b.start >= from ? { ...b, start: b.start + delta, end: b.end + delta } : b,
    )
    .filter((b) => b.start >= 0 && b.end > b.start)
    .sort((a, b) => a.start - b.start);

  // Shifting can push a block back onto its neighbour. Overlapping blocks
  // would break the "one active block" assumption in the camera solve, so the
  // collided one is dropped instead of being left to fight.
  const kept: Block[] = [];
  let lastEnd = -Infinity;
  for (const b of moved) {
    if (b.start >= lastEnd) {
      kept.push(b);
      lastEnd = b.end;
    }
  }
  return kept;
}

/**
 * Blocks must not overlap — the camera solve assumes at most one is active at
 * a time. This finds the largest free span around `at` so a new block claims
 * real estate without ever colliding with its neighbours.
 */
function freeSpan(doc: Doc, at: number): { start: number; end: number } | null {
  const dur = docDuration(doc);
  let lo = 0;
  let hi = dur;
  for (const b of doc.blocks) {
    if (b.end <= at && b.end > lo) lo = b.end;
    if (b.start >= at && b.start < hi) hi = b.start;
    if (at >= b.start && at <= b.end) return null; // already inside a block
  }
  if (hi - lo < 0.4) return null;
  return { start: lo, end: hi };
}

interface State {
  doc: Doc;
  playhead: number;
  playing: boolean;
  selectedId: string | null;
  selectedSegmentId: string | null;

  loadClip: (clip: Clip) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (id: string | null) => void;
  selectSegment: (id: string | null) => void;

  addZoom: (at: number, target: { x: number; y: number }) => string | null;
  updateBlock: (id: string, patch: Partial<ZoomBlock>) => void;
  moveBlock: (id: string, start: number, end: number) => void;
  removeBlock: (id: string) => void;

  splitAt: (t: number) => void;
  trimSegment: (id: string, srcStart: number, srcEnd: number) => void;
  setSegmentSpeed: (id: string, speed: number) => void;
  removeSegment: (id: string) => void;

  patchDoc: (patch: Partial<Doc>) => void;
}

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  playhead: 0,
  playing: false,
  selectedId: null,
  selectedSegmentId: null,

  loadClip: (clip) =>
    set((s) => ({
      // Match the output to the source so a 16:10 laptop capture isn't
      // pillarboxed into a 16:9 canvas by default.
      doc: {
        ...s.doc,
        clip,
        output: { width: clip.width, height: clip.height },
        segments: [
          { id: uid(), srcStart: 0, srcEnd: clip.duration, speed: 1 },
        ],
        blocks: [],
      },
      playhead: 0,
      playing: false,
      selectedId: null,
      selectedSegmentId: null,
    })),

  setPlayhead: (t) =>
    set((s) => ({ playhead: Math.max(0, Math.min(docDuration(s.doc), t)) })),

  setPlaying: (p) => set({ playing: p }),
  select: (id) => set({ selectedId: id, selectedSegmentId: null }),
  selectSegment: (id) => set({ selectedSegmentId: id, selectedId: null }),

  addZoom: (at, target) => {
    const { doc } = get();
    const span = freeSpan(doc, at);
    if (!span) return null;

    // Aim for a comfortable 2.4s move but shrink to whatever room exists.
    const want = 2.4;
    const end = Math.min(span.end, at + want);
    const start = Math.max(span.start, Math.min(at, end - 0.6));
    const len = end - start;
    const ramp = Math.min(0.7, len * 0.35);

    const block: ZoomBlock = {
      id: uid(),
      kind: "zoom",
      start,
      end,
      rampIn: ramp,
      rampOut: ramp,
      scale: 2,
      target,
      ease: "spring",
      followCursor: false,
    };

    set((s) => ({
      doc: {
        ...s.doc,
        blocks: [...s.doc.blocks, block].sort((a, b) => a.start - b.start),
      },
      selectedId: block.id,
      selectedSegmentId: null,
    }));
    return block.id;
  },

  updateBlock: (id, patch) =>
    set((s) => ({
      doc: {
        ...s.doc,
        blocks: s.doc.blocks.map((b) =>
          b.id === id ? ({ ...b, ...patch } as Block) : b,
        ),
      },
    })),

  moveBlock: (id, start, end) =>
    set((s) => {
      const dur = docDuration(s.doc);
      const others = s.doc.blocks.filter((b) => b.id !== id);

      // Clamp against neighbours so dragging can crowd a block but never
      // push it through one.
      let lo = 0;
      let hi = dur;
      for (const b of others) {
        if (b.end <= start && b.end > lo) lo = b.end;
        if (b.start >= end && b.start < hi) hi = b.start;
      }
      const s2 = Math.max(lo, start);
      const e2 = Math.min(hi, end);
      if (e2 - s2 < 0.3) return s;

      return {
        doc: {
          ...s.doc,
          blocks: s.doc.blocks
            .map((b) => {
              if (b.id !== id) return b;
              const len = e2 - s2;
              return {
                ...b,
                start: s2,
                end: e2,
                rampIn: Math.min(b.rampIn, len / 2),
                rampOut: Math.min(b.rampOut, len / 2),
              };
            })
            .sort((a, b) => a.start - b.start),
        },
      };
    }),

  removeBlock: (id) =>
    set((s) => ({
      doc: { ...s.doc, blocks: s.doc.blocks.filter((b) => b.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  /** Cut the segment under the playhead in two. Total length is unchanged, so
   *  zoom blocks stay exactly where they were. */
  splitAt: (t) =>
    set((s) => {
      const hit = sourceAt(s.doc, t);
      if (!hit) return s;

      const { segment, index } = hit;
      const left: Segment = { ...segment, srcEnd: hit.srcTime };
      const right: Segment = { ...segment, id: uid(), srcStart: hit.srcTime };
      if (segmentLength(left) < MIN_SEGMENT || segmentLength(right) < MIN_SEGMENT) {
        return s;
      }

      const segments = [...s.doc.segments];
      segments.splice(index, 1, left, right);
      return { doc: { ...s.doc, segments }, selectedSegmentId: right.id };
    }),

  trimSegment: (id, srcStart, srcEnd) =>
    set((s) => {
      const index = s.doc.segments.findIndex((x) => x.id === id);
      if (index < 0 || !s.doc.clip) return s;
      const seg = s.doc.segments[index];

      const lo = Math.max(0, Math.min(srcStart, srcEnd - MIN_SEGMENT * seg.speed));
      const hi = Math.min(
        s.doc.clip.duration,
        Math.max(srcEnd, lo + MIN_SEGMENT * seg.speed),
      );

      const next: Segment = { ...seg, srcStart: lo, srcEnd: hi };
      const delta = segmentLength(next) - segmentLength(seg);
      const after = segmentOffset(s.doc, index) + segmentLength(seg);

      const segments = [...s.doc.segments];
      segments[index] = next;
      return {
        doc: { ...s.doc, segments, blocks: shiftBlocks(s.doc.blocks, after, delta) },
      };
    }),

  setSegmentSpeed: (id, speed) =>
    set((s) => {
      const index = s.doc.segments.findIndex((x) => x.id === id);
      if (index < 0) return s;
      const seg = s.doc.segments[index];
      const next: Segment = { ...seg, speed: Math.max(0.25, Math.min(8, speed)) };

      const delta = segmentLength(next) - segmentLength(seg);
      const after = segmentOffset(s.doc, index) + segmentLength(seg);

      const segments = [...s.doc.segments];
      segments[index] = next;
      return {
        doc: { ...s.doc, segments, blocks: shiftBlocks(s.doc.blocks, after, delta) },
      };
    }),

  removeSegment: (id) =>
    set((s) => {
      if (s.doc.segments.length <= 1) return s; // never leave an empty timeline
      const index = s.doc.segments.findIndex((x) => x.id === id);
      if (index < 0) return s;

      const seg = s.doc.segments[index];
      const at = segmentOffset(s.doc, index);
      const len = segmentLength(seg);

      const segments = s.doc.segments.filter((x) => x.id !== id);
      const blocks = shiftBlocks(
        s.doc.blocks.filter((b) => b.end <= at || b.start >= at + len),
        at + len,
        -len,
      );

      return {
        doc: { ...s.doc, segments, blocks },
        selectedSegmentId: null,
        playhead: Math.min(s.playhead, at),
      };
    }),

  patchDoc: (patch) => set((s) => ({ doc: { ...s.doc, ...patch } })),
}));
