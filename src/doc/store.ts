import { create } from "zustand";
import type { Block, Clip, Doc, Segment, ZoomBlock } from "./types";
import { docDuration, segmentLength, segmentOffset, sourceAt } from "./time";
import { emptyHistory, push, type History } from "./history";

export { docDuration } from "./time";

export const emptyDoc = (): Doc => ({
  version: 1,
  output: { width: 1920, height: 1080 },
  clip: null,
  segments: [],
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { kind: "linear", from: "#F2F2F0", to: "#E2E2DF", angle: 120 },
  frame: {
    padding: 0.07,
    radius: 18,
    shadowBlur: 70,
    shadowOpacity: 0.22,
    shadowY: 26,
  },
  blocks: [],
  zoomDefaults: {
    scale: 1.9,
    // A push-in wants to feel deliberate. Under about a second of ramp it
    // reads as a snap rather than a camera move, which was the old default's
    // problem.
    duration: 4,
    ramp: 1.2,
    ease: "spring",
    bounce: 0.3,
  },
  cursorStyle: {
    // Off until asked for: a clip imported from elsewhere has no cursor track,
    // and a recorded one shouldn't gain decoration nobody chose.
    enabled: false,
    highlightSize: 0.06,
    highlightOpacity: 0.3,
    color: "#1e66f5",
    trail: 0.35,
    trailWidth: 0.012,
    trailOpacity: 0.45,
  },
  cursorSmoothing: 0.22,
});

const uid = () => Math.random().toString(36).slice(2, 10);

const MIN_SEGMENT = 0.2;

/**
 * Editing the video track changes where every later moment sits on the
 * timeline. Zoom blocks are stored in timeline time, so without this they'd
 * silently slide off the thing they were aimed at whenever you trimmed.
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
  /** Whether the document has changes that haven't been saved. Set only by
   *  [`commit`] — every mutation funnels through it — and cleared when a
   *  document is loaded. */
  dirty: boolean;
  /** File this document was last read from or written to, if any. Null for a
   *  document that has never been saved, which is what makes Save fall back to
   *  Save As rather than needing a separate "is this new?" flag. */
  projectPath: string | null;
  hist: History;
  playhead: number;
  playing: boolean;
  selectedId: string | null;
  selectedSegmentId: string | null;
  /**
   * Bounds of the range to cut out of the timeline, in timeline time.
   * Kept off the document: like the playhead they're an editing aid, not
   * something a project should serialise.
   */
  inPoint: number | null;
  outPoint: number | null;

  loadClip: (clip: Clip) => void;
  /** Replace the whole document with a loaded project. The undo stack is
   *  dropped rather than kept: undoing after a load would walk back into the
   *  previous document's edits. */
  openDoc: (doc: Doc, path?: string | null) => void;
  /** Record that the current document now matches what's on disk at `path`. */
  markSaved: (path: string) => void;
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

  setInPoint: () => void;
  setOutPoint: () => void;
  clearMarkers: () => void;
  cutRange: () => void;

  patchDoc: (patch: Partial<Doc>) => void;
  applyZoomStyle: (id: string) => void;

  undo: () => void;
  redo: () => void;
}

