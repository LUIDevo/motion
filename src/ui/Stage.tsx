import { useEffect, useRef } from "react";
import { docDuration, useStore } from "../doc/store";
import { cameraAt, REST } from "../render/camera";
import { canvasToVideo, layout, renderFrame } from "../render/renderer";
import { fmtTime } from "./format";

/**
 * Preview overlay for the selected block's camera target. Drawn after the
 * frame and never by the renderer itself, so it can't leak into an export.
 */
function drawTarget(
  ctx: CanvasRenderingContext2D,
  doc: ReturnType<typeof useStore.getState>["doc"],
  time: number,
  target: { x: number; y: number },
) {
  const frame = layout(doc);
  const cam = doc.clip ? cameraAt(doc, time) : REST;
  const anchorX = frame.x + cam.center.x * frame.w;
  const anchorY = frame.y + cam.center.y * frame.h;

  const px = (frame.x + target.x * frame.w - anchorX) * cam.scale + doc.output.width / 2;
  const py = (frame.y + target.y * frame.h - anchorY) * cam.scale + doc.output.height / 2;

  const r = Math.max(10, doc.output.width * 0.008);
  ctx.save();
  ctx.strokeStyle = "#2C60F6";
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#2C60F6";
  ctx.beginPath();
  ctx.arc(px, py, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default function Stage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const clip = useStore((s) => s.doc.clip);
  const output = useStore((s) => s.doc.output);
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const setPlaying = useStore((s) => s.setPlaying);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const addZoom = useStore((s) => s.addZoom);
  const updateBlock = useStore((s) => s.updateBlock);

  const duration = clip?.duration ?? 0;

  // Load the source whenever the clip changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (clip) {
      v.src = clip.src;
      v.currentTime = 0;
    } else {
      v.removeAttribute("src");
      v.load();
    }
  }, [clip]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clip) return;
    if (playing) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, clip, setPlaying]);

  // Scrubbing drives the video; playback drives the playhead. Keeping the two
  // directions mutually exclusive avoids the seek/advance feedback loop that
  // otherwise makes the scrubber stutter.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing) return;
    if (Math.abs(v.currentTime - playhead) > 0.02) v.currentTime = playhead;
  }, [playhead, playing]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const st = useStore.getState();
      const v = videoRef.current;

      let t = st.playhead;
      if (st.playing && v) {
        t = v.currentTime;
        if (v.ended || t >= docDuration(st.doc)) {
          st.setPlaying(false);
          t = docDuration(st.doc);
        }
        st.setPlayhead(t);
      }

      const ready = v && v.readyState >= 2 ? v : null;
      renderFrame(ctx, st.doc, t, ready);

      const sel = st.doc.blocks.find((b) => b.id === st.selectedId);
      if (sel) drawTarget(ctx, st.doc, t, sel.target);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !clip) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * output.width;
    const cy = ((e.clientY - rect.top) / rect.height) * output.height;

    const st = useStore.getState();
    const cam = cameraAt(st.doc, st.playhead);
    const target = canvasToVideo(st.doc, cam, cx, cy);

    // Clicking inside the selected block re-aims it; otherwise start a new one
    // at the playhead.
    const sel = st.doc.blocks.find((b) => b.id === st.selectedId);
    if (sel && st.playhead >= sel.start && st.playhead <= sel.end) {
      updateBlock(sel.id, { target });
    } else {
      addZoom(st.playhead, target);
    }
  };

  return (
    <section className="stage">
      <div className="stage-viewport">
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          width={output.width}
          height={output.height}
          style={{ aspectRatio: `${output.width} / ${output.height}` }}
          onClick={onCanvasClick}
        />
        <video ref={videoRef} className="hidden-video" muted playsInline preload="auto" />
      </div>

      <div className="transport">
        <button
          className="icon-btn"
          onClick={() => setPlayhead(0)}
          disabled={!clip}
          title="Back to start"
        >
          ⏮
        </button>
        <button
          className="icon-btn primary"
          onClick={() => setPlaying(!playing)}
          disabled={!clip}
          title="Play / pause (space)"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="timecode">
          {fmtTime(playhead)} <span className="dim">/ {fmtTime(duration)}</span>
        </span>
        <span className="hint">
          {clip ? "Click the preview to place a zoom" : "Import a recording to begin"}
        </span>
      </div>
    </section>
  );
}
