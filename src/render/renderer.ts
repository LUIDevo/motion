import type { Background, Doc, Point } from "../doc/types";
import { sourceAt, srcToFramePoint } from "../doc/time";
import { cameraAt, REST, type Camera } from "./camera";
import { cursorAt, cursorTrail } from "./cursor";
import { add, mark } from "./profile";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The kept region of the source after cropping, in source pixels.
 *
 * Crop values are fractions of the full source frame; clamping keeps a
 * user who over-drags the numbers from producing a negative or zero region.
 * The kept region is what gets scaled into the frame rect, so crop reads as
 * "zoom into this part of the source" — edges are cut off, nothing distorts.
 */
export function sourceRect(doc: Doc): { sx: number; sy: number; sw: number; sh: number } {
  const clip = doc.clip;
  if (!clip) return { sx: 0, sy: 0, sw: 1, sh: 1 };

  const left = Math.min(0.85, Math.max(0, doc.crop.left));
  const right = Math.min(0.85, Math.max(0, doc.crop.right));
  const top = Math.min(0.85, Math.max(0, doc.crop.top));
  const bottom = Math.min(0.85, Math.max(0, doc.crop.bottom));

  const sx = left * clip.width;
  const sy = top * clip.height;
  const sw = Math.max(1, clip.width * (1 - left - right));
  const sh = Math.max(1, clip.height * (1 - top - bottom));
  return { sx, sy, sw, sh };
}

/**
 * Where the recording sits inside the output at rest, before the camera moves.
 * The recording is letterboxed into the padded area so it never distorts.
 */
export function layout(doc: Doc): Rect {
  const { width: ow, height: oh } = doc.output;
  const pad = Math.min(ow, oh) * doc.frame.padding;
  const availW = Math.max(1, ow - pad * 2);
  const availH = Math.max(1, oh - pad * 2);

  const clip = doc.clip;
  const aspect = clip && clip.height > 0 ? clip.width / clip.height : 16 / 9;

  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }
  return { x: (ow - w) / 2, y: (oh - h) / 2, w, h };
}

/** The canvas-space point the camera is locked onto. */
function anchor(frame: Rect, center: Point): Point {
  return { x: frame.x + center.x * frame.w, y: frame.y + center.y * frame.h };
}

/**
 * Inverse of the camera transform: turn a point on the output canvas into a
 * normalised point in video space. This is what lets you scrub to a moment,
 * click the thing you care about, and have the zoom target land on it even
 * while the camera is already moving.
 */
export function canvasToVideo(
  doc: Doc,
  cam: Camera,
  cx: number,
  cy: number,
): Point {
  const frame = layout(doc);
  const p = anchor(frame, cam.center);
  const ox = doc.output.width / 2;
  const oy = doc.output.height / 2;

  const fx = (cx - ox) / cam.scale + p.x;
  const fy = (cy - oy) / cam.scale + p.y;

  return { x: (fx - frame.x) / frame.w, y: (fy - frame.y) / frame.h };
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  w: number,
  h: number,
) {
  if (bg.kind === "solid") {
    ctx.fillStyle = bg.color;
  } else if (bg.kind === "radial") {
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      0,
      w / 2,
      h / 2,
      Math.hypot(w, h) / 2,
    );
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  } else {
    const rad = (bg.angle * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const len = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
    const dx = Math.cos(rad) * len;
    const dy = Math.sin(rad) * len;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);
}

interface ShadowSprite {
  key: string;
  canvas: HTMLCanvasElement;
  pad: number;
}

let shadowCache: ShadowSprite | null = null;

/**
 * The frame's drop shadow, rendered once and reused.
 *
 * A large `shadowBlur` is one of the most expensive things a 2D canvas can do,
 * and paying for it on every frame dominated the preview's cost — especially
 * under software rendering. The geometry only changes when the layout does, so
 * it's baked into a sprite and blitted instead.
 */
function shadowSprite(
  w: number,
  h: number,
  radius: number,
  blur: number,
  opacity: number,
  offsetY: number,
): ShadowSprite {
  const key = `${Math.round(w)}x${Math.round(h)}:${radius}:${blur}:${opacity}:${offsetY}`;
  if (shadowCache && shadowCache.key === key) return shadowCache;

  const pad = Math.ceil(blur * 2 + Math.abs(offsetY) + 4);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w + pad * 2));
  canvas.height = Math.max(1, Math.ceil(h + pad * 2));

  const g = canvas.getContext("2d");
  if (g) {
    g.shadowColor = `rgba(0,0,0,${opacity})`;
    g.shadowBlur = blur;
    g.shadowOffsetY = offsetY;
    g.fillStyle = "#000";
    g.beginPath();
    g.roundRect(pad, pad, w, h, radius);
    g.fill();
  }

  shadowCache = { key, canvas, pad };
  return shadowCache;
}

/** `#rrggbb` to `rgba(r,g,b,a)`. Non-hex colours are passed through, so a
 *  named or already-rgba value still works — it just can't be faded. */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Decoration for the recorded pointer, in frame space.
 *
 * The pointer itself is already in the video — the capture embeds it — so this
 * draws only what sits behind it: a streak for where it came from, and a glow
 * for where it is. Called inside the frame's clip, so neither can spill past
 * the recording's rounded corners.
 */
