import type { EaseName } from "../doc/types";

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * A damped spring sampled as a closed-form curve. Real springs need a
 * simulation, but camera moves are short and always run 0..1, so an analytic
 * approximation is stable, seekable, and frame-rate independent — which a
 * simulation would not be during scrubbing or export.
 *
 * `bounce` runs 0 (settles straight onto the target) to 1 (visibly springy).
 * Lower frequency and heavier damping at the bottom of the range keep a
 * zero-bounce move from looking mechanical.
 */
function spring(t: number, bounce: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const b = clamp01(bounce);
  const freq = 3.2 + b * 5.0;
  const decay = 9.5 - b * 4.0;
  return 1 - Math.exp(-decay * t) * Math.cos(freq * t);
}

const fns: Record<EaseName, (t: number, bounce: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  spring,
};

export function ease(name: EaseName, t: number, bounce = 0.35): number {
  return fns[name](clamp01(t), bounce);
}

export const EASE_NAMES: EaseName[] = [
  "spring",
  "easeInOut",
  "easeOut",
  "easeIn",
  "linear",
];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