export const useStore = create<State>((set, get) => {
  /**
   * Every document mutation goes through here so history is recorded in one
   * place — an action that edited `doc` directly would silently become
   * un-undoable.
   *
   * `label` identifies the gesture for coalescing; return null to abort with
   * no history entry.
   */
  const commit = (label: string, next: (doc: Doc) => Doc | null) => {
    const s = get();
    const nd = next(s.doc);
    if (!nd || nd === s.doc) return;
    set({ doc: nd, hist: push(s.hist, s.doc, label), dirty: true });
  };

  /** After a history jump the selection or playhead may point at something
   *  that no longer exists in the restored document. */
  const reconcile = (doc: Doc) => {
    const s = get();
    const dur = docDuration(doc);
    return {
      playhead: Math.max(0, Math.min(dur, s.playhead)),
      selectedId: doc.blocks.some((b) => b.id === s.selectedId) ? s.selectedId : null,
      selectedSegmentId: doc.segments.some((x) => x.id === s.selectedSegmentId)
        ? s.selectedSegmentId
        : null,
      inPoint: s.inPoint == null ? null : Math.min(s.inPoint, dur),
      outPoint: s.outPoint == null ? null : Math.min(s.outPoint, dur),
    };
  };

  return {
    doc: emptyDoc(),
    dirty: false,
    projectPath: null,
    hist: emptyHistory(),
    playhead: 0,
    playing: false,
    selectedId: null,
    selectedSegmentId: null,
    inPoint: null,
    outPoint: null,

    loadClip: (clip) =>
      set((s) => ({
        // Match the output to the source so a 16:10 laptop capture isn't
        // pillarboxed into a 16:9 canvas by default.
        doc: {
          ...s.doc,
          clip,
          output: { width: clip.width, height: clip.height },
          segments: [{ id: uid(), srcStart: 0, srcEnd: clip.duration, speed: 1 }],
          crop: { top: 0, right: 0, bottom: 0, left: 0 },
          blocks: [],
        },
        // Importing starts a new piece of work; undoing back into the previous
        // recording's edits would be meaningless.
        hist: emptyHistory(),
        playhead: 0,
        playing: false,
        selectedId: null,
        selectedSegmentId: null,
        inPoint: null,
        outPoint: null,
      })),

    openDoc: (doc, path = null) =>
      set({
        doc,
        projectPath: path,
        // A loaded project inheriting the previous document's undo stack
        // would let you undo into the old project, so the history starts
        // fresh with the file as its base.
        hist: emptyHistory(),
        playhead: 0,
        playing: false,
        selectedId: null,
        selectedSegmentId: null,
        inPoint: null,
        outPoint: null,
        // The file it was just read from is the baseline; only edits after
        // this point make it dirty.
        dirty: false,
      }),

    markSaved: (path) => set({ projectPath: path, dirty: false }),

    setPlayhead: (t) =>
      set((s) => ({ playhead: Math.max(0, Math.min(docDuration(s.doc), t)) })),

    setPlaying: (p) => set({ playing: p }),
    select: (id) => set({ selectedId: id, selectedSegmentId: null }),
    selectSegment: (id) => set({ selectedSegmentId: id, selectedId: null }),

    addZoom: (at, target) => {
      const doc = get().doc;
      const span = freeSpan(doc, at);
      if (!span) return null;

      const d = doc.zoomDefaults;
      // Take the preferred length, but shrink to whatever room exists between
      // neighbouring blocks rather than refusing to place one.
      const end = Math.min(span.end, at + d.duration);
      const start = Math.max(span.start, Math.min(at, end - 0.6));
      const len = end - start;
      const ramp = Math.min(d.ramp, len / 2);

      const block: ZoomBlock = {
        id: uid(),
        kind: "zoom",
        start,
        end,
        rampIn: ramp,
        rampOut: ramp,
        scale: d.scale,
        target,
        ease: d.ease,
        bounce: d.bounce,
        // A clip with a cursor track almost always wants to follow it; that's
        // the reason for recording in the first place.
        followCursor: (doc.clip?.cursor?.length ?? 0) > 0,
        // Off by default: chaining changes what the *previous* block does, and
        // a new zoom shouldn't silently rewrite the shot before it.
        chain: false,
      };

      commit("addZoom", (d) => ({
        ...d,
        blocks: [...d.blocks, block].sort((a, b) => a.start - b.start),
      }));
      set({ selectedId: block.id, selectedSegmentId: null });
      return block.id;
    },

    updateBlock: (id, patch) =>
      commit(`updateBlock:${id}:${Object.keys(patch).join(",")}`, (d) => ({
        ...d,
        blocks: d.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
      })),

    moveBlock: (id, start, end) =>
      commit(`moveBlock:${id}`, (d) => {
        const dur = docDuration(d);
        const others = d.blocks.filter((b) => b.id !== id);

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
        if (e2 - s2 < 0.3) return null;

        return {
          ...d,
          blocks: d.blocks
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
        };
      }),

    removeBlock: (id) => {
      commit("removeBlock", (d) => ({
        ...d,
        blocks: d.blocks.filter((b) => b.id !== id),
      }));
      if (get().selectedId === id) set({ selectedId: null });
    },

    /** Cut the segment under the playhead in two. Total length is unchanged,
     *  so zoom blocks stay exactly where they were. */
    splitAt: (t) => {
      let newId: string | null = null;
      commit("splitAt", (d) => {
        const hit = sourceAt(d, t);
        if (!hit) return null;

        const { segment, index } = hit;
        const left: Segment = { ...segment, srcEnd: hit.srcTime };
        const right: Segment = { ...segment, id: uid(), srcStart: hit.srcTime };
        if (segmentLength(left) < MIN_SEGMENT || segmentLength(right) < MIN_SEGMENT) {
          return null;
        }

        const segments = [...d.segments];
        segments.splice(index, 1, left, right);
        newId = right.id;
        return { ...d, segments };
      });
      if (newId) set({ selectedSegmentId: newId, selectedId: null });
    },

    setInPoint: () =>
      set((s) => ({
        inPoint: s.playhead,
        // A range needs in < out; moving the start past the end throws the
        // end away rather than leaving an inverted range behind.
        outPoint: s.outPoint != null && s.outPoint <= s.playhead ? null : s.outPoint,
      })),

    setOutPoint: () =>
      set((s) => ({
        outPoint: s.playhead,
        inPoint: s.inPoint != null && s.inPoint >= s.playhead ? null : s.inPoint,
      })),

    clearMarkers: () => set({ inPoint: null, outPoint: null }),

    /**
     * Cut the marked range out of the timeline. Every moment inside the range
     * is removed, the tail slides left to close the gap, and anything aimed
     * at the removed time (zoom blocks) is trimmed or shifted to match.
     */
    cutRange: () => {
      const { inPoint, outPoint } = get();
      if (inPoint == null || outPoint == null || outPoint - inPoint < MIN_SEGMENT) {
        return;
      }

      const inT = inPoint;
      const outT = outPoint;
      const cutLen = outT - inT;

      commit("cutRange", (d) => {
        if (!d.clip || d.segments.length === 0) return null;

        // Rebuild the segment list without the covered source time. A segment
        // that spans the range is split into its kept halves; one fully inside
        // it disappears entirely. Both are pure bookkeeping on the source
        // range, so the file is never touched.
        const segments: Segment[] = [];
        let offset = 0;
        for (const seg of d.segments) {
          const len = segmentLength(seg);
          const start = offset;
          const end = offset + len;

          if (start < inT) {
            const cut = Math.min(len, inT - start);
            const left: Segment = { ...seg, srcEnd: seg.srcStart + cut * seg.speed };
            if (segmentLength(left) >= MIN_SEGMENT) segments.push(left);
          }
          if (end > outT) {
            const cut = Math.max(0, outT - start);
            const right: Segment = { ...seg, id: uid(), srcStart: seg.srcStart + cut * seg.speed };
            if (segmentLength(right) >= MIN_SEGMENT) segments.push(right);
          }
          offset += len;
        }

        if (segments.length === 0) return null;
        // A range that covers no segments is a no-op; don't record history for
        // something that changed nothing.
        const same =
          segments.length === d.segments.length &&
          segments.every((x, i) => x.id === d.segments[i].id);
        if (same) return null;

        // Zoom blocks live in timeline time, so the cut moves them. Fully
        // before: untouched. Fully after: shift left by the cut. Inside: gone.
        // Straddling either edge: clamp the offending edge to the cut so the
        // block keeps covering content it still exists for.
        const blocks = d.blocks
          .map((b): Block | null => {
            if (b.end <= inT) return b;
            if (b.start >= outT) {
              return { ...b, start: b.start - cutLen, end: b.end - cutLen };
            }
            const s2 = b.start <= inT ? b.start : inT;
            const e2 = b.end >= outT ? b.end - cutLen : inT;
            return { ...b, start: s2, end: e2 };
          })
          .filter((b): b is Block => !!b && b.end - b.start >= 0.3)
          .sort((a, b) => a.start - b.start);

        return { ...d, segments, blocks };
      });

      set({ ...reconcile(get().doc), inPoint: null, outPoint: null });
    },

    trimSegment: (id, srcStart, srcEnd) =>
      commit(`trimSegment:${id}`, (d) => {
        const index = d.segments.findIndex((x) => x.id === id);
        if (index < 0 || !d.clip) return null;
        const seg = d.segments[index];

        const lo = Math.max(0, Math.min(srcStart, srcEnd - MIN_SEGMENT * seg.speed));
        const hi = Math.min(
          d.clip.duration,
          Math.max(srcEnd, lo + MIN_SEGMENT * seg.speed),
        );

        const next: Segment = { ...seg, srcStart: lo, srcEnd: hi };
        const delta = segmentLength(next) - segmentLength(seg);
        const after = segmentOffset(d, index) + segmentLength(seg);

        const segments = [...d.segments];
        segments[index] = next;
        return { ...d, segments, blocks: shiftBlocks(d.blocks, after, delta) };
      }),

    setSegmentSpeed: (id, speed) =>
      commit(`setSegmentSpeed:${id}`, (d) => {
        const index = d.segments.findIndex((x) => x.id === id);
        if (index < 0) return null;
        const seg = d.segments[index];
        const next: Segment = { ...seg, speed: Math.max(0.25, Math.min(8, speed)) };

        const delta = segmentLength(next) - segmentLength(seg);
        const after = segmentOffset(d, index) + segmentLength(seg);

        const segments = [...d.segments];
        segments[index] = next;
        return { ...d, segments, blocks: shiftBlocks(d.blocks, after, delta) };
      }),

    removeSegment: (id) => {
      commit("removeSegment", (d) => {
        if (d.segments.length <= 1) return null; // never leave an empty timeline
        const index = d.segments.findIndex((x) => x.id === id);
        if (index < 0) return null;

        const seg = d.segments[index];
        const at = segmentOffset(d, index);
        const len = segmentLength(seg);

        return {
          ...d,
          segments: d.segments.filter((x) => x.id !== id),
          blocks: shiftBlocks(
            d.blocks.filter((b) => b.end <= at || b.start >= at + len),
            at + len,
            -len,
          ),
        };
      });
      set(reconcile(get().doc));
    },

    patchDoc: (patch) =>
      commit(`patchDoc:${Object.keys(patch).join(",")}`, (d) => ({ ...d, ...patch })),

    /** Push one block's motion onto every other block, and onto the defaults.
     *  Tuning a move until it feels right and then repeating that by hand for
     *  every other zoom is the tedious part of this job. */
    applyZoomStyle: (id) =>
      commit("applyZoomStyle", (d) => {
        const src = d.blocks.find((b) => b.id === id);
        if (!src) return null;

        return {
          ...d,
          zoomDefaults: {
            scale: src.scale,
            duration: src.end - src.start,
            ramp: src.rampIn,
            ease: src.ease,
            bounce: src.bounce,
          },
          blocks: d.blocks.map((b) => {
            if (b.id === id) return b;
            // Ramps are clamped per block: a short block can't take a long
            // ramp without the two overlapping.
            const half = (b.end - b.start) / 2;
            return {
              ...b,
              scale: src.scale,
              ease: src.ease,
              bounce: src.bounce,
              rampIn: Math.min(src.rampIn, half),
              rampOut: Math.min(src.rampOut, half),
            };
          }),
        };
      }),

    undo: () => {
      const s = get();
      const previous = s.hist.past.at(-1);
      if (!previous) return;
      set({
        doc: previous,
        hist: {
          past: s.hist.past.slice(0, -1),
          future: [s.doc, ...s.hist.future],
          lastLabel: null,
          lastAt: 0,
        },
        playing: false,
        ...reconcile(previous),
      });
    },

    redo: () => {
      const s = get();
      const next = s.hist.future[0];
      if (!next) return;
      set({
        doc: next,
        hist: {
          past: [...s.hist.past, s.doc],
          future: s.hist.future.slice(1),
          lastLabel: null,
          lastAt: 0,
        },
        playing: false,
        ...reconcile(next),
      });
    },
  };
});
