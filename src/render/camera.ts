import type { Block, Doc, Point } from "../doc/types";
import { sourceAt, srcToFramePoint } from "../doc/time";
import { cursorAt } from "./cursor";
import { ease, lerp } from "./easing";

export interface Camera {
  /** Scale applied to the framed recording. 1 = resting. */
  scale: number;
  /** Point the camera is centred on, in video space (0..1). */
  center: Point;
}

export const REST: Camera = { scale: 1, center: { x: 0.5, y: 0.5 } };

/**
 * How far into a block's move we are at time `t`, 0 at rest and 1 at full hold.
 *
 * `rampIn`/`rampOut` are passed rather than read off the block so a chained
 * block can suppress the ramp that a neighbour has taken responsibility for —
 * see `cameraAt`.
 */
function progress(block: Block, t: number, rampIn: number, rampOut: number): number {
  const inEnd = block.start + rampIn;
  const outStart = block.end - rampOut;

  // Ramps can overlap on a very short block; meeting in the middle keeps the
  // move continuous instead of snapping between the two branches.
  if (inEnd > outStart) {
    const mid = (block.start + block.end) / 2;
    const half = mid - block.start;
    if (half <= 0) return 1;
    const u = t <= mid ? (t - block.start) / half : (block.end - t) / half;
    return ease(block.ease, u, block.bounce);
  }

  if (t < inEnd) {
    return rampIn <= 0 ? 1 : ease(block.ease, (t - block.start) / rampIn, block.bounce);
  }
  if (t > outStart) {
    return rampOut <= 0 ? 1 : ease(block.ease, (block.end - t) / rampOut, block.bounce);
  }
  return 1;
}

/**
 * How far into a block's move we are at time `t`, 0 at rest and 1 at full hold.
 * Returns null when `t` is outside the block entirely.
 */
export function blockProgress(block: Block, t: number): number | null {
  if (t < block.start || t > block.end) return null;
  return progress(block, t, block.rampIn, block.rampOut);
}

export function blockAt(doc: Doc, t: number): Block | null {
  for (const b of doc.blocks) {
    if (t >= b.start && t <= b.end) return b;
  }
  return null;
}

/**
 * Where a block is aiming at time `t`.
 *
 * A follow-cursor block has no fixed target: it reads the cursor track at the
 * matching moment. The lookup is done in *source* time, not timeline time, so
 * the camera stays locked to the pointer even after the clip has been trimmed,
 * split, or sped up.
 */
function targetOf(doc: Doc, block: Block, t: number): Point {
  if (!block.followCursor) return block.target;

  const hit = sourceAt(doc, t);
  if (!hit) return block.target;

  // Falls back to the fixed target when the track doesn't cover this moment,
  // rather than snapping the camera somewhere arbitrary. The cursor position
  // lives in full-source space, so a crop re-bases it into the kept region —
  // the camera centres on what's actually on screen.
  const p = cursorAt(doc.clip, hit.srcTime, doc.cursorSmoothing);
  if (!p) return block.target;
  return srcToFramePoint(doc, p);
}

/**
 * The camera while a block is at full hold, evaluated at `t`.
 *
 * Time matters even though a held block isn't moving: a follow-cursor block's
 * aim keeps changing under it. Evaluating both ends of a chain at the current
 * moment is what lets a handoff between two follow blocks stay continuous
 * instead of snapping to wherever the pointer happened to be at the boundary.
 */
function holdOf(doc: Doc, block: Block, t: number): Camera {
  return { scale: block.scale, center: targetOf(doc, block, t) };
}

function lerpCamera(a: Camera, b: Camera, u: number): Camera {
  return {
    scale: lerp(a.scale, b.scale, u),
    center: {
      x: lerp(a.center.x, b.center.x, u),
      y: lerp(a.center.y, b.center.y, u),
    },
  };
}

/**
 * Solve the camera for a given time. Pure — same input, same frame, always.
 *
 * Blocks are sorted and never overlap, so at most one is active. A block whose
 * `chain` is set hands straight over to the next one instead of releasing to
 * rest: it drops its ramp-out, the next drops its ramp-in, and the gap between
 * them becomes the move. That makes the transition's length something you drag
 * on the timeline, and a zero-length gap an honest cut.
 */
export function cameraAt(doc: Doc, t: number): Camera {
  const blocks = doc.blocks;
  const i = blocks.findIndex((b) => t >= b.start && t <= b.end);

  if (i >= 0) {
    const block = blocks[i];
    const prev = blocks[i - 1];
    const next = blocks[i + 1];

    // Whichever neighbour owns the transition has already delivered the camera
    // here (or will collect it), so the corresponding ramp is skipped.
    const chainedIn = !!prev && prev.chain;
    const chainedOut = !!next && block.chain;

    const u = progress(
      block,
      t,
      chainedIn ? 0 : block.rampIn,
      chainedOut ? 0 : block.rampOut,
    );
    return lerpCamera(REST, holdOf(doc, block, t), u);
  }

  // Between two chained blocks: the gap is the move.
  const from = blocks.filter((b) => b.end < t).pop();
  if (from?.chain) {
    const next = blocks.find((b) => b.start > t);
    if (next) {
      const span = next.start - from.end;
      const u = span <= 0 ? 1 : ease(from.ease, (t - from.end) / span, from.bounce);
      return lerpCamera(holdOf(doc, from, t), holdOf(doc, next, t), u);
    }
  }

  return REST;
}
