import type { Doc, Point, Segment } from "./types";

/** How long a segment occupies on the timeline, after its speed is applied. */
export const segmentLength = (s: Segment) =>
  Math.max(0, (s.srcEnd - s.srcStart) / Math.max(0.05, s.speed));

/** Total timeline length: the segments, not the source file. */
export function docDuration(doc: Doc): number {
  if (!doc.clip) return 0;
  if (doc.segments.length === 0) return 0;
  return doc.segments.reduce((acc, s) => acc + segmentLength(s), 0);
}

export interface SourceHit {
  /** Time to seek the source video to. */
  srcTime: number;
  segment: Segment;
  index: number;
  /** Where this segment starts on the timeline. */
  offset: number;
}

/**
 * Map a timeline time onto the source video.
 *
 * Everything downstream — preview, scrubbing, export — goes through this, so
 * cuts and speed changes are applied in exactly one place and can't disagree
 * between what you preview and what you render.
 */
export function sourceAt(doc: Doc, t: number): SourceHit | null {
  let offset = 0;
  for (let i = 0; i < doc.segments.length; i++) {
    const seg = doc.segments[i];
    const len = segmentLength(seg);
    if (t < offset + len || i === doc.segments.length - 1) {
      const local = Math.max(0, Math.min(len, t - offset));
      return {
        srcTime: seg.srcStart + local * seg.speed,
        segment: seg,
        index: i,
        offset,
      };
    }
    offset += len;
  }
  return null;
}

/** Timeline position where a given segment begins. */
export function segmentOffset(doc: Doc, index: number): number {
  let offset = 0;
  for (let i = 0; i < index && i < doc.segments.length; i++) {
    offset += segmentLength(doc.segments[i]);
  }
  return offset;
}

/** Normalise a point in the full source frame into the kept (cropped) region.
 *  Used wherever source-space points meet frame-space math — the cursor
 *  overlay, follow-cursor camera, anywhere else that needs the two to agree. */
export function srcToFramePoint(doc: Doc, p: Point): Point {
  const c = doc.crop;
  const w = Math.max(1e-6, 1 - c.left - c.right);
  const h = Math.max(1e-6, 1 - c.top - c.bottom);
  return {
    x: Math.max(0, Math.min(1, (p.x - c.left) / w)),
    y: Math.max(0, Math.min(1, (p.y - c.top) / h)),
  };
}
