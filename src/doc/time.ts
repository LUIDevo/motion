import type { Doc, Segment } from "./types";

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
