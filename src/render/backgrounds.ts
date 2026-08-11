import type { Background } from "../doc/types";

export interface Preset {
  name: string;
  bg: Background;
}

/**
 * Backdrops that read well behind a light UI recording. Deliberately low
 * contrast and desaturated — the recording is the subject, and a loud
 * background makes a demo look like a template.
 */
export const PRESETS: Preset[] = [
  { name: "Paper", bg: { kind: "linear", from: "#EDEDED", to: "#DCDCDC", angle: 120 } },
  { name: "Fog", bg: { kind: "radial", from: "#FFFFFF", to: "#D9DDE3" } },
  { name: "Slate", bg: { kind: "linear", from: "#2B2F36", to: "#14171C", angle: 120 } },
  { name: "Ink", bg: { kind: "radial", from: "#26303F", to: "#0B0E13" } },
  { name: "Azure", bg: { kind: "linear", from: "#DCE7FF", to: "#AFC5F5", angle: 135 } },
  { name: "Cobalt", bg: { kind: "linear", from: "#3B62E8", to: "#1B2C86", angle: 135 } },
  { name: "Peach", bg: { kind: "linear", from: "#FFE3D3", to: "#F7BFA5", angle: 135 } },
  { name: "Ember", bg: { kind: "linear", from: "#F2764B", to: "#B3341F", angle: 135 } },
  { name: "Mint", bg: { kind: "linear", from: "#DFF3E7", to: "#A9D9C0", angle: 135 } },
  { name: "Moss", bg: { kind: "radial", from: "#3E6B54", to: "#16261D" } },
  { name: "Lilac", bg: { kind: "linear", from: "#EBE3FB", to: "#C3AFEC", angle: 135 } },
  { name: "Plum", bg: { kind: "linear", from: "#6F4BC4", to: "#2E1B57", angle: 135 } },
  { name: "Sand", bg: { kind: "solid", color: "#E8E1D5" } },
  { name: "Bone", bg: { kind: "solid", color: "#F4F4F4" } },
  { name: "Carbon", bg: { kind: "solid", color: "#101215" } },
  { name: "Dusk", bg: { kind: "linear", from: "#F7C9C0", to: "#5B6BA8", angle: 160 } },
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
