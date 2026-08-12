import type { Block, Doc, Point } from "../doc/types";
import { sourceAt } from "../doc/time";
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
 * Returns null when `t` is outside the block entirely.
 */
export function blockProgress(block: Block, t: number): number | null {
  if (t < block.start || t > block.end) return null;

  const inEnd = block.start + block.rampIn;
  const outStart = block.end - block.rampOut;

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
    return block.rampIn <= 0 ? 1 : ease(block.ease, (t - block.start) / block.rampIn, block.bounce);
  }
  if (t > outStart) {
    return block.rampOut <= 0 ? 1 : ease(block.ease, (block.end - t) / block.rampOut, block.bounce);
  }
  return 1;
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
  // rather than snapping the camera somewhere arbitrary.
  return cursorAt(doc.clip, hit.srcTime, doc.cursorSmoothing) ?? block.target;
}

/** Solve the camera for a given time. Pure — same input, same frame, always. */
export function cameraAt(doc: Doc, t: number): Camera {
  const block = blockAt(doc, t);
  if (!block) return REST;

  const u = blockProgress(block, t);
  if (u === null) return REST;

  const target = targetOf(doc, block, t);

  return {
    scale: lerp(1, block.scale, u),
    center: {
      x: lerp(REST.center.x, target.x, u),
      y: lerp(REST.center.y, target.y, u),
    },
  };
}
