import { create } from "zustand";
import type { Block, Clip, Doc, ZoomBlock } from "./types";

export const emptyDoc = (): Doc => ({
  version: 1,
  output: { width: 1920, height: 1080 },
  clip: null,
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

/** Timeline length. Zero until something is imported. */
export const docDuration = (doc: Doc) => doc.clip?.duration ?? 0;

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

  loadClip: (clip: Clip) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (id: string | null) => void;

  addZoom: (at: number, target: { x: number; y: number }) => string | null;
  updateBlock: (id: string, patch: Partial<ZoomBlock>) => void;
  moveBlock: (id: string, start: number, end: number) => void;
  removeBlock: (id: string) => void;

  patchDoc: (patch: Partial<Doc>) => void;
}

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  playhead: 0,
  playing: false,
  selectedId: null,

  loadClip: (clip) =>
    set((s) => ({
      // Match the output to the source so a 16:10 laptop capture isn't
      // pillarboxed into a 16:9 canvas by default.
      doc: {
        ...s.doc,
        clip,
        output: { width: clip.width, height: clip.height },
        blocks: [],
      },
      playhead: 0,
      playing: false,
      selectedId: null,
    })),

  setPlayhead: (t) =>
    set((s) => ({ playhead: Math.max(0, Math.min(docDuration(s.doc), t)) })),

  setPlaying: (p) => set({ playing: p }),
  select: (id) => set({ selectedId: id }),

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

  patchDoc: (patch) => set((s) => ({ doc: { ...s.doc, ...patch } })),
}));
