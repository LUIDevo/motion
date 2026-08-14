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
   * How much the spring overshoots before settling, 0 to 1. Only affects the
   * `spring` easing. A little overshoot reads as physical; a lot reads as
   * cartoonish.
   */
  bounce: number;
  /**
   * When true the target is driven by the cursor track instead of `target`.
   * Nothing produces a cursor track yet (imports have no cursor metadata), so
   * this is inert until the recorder lands — but blocks written today stay
   * valid once it does.
   */
  followCursor: boolean;
  /**
   * Hand straight over to the next block instead of releasing to rest.
   *
   * A demo that zooms into one part of a UI and then another shouldn't pull
   * all the way out in between — that reads as losing your place. With this
   * set, this block drops its ramp-out, the next drops its ramp-in, and the
   * gap between them on the timeline becomes the move from one to the other.
   *
   * Inert on the last block: with nothing to hand to, it ramps out as usual.
   */
  chain: boolean;
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
 * How much of the source to crop away from each edge, normalised 0..1 of the
 * source frame. The kept region is scaled to fill the frame, so cropping is
 * non-destructive and fully reversible — nothing touches the file, exactly
 * like cutting the timeline.
 */
export interface Crop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

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

/** One cursor position recorded alongside a capture. `t` is seconds into the
 *  *source* recording, and x/y are in source pixels. */
export interface CursorSample {
  t: number;
  x: number;
  y: number;
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
  /** Cursor track, when this clip came from our own recorder. Imported files
   *  have none — nothing in a finished video says where the pointer was. */
  cursor: CursorSample[] | null;
  duration: number;
  width: number;
  height: number;
}

/**
 * The cursor overlay.
 *
 * The capture embeds the real pointer in the frames (see recorder.rs — the
 * Hyprland portal won't hand back cursor metadata, so the alternative was no
 * pointer at all). Everything here therefore draws *under* that pointer:
 * a glow that says where to look, and a streak that says where it came from.
 * Drawing a synthetic pointer as well would show two cursors.
 */
export interface CursorStyle {
  enabled: boolean;
  /** Radius of the soft disc under the pointer, as a fraction of the framed
   *  recording's height. */
  highlightSize: number;
  /** Opacity of that disc, 0..1. 0 turns it off without losing the size. */
  highlightOpacity: number;
  /** Tint for both the glow and the trail. */
  color: string;
  /** How many seconds of movement the trail covers. 0 turns it off. */
  trail: number;
  /** Trail thickness at the pointer end, as a fraction of the framed
   *  recording's height. It tapers to nothing at the tail. */
  trailWidth: number;
  /** Opacity of the trail at the pointer end, 0..1. */
  trailOpacity: number;
}

/**
 * What a newly placed zoom starts out as.
 *
 * Kept on the document rather than hard-coded, because the right pace is a
 * matter of taste and per-project consistency — every zoom in one demo wanting
 * the same feel is the normal case, not the exception.
 */
export interface ZoomDefaults {
  scale: number;
  /** Total length of the move, including both ramps. */
  duration: number;
  /** Ramp in/out length. The camera spends this long accelerating. */
  ramp: number;
  ease: EaseName;
  bounce: number;
}

export interface Doc {
  version: 1;
  output: { width: number; height: number };
  clip: Clip | null;
  /** Ordered cuts of the source. Empty until a recording is imported. */
  segments: Segment[];
  /** Edges cropped off the source. The kept region fills the frame. */
  crop: Crop;
  background: Background;
  frame: FrameStyle;
  blocks: Block[];
  zoomDefaults: ZoomDefaults;
  /** How the recorded pointer is decorated. Inert without a cursor track. */
  cursorStyle: CursorStyle;
  /**
   * Half-width of the cursor smoothing window, in seconds. Larger values make
   * a follow-cursor camera calmer and less literal; smaller values track the
   * pointer more exactly, jitter included.
   */
  cursorSmoothing: number;
}
