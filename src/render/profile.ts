/**
 * Frame profiling for the preview.
 *
 * Off unless the diagnostics overlay is open, and when off every call here is
 * a boolean test — cheap enough to leave in the hot path rather than keeping a
 * second, instrumented copy of the renderer that could drift from the real one.
 *
 * A warning about what these numbers mean. Canvas work is not necessarily
 * finished when the call returns: `drawImage` can queue work for the
 * compositor, so JS time under-reports the true cost. That's why `interval` is
 * measured too. Read them together:
 *
 *   high js, interval tracks js   -> our drawing is the bottleneck
 *   low js, interval much higher  -> paint/compositing is, and shaving JS
 *                                    won't help
 */

const PHASES = ["background", "shadow", "video", "cursor"] as const;
export type Phase = (typeof PHASES)[number];

export interface FrameStats {
  /** Frames the averages below are drawn from. */
  samples: number;
  /** Mean wall time between rendered frames, ms. 16.7 = a solid 60fps. */
  interval: number;
  /** Worst interval in the window — where a stutter would show up. */
  worst: number;
  /** Mean time inside renderFrame, ms. */
  js: number;
  /** Mean time per phase, ms. */
  phases: Record<Phase, number>;
}

const WINDOW = 30;

let on = false;
let frames = 0;
let sumInterval = 0;
let worstInterval = 0;
let sumJs = 0;
const sums: Record<Phase, number> = { background: 0, shadow: 0, video: 0, cursor: 0 };
let latest: FrameStats | null = null;

function reset() {
  frames = 0;
  sumInterval = 0;
  worstInterval = 0;
  sumJs = 0;
  for (const p of PHASES) sums[p] = 0;
}

export function setProfiling(v: boolean) {
  if (v === on) return;
  on = v;
  reset();
  latest = null;
}

export function profiling(): boolean {
  return on;
}

/** Start a phase. Returns 0 when profiling is off, so `add` becomes a no-op. */
export function mark(): number {
  return on ? performance.now() : 0;
}

export function add(phase: Phase, since: number) {
  if (on) sums[phase] += performance.now() - since;
}

/** Close out one rendered frame. `interval` is the gap since the previous. */
export function endFrame(jsMs: number, interval: number) {
  if (!on) return;

  frames++;
  sumJs += jsMs;
  sumInterval += interval;
  if (interval > worstInterval) worstInterval = interval;

  if (frames >= WINDOW) {
    const phases = {} as Record<Phase, number>;
    for (const p of PHASES) phases[p] = sums[p] / frames;
    latest = {
      samples: frames,
      interval: sumInterval / frames,
      worst: worstInterval,
      js: sumJs / frames,
      phases,
    };
    reset();
  }
}

/** Most recent completed window, or null before the first one closes. */
export function snapshot(): FrameStats | null {
  return latest;
}
