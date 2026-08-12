import type { Background, Doc, Point } from "../doc/types";
import { cameraAt, REST, type Camera } from "./camera";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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
  paintBackground(ctx, doc.background, ow, oh);

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
    const sprite = shadowSprite(
      frame.w,
      frame.h,
      radius,
      doc.frame.shadowBlur,
      doc.frame.shadowOpacity,
      doc.frame.shadowY,
    );
    ctx.drawImage(sprite.canvas, frame.x - sprite.pad, frame.y - sprite.pad);
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, radius);
  ctx.clip();
  ctx.drawImage(source, frame.x, frame.y, frame.w, frame.h);
  ctx.restore();

  ctx.restore();
}