function paintCursor(ctx: CanvasRenderingContext2D, doc: Doc, frame: Rect, srcTime: number) {
  const style = doc.cursorStyle;
  if (!style.enabled) return;

  const here = cursorAt(doc.clip, srcTime, doc.cursorSmoothing);
  if (!here) return;

  // Cursor samples are in full-source space; the frame shows the cropped
  // region, so positions have to be re-based into it or a cropped edge would
  // pull the decoration off the visible content. The trail points go through
  // the same mapping, so they stay glued to the pointer's path.
  const toX = (p: Point) => frame.x + srcToFramePoint(doc, p).x * frame.w;
  const toY = (p: Point) => frame.y + srcToFramePoint(doc, p).y * frame.h;

  ctx.save();

  if (style.trail > 0 && style.trailOpacity > 0) {
    const path = cursorTrail(doc.clip, srcTime, doc.cursorSmoothing, style.trail);
    const width = style.trailWidth * frame.h;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Segment at a time: a single stroke can't taper, and the taper is what
    // makes this read as motion rather than as a line someone drew.
    for (let i = 1; i < path.length; i++) {
      const u = i / (path.length - 1);
      ctx.strokeStyle = withAlpha(style.color, style.trailOpacity * u * u);
      ctx.lineWidth = Math.max(0.5, width * u);
      ctx.beginPath();
      ctx.moveTo(toX(path[i - 1]), toY(path[i - 1]));
      ctx.lineTo(toX(path[i]), toY(path[i]));
      ctx.stroke();
    }
  }

  if (style.highlightOpacity > 0 && style.highlightSize > 0) {
    const r = style.highlightSize * frame.h;
    const cx = toX(here);
    const cy = toY(here);
    // Fades to fully transparent at the rim: a hard-edged disc reads as a
    // sticker on the frame, a falloff reads as light.
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(style.color, style.highlightOpacity));
    g.addColorStop(0.55, withAlpha(style.color, style.highlightOpacity * 0.5));
    g.addColorStop(1, withAlpha(style.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Placeholder shown before a recording is imported. */
function paintEmpty(ctx: CanvasRenderingContext2D, frame: Rect, radius: number) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw one frame of the composition. Pure with respect to (doc, time): the
 * only mutable input is the video element, which the caller has already sought
 * to `time`. Preview and export both call this, so what you see is what ships.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  time: number,
  source: CanvasImageSource | null,
  /**
   * Ratio of canvas pixels to output pixels. The preview draws at the size it
   * is actually displayed rather than at the recording's full resolution —
   * compositing 2560×1440 for an on-screen box a third that size was most of
   * the preview's cost. Export leaves this at 1 and gets full resolution.
   */
  viewScale = 1,
) {
  const { width: ow, height: oh } = doc.output;
  const frame = layout(doc);
  const cam = doc.clip ? cameraAt(doc, time) : REST;

  ctx.save();
  // Everything below is written in output coordinates; this is the only place
  // that knows the preview might be smaller.
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
  ctx.clearRect(0, 0, ow, oh);
  const tBg = mark();
  paintBackground(ctx, doc.background, ow, oh);
  add("background", tBg);

  // Camera acts on the framed recording only — the background stays put, which
  // reads as a camera pushing into the screen rather than the whole poster
  // scaling up.
  const p = anchor(frame, cam.center);
  ctx.translate(ow / 2, oh / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-p.x, -p.y);

  const radius = doc.frame.radius;

  if (!source) {
    paintEmpty(ctx, frame, radius);
    ctx.restore();
    return;
  }

  // Cached shadow, blitted rather than blurred. It scales with the camera,
  // which reads correctly: the whole framed recording is what's moving closer.
  if (doc.frame.shadowOpacity > 0) {
    const tShadow = mark();
    const sprite = shadowSprite(
      frame.w,
      frame.h,
      radius,
      doc.frame.shadowBlur,
      doc.frame.shadowOpacity,
      doc.frame.shadowY,
    );
    ctx.drawImage(sprite.canvas, frame.x - sprite.pad, frame.y - sprite.pad);
    add("shadow", tShadow);
  }

  // The rounded clip is timed with the video blit rather than separately: a
  // non-rectangular clip is set up lazily, so its real cost lands on whatever
  // draws through it.
  const tVideo = mark();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, radius);
  ctx.clip();
  // Nine-argument drawImage: the crop lives here, so preview and export agree
  // without either knowing the source's layout.
  const src = sourceRect(doc);
  ctx.drawImage(source, src.sx, src.sy, src.sw, src.sh, frame.x, frame.y, frame.w, frame.h);
  add("video", tVideo);

  // Inside the clip and inside the camera transform: the decoration belongs to
  // the recording, so it zooms and pans with it rather than floating over the
  // output at a fixed size.
  const tCursor = mark();
  const hit = sourceAt(doc, time);
  if (hit) paintCursor(ctx, doc, frame, hit.srcTime);
  add("cursor", tCursor);

  ctx.restore();

  ctx.restore();
}
