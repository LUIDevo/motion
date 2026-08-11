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
  | { kind: "linear"; from: string; to: string; angle: number }
  | { kind: "radial"; from: string; to: string };

/**
 * One piece of the source video on the timeline.
 *
 * Cutting never touches the file: a split just becomes two segments over the
 * same source, so trims stay non-destructive and fully reversible.
 *
 * `srcStart`/`srcEnd` are times in the source. Timeline length is
 * (srcEnd - srcStart) / speed, so speeding a segment up shortens the timeline.
 */
export interface Segment {
  id: string;
  srcStart: number;
  srcEnd: number;
  speed: number;
}

export interface Clip {
  /** Source URL the <video> element loads (asset:// under Tauri, blob: in the
   *  browser fallback). Not persisted — resolved from `path` on open. */
  src: string;
  /** Absolute path of the original file on disk, when we have one. */
  path: string | null;
  name: string;
  /** True when `src` points at a transcoded proxy rather than the original,
   *  because the webview couldn't decode the source codec. */
  proxied: boolean;
  duration: number;
  width: number;
  height: number;
}

export interface Doc {
  version: 1;
  output: { width: number; height: number };
  clip: Clip | null;
  /** Ordered cuts of the source. Empty until a recording is imported. */
  segments: Segment[];
  background: Background;
  frame: FrameStyle;
  blocks: Block[];
}
