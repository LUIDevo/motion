/**
 * The project document. This is the single source of truth: the renderer is a
 * pure function of (doc, time), so preview and export can never disagree.
 *
 * Everything is plain JSON — no class instances, no functions — so projects are
 * serialisable, diffable, and undo/redo is just keeping old copies around.
 */

export type EaseName =
  | "linear"
  | "easeInOut"
  | "easeOut"
  | "easeIn"
  | "spring";

/** A point in *video* space, normalised 0..1 from the top-left of the frame. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A camera move. Blocks live on the zoom track and must not overlap; at any
 * given time at most one is active, which keeps the camera solve trivial.
 *
 * Timing: `start`/`end` bracket the whole move including its ramps, so a block
 * with rampIn 0.6, rampOut 0.6 and duration 2.0 holds at full scale for 0.8s.
 */
export interface ZoomBlock {
  id: string;
  kind: "zoom";
  start: number;
  end: number;
  rampIn: number;
  rampOut: number;
  /** Camera scale at full hold. 1 = no zoom. */
  scale: number;
  /** Point the camera centres on, in video space. */
  target: Point;
  ease: EaseName;
  /**
   * When true the target is driven by the cursor track instead of `target`.
   * Nothing produces a cursor track yet (imports have no cursor metadata), so
   * this is inert until the recorder lands — but blocks written today stay
   * valid once it does.
   */
  followCursor: boolean;
}

export type Block = ZoomBlock;

/** How the recording is framed inside the output: the look from the mockups. */
export interface FrameStyle {
  /** Padding between the output edge and the recording, as a fraction of the
   *  output's smaller dimension. */
  padding: number;
  radius: number;
  shadowBlur: number;
  shadowOpacity: number;
  shadowY: number;
}

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "linear"; from: string; to: string; angle: number };

export interface Clip {
  /** Source URL the <video> element loads (asset:// under Tauri, blob: in the
   *  browser fallback). Not persisted — resolved from `path` on open. */
  src: string;
  /** Absolute path on disk, when we have one. */
  path: string | null;
  name: string;
  duration: number;
  width: number;
  height: number;
}

export interface Doc {
  version: 1;
  output: { width: number; height: number };
  clip: Clip | null;
  background: Background;
  frame: FrameStyle;
  blocks: Block[];
}
