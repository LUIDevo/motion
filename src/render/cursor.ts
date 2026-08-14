import type { Clip, CursorSample, Point } from "../doc/types";

/**
 * Half-width of the smoothing window, in seconds.
 *
 * A real pointer is jittery — small corrections, overshoot, hand tremor. A
 * camera that tracks it faithfully looks nervous and is unpleasant to watch.
 * Averaging over a window either side of the current moment produces the
 * unhurried move a person would have animated by hand. Because the window
 * looks forward as well as back, the camera leads into a move slightly rather
 * than lagging behind it.
 */
const DEFAULT_SMOOTHING = 0.22;

/** Index of the last sample at or before `t`, or -1. Samples are recorded in
 *  order, so a binary search is safe and keeps per-frame cost flat. */
function lastIndexBefore(samples: CursorSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Smoothed cursor position at a source time, normalised into video space.
 *
 * Returns null when the clip has no cursor track or the time falls outside it,
 * so callers can fall back to a fixed target rather than snapping to a corner.
 */
export function cursorAt(
  clip: Clip | null,
  srcTime: number,
  smoothing = DEFAULT_SMOOTHING,
): Point | null {
  const samples = clip?.cursor;
  if (!clip || !samples || samples.length === 0) return null;
  if (clip.width <= 0 || clip.height <= 0) return null;

  const centre = lastIndexBefore(samples, srcTime);
  if (centre < 0) return null;

  // Walk outwards from the current moment while inside the window. The track
  // is evenly sampled, so a plain mean is as good as a weighted one here and
  // costs less.
  let sx = 0;
  let sy = 0;
  let n = 0;

  for (let i = centre; i >= 0; i--) {
    if (srcTime - samples[i].t > smoothing) break;
    sx += samples[i].x;
    sy += samples[i].y;
    n++;
  }
  for (let i = centre + 1; i < samples.length; i++) {
    if (samples[i].t - srcTime > smoothing) break;
    sx += samples[i].x;
    sy += samples[i].y;
    n++;
  }

  if (n === 0) return null;

  return {
    x: Math.max(0, Math.min(1, sx / n / clip.width)),
    y: Math.max(0, Math.min(1, sy / n / clip.height)),
  };
}

/**
 * Where the pointer has been over the last `span` seconds, oldest first.
 *
 * Resampled at a fixed count rather than returning the raw samples: the
 * recorder's rate is not something the renderer should inherit, and a constant
 * number of points keeps the trail's cost flat and its taper even. Each point
 * goes through the same smoothing as the live position, so the trail sits on
 * the path the camera actually followed rather than beside it.
 */
export function cursorTrail(
  clip: Clip | null,
  srcTime: number,
  smoothing: number,
  span: number,
  steps = 16,
): Point[] {
  if (span <= 0 || steps < 2) return [];

  const out: Point[] = [];
  for (let i = steps - 1; i >= 0; i--) {
    const t = srcTime - (span * i) / (steps - 1);
    if (t < 0) continue;
    const p = cursorAt(clip, t, smoothing);
    if (p) out.push(p);
  }
  return out;
}
