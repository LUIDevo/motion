import type { Background } from "../doc/types";

export interface Preset {
  name: string;
  bg: Background;
}

/**
 * Backdrops for product demos.
 *
 * The rule throughout: low saturation, low internal contrast. A backdrop's
 * whole job is to sit behind a recording of a UI without competing with it,
 * and a saturated gradient does the opposite — it dates the video, fights the
 * app's own colours, and pulls the eye away from the thing being demonstrated.
 *
 * Ordered light to dark, neutrals first, so the palette reads as a considered
 * set rather than a swatch dump.
 */
export const PRESETS: Preset[] = [
  // Neutrals — the safe default for almost any recording.
  { name: "Paper", bg: { kind: "linear", from: "#F2F2F0", to: "#E2E2DF", angle: 120 } },
  { name: "Fog", bg: { kind: "radial", from: "#FFFFFF", to: "#DFE2E6" } },
  { name: "Alabaster", bg: { kind: "linear", from: "#F6F4F0", to: "#E6E1D9", angle: 135 } },
  { name: "Ash", bg: { kind: "linear", from: "#E4E5E7", to: "#CFD1D4", angle: 120 } },

  // Cool tints — pair well with the blues most product UIs already use.
  { name: "Mist", bg: { kind: "linear", from: "#EEF2F6", to: "#D8E1EA", angle: 135 } },
  { name: "Porcelain", bg: { kind: "radial", from: "#F7FAFC", to: "#DCE4EC" } },
  { name: "Steel", bg: { kind: "linear", from: "#D6DEE6", to: "#B9C4CF", angle: 135 } },
  { name: "Denim", bg: { kind: "linear", from: "#C3D0E0", to: "#94A8C0", angle: 140 } },

  // Warm tints — for recordings that are mostly white UI.
  { name: "Linen", bg: { kind: "linear", from: "#F4EFE8", to: "#E3D9CC", angle: 135 } },
  { name: "Sand", bg: { kind: "linear", from: "#EDE4D8", to: "#D6C7B4", angle: 140 } },
  { name: "Sage", bg: { kind: "linear", from: "#E4EAE3", to: "#C6D2C6", angle: 135 } },
  { name: "Blush", bg: { kind: "linear", from: "#F2E9E7", to: "#DCC9C6", angle: 140 } },

  // Darks — make a light UI pop, and read well on dark social feeds.
  { name: "Slate", bg: { kind: "linear", from: "#3A424D", to: "#232A33", angle: 135 } },
  { name: "Graphite", bg: { kind: "radial", from: "#33383F", to: "#17191D" } },
  { name: "Navy", bg: { kind: "linear", from: "#28344A", to: "#161D2B", angle: 135 } },
  { name: "Espresso", bg: { kind: "linear", from: "#3B342E", to: "#211D19", angle: 135 } },
];

/** CSS equivalent of a background, for rendering swatches in the UI. */
export function backgroundCss(bg: Background): string {
  switch (bg.kind) {
    case "solid":
      return bg.color;
    case "radial":
      return `radial-gradient(circle at 50% 50%, ${bg.from}, ${bg.to})`;
    case "linear":
      // CSS gradient angles run clockwise from "to top"; the canvas ones run
      // counter-clockwise from "to right". Convert so swatches match output.
      return `linear-gradient(${bg.angle + 90}deg, ${bg.from}, ${bg.to})`;
  }
}

export function sameBackground(a: Background, b: Background): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
