import type { Doc } from "./types";

export interface History {
  past: Doc[];
  future: Doc[];
  /** What kind of edit produced the current state, for coalescing. */
  lastLabel: string | null;
  lastAt: number;
}

export const emptyHistory = (): History => ({
  past: [],
  future: [],
  lastLabel: null,
  lastAt: 0,
});

/** Dragging a slider fires a change per frame. Without coalescing, one drag
 *  would bury every earlier state under a hundred undo steps. */
const COALESCE_MS = 600;

/** Bound on stored states — each is a whole doc, and old ones stop being
 *  useful long before memory becomes a concern. */
const LIMIT = 100;

/**
 * Fold a new document into the history.
 *
 * Consecutive edits carrying the same label within the coalesce window are
 * treated as one gesture, so a slider drag or a block drag undoes in a single
 * step rather than frame by frame.
 */
export function push(hist: History, previous: Doc, label: string): History {
  const now = performance.now();
  const sameGesture =
    hist.lastLabel === label && now - hist.lastAt < COALESCE_MS;

  return {
    past: sameGesture ? hist.past : [...hist.past, previous].slice(-LIMIT),
    future: [],
    lastLabel: label,
    lastAt: now,
  };
}
