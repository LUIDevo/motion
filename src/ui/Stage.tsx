import { useEffect, useRef, useState } from "react";
import { useStore } from "../doc/store";
import { docDuration, sourceAt } from "../doc/time";
import type { Doc } from "../doc/types";
import { cameraAt, REST } from "../render/camera";
import { canvasToVideo, layout, renderFrame } from "../render/renderer";
import { cssVar } from "../theme";
import { fmtTime } from "./format";

/**
 * Preview overlay for the selected block's camera target. Drawn after the
 * frame and never by the renderer itself, so it can't leak into an export.
 */
function drawTarget(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  time: number,
  target: { x: number; y: number },
  viewScale: number,
) {
  const frame = layout(doc);
  const cam = doc.clip ? cameraAt(doc, time) : REST;
  const anchorX = frame.x + cam.center.x * frame.w;
  const anchorY = frame.y + cam.center.y * frame.h;

  const px = (frame.x + target.x * frame.w - anchorX) * cam.scale + doc.output.width / 2;
  const py = (frame.y + target.y * frame.h - anchorY) * cam.scale + doc.output.height / 2;

  const r = Math.max(10, doc.output.width * 0.008);
  // Resolved from the active ramp; the ring must stay legible over footage in
  // both themes, and the canvas can't read var() directly.
  const accent = cssVar("--ctp-blue", "#2C60F6");
  ctx.save();
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(px, py, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** How far the source may drift from where the timeline says it should be
 *  before we correct it with a seek. Small enough to stay in sync, large
 *  enough that we aren't seeking every frame during normal playback. */
const DRIFT_TOLERANCE = 0.2;

/* Inline icons rather than emoji glyphs: emoji render at whatever size and
 * colour the platform font decides, which is why the old transport controls
 * looked accidental. */
const IconStart = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M4 3.5a.75.75 0 0 1 1.5 0v3.4l5.3-3.3A.75.75 0 0 1 12 4.2v7.6a.75.75 0 0 1-1.2.6L5.5 9.1v3.4a.75.75 0 0 1-1.5 0z" />
  </svg>
);

const IconPlay = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M5 3.6c0-.6.66-.97 1.17-.65l7 4.4a.77.77 0 0 1 0 1.3l-7 4.4A.77.77 0 0 1 5 12.4z" />
  </svg>
);

const IconPause = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="4" y="3" width="3" height="10" rx="1" />
    <rect x="9" y="3" width="3" height="10" rx="1" />
  </svg>
);

const READY_STATE = ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT", "HAVE_FUTURE", "HAVE_ENOUGH"];
const NETWORK_STATE = ["EMPTY", "IDLE", "LOADING", "NO_SOURCE"];
const MEDIA_ERR = ["", "ABORTED", "NETWORK", "DECODE", "SRC_NOT_SUPPORTED"];

interface Diagnostics {
  src: string;
  ready: number;
  network: number;
  error: string;
  dims: string;
  currentTime: number;
}

/**
 * Ask for the source over fetch as well as through the media element.
 *
 * The two take different paths: fetch goes through the webview's normal
 * networking, while media decoding happens in a separate process. If fetch can
 * read the bytes and the video element still reports NO_SOURCE, the file and
 * the permissions are fine and it's the media path that can't reach the
 * custom scheme.
 */
async function probeFetch(src: string): Promise<string> {
  try {
    const res = await fetch(src, { headers: { Range: "bytes=0-1023" } });
    const buf = await res.arrayBuffer();
    return `${res.status} ${res.headers.get("content-type") ?? "no-type"} ${buf.byteLength}B`;
  } catch (err) {
    return `threw: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export default function Stage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  /** Canvas pixels per output pixel; see renderFrame's viewScale. */
  const viewScaleRef = useRef(1);
  /** Authoritative time during playback. The store is updated far less often,
   *  because every write re-renders the timeline and inspector. */
  const timeRef = useRef(0);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [fetchResult, setFetchResult] = useState<string>("(not tried)");
  /** Wall-clock anchor for playback, so cuts and speed changes advance the
   *  playhead at the right rate regardless of what the source is doing. */
  const tickRef = useRef<number>(0);
  /** Set whenever something that affects the drawn frame changes. While paused
   *  the composition is static, so the loop draws only when this is set —
   *  under software rendering the idle repaint cost more than playback did. */
  const dirtyRef = useRef(true);

  const clip = useStore((s) => s.doc.clip);
  const output = useStore((s) => s.doc.output);
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const duration = useStore((s) => docDuration(s.doc));
  const setPlaying = useStore((s) => s.setPlaying);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const addZoom = useStore((s) => s.addZoom);
  const updateBlock = useStore((s) => s.updateBlock);

  // Size the backing store to however large the canvas actually appears,
  // capped so a huge window can't make the preview cost more than the export.
  useEffect(() => {
    const el = viewportRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const resize = () => {
      const box = el.getBoundingClientRect();
      const pad = 36;
      const availW = Math.max(64, box.width - pad);
      const availH = Math.max(64, box.height - pad);
      const fit = Math.min(availW / output.width, availH / output.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(fit * dpr, 1);

      viewScaleRef.current = scale;
      canvas.width = Math.max(1, Math.round(output.width * scale));
      canvas.height = Math.max(1, Math.round(output.height * scale));
      // Setting either dimension clears the canvas, so this always needs a
      // repaint even when the composition itself hasn't moved.
      dirtyRef.current = true;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [output.width, output.height]);

  // Anything in the document, the playhead or the selection changes what the
  // frame should look like. Rather than enumerate them, treat every store
  // write as a repaint: writes are user-driven and rare next to 60fps.
  useEffect(() => useStore.subscribe(() => { dirtyRef.current = true; }), []);

  // The element decodes asynchronously, so a seek lands some frames after the
  // playhead moved. These are the events that mean "there is a new picture".
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const mark = () => { dirtyRef.current = true; };
    const events = ["seeked", "loadeddata", "canplay", "timeupdate", "resize"];
    for (const e of events) v.addEventListener(e, mark);
    return () => {
      for (const e of events) v.removeEventListener(e, mark);
    };
  }, []);

  useEffect(() => {
    if (clip) {
      setFetchResult("checking…");
      void probeFetch(clip.src).then(setFetchResult);
    } else {
      setFetchResult("(no clip)");
    }
  }, [clip]);

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
    tickRef.current = performance.now();
    if (playing) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, clip, setPlaying]);

  // Scrubbing drives the video; playback drives the playhead. Keeping the two
  // directions mutually exclusive avoids the seek/advance feedback loop that
  // otherwise makes the scrubber stutter.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing) return;
    const hit = sourceAt(useStore.getState().doc, playhead);
    if (!hit) return;
    if (Math.abs(v.currentTime - hit.srcTime) > 0.02) v.currentTime = hit.srcTime;
  }, [playhead, playing]);

  // Sampled a few times a second rather than per frame: enough to watch a load
  // progress or fail, without re-rendering the tree at 60fps.
  // Kept behind a toggle rather than deleted: it was the only thing that
  // actually identified why media wouldn't load, and costs nothing while off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === "d" || e.key === "D") setShowDiag((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!showDiag) {
      setDiag(null);
      return;
    }
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v) return setDiag(null);
      const err = v.error;
      setDiag({
        src: v.currentSrc || "(none)",
        ready: v.readyState,
        network: v.networkState,
        error: err ? `${MEDIA_ERR[err.code] ?? err.code}${err.message ? `: ${err.message}` : ""}` : "none",
        dims: `${v.videoWidth}×${v.videoHeight}`,
        currentTime: v.currentTime,
      });
    }, 250);
    return () => clearInterval(id);
  }, [showDiag]);

  useEffect(() => {
    let raf = 0;
    let lastPush = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const st = useStore.getState();
      const v = videoRef.current;
      const dur = docDuration(st.doc);

      let t = st.playhead;

      if (st.playing && v) {
        // Advance on wall clock rather than on video.currentTime: across a cut
        // the source jumps backwards, and speed segments make it run at a
        // different rate than the timeline.
        const dt = Math.min(0.25, (now - tickRef.current) / 1000);
        tickRef.current = now;
        t = timeRef.current + dt;

        if (t >= dur) {
          t = dur;
          timeRef.current = t;
          st.setPlayhead(t);
          st.setPlaying(false);
        } else {
          timeRef.current = t;
          // Pushing the playhead into the store re-renders the timeline and
          // inspector. At 60fps that cost more than drawing the frame did, and
          // the scrubber reads perfectly smoothly at this rate.
          if (now - lastPush > 100) {
            lastPush = now;
            st.setPlayhead(t);
          }
        }

        const hit = sourceAt(st.doc, t);
        if (hit) {
          if (v.playbackRate !== hit.segment.speed) {
            v.playbackRate = hit.segment.speed;
          }
          // Let the element play on its own, correcting only when it drifts —
          // seeking every frame stutters badly in WebKit.
          if (Math.abs(v.currentTime - hit.srcTime) > DRIFT_TOLERANCE) {
            v.currentTime = hit.srcTime;
          }
        }
      } else {
        tickRef.current = now;
        timeRef.current = t;
        // Paused and nothing has changed: the last frame is still correct.
        if (!dirtyRef.current) return;
      }

      dirtyRef.current = false;

      const ready = v && v.readyState >= 2 ? v : null;
      renderFrame(ctx, st.doc, t, ready, viewScaleRef.current);

      const sel = st.doc.blocks.find((b) => b.id === st.selectedId);
      if (sel) drawTarget(ctx, st.doc, t, sel.target, viewScaleRef.current);
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
      <div className="stage-viewport" ref={viewportRef}>
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          style={{ aspectRatio: `${output.width} / ${output.height}` }}
          onClick={onCanvasClick}
        />
        <video
          ref={videoRef}
          className="hidden-video"
          muted
          playsInline
          preload="auto"
          // Frames are read back out of the canvas on export. Without this the
          // canvas is tainted by the cross-origin source and toDataURL throws.
          crossOrigin="anonymous"
        />

        {showDiag && diag && (
          <div className="diag">
            <div><b>src</b> {diag.src.length > 64 ? "…" + diag.src.slice(-60) : diag.src}</div>
            <div><b>readyState</b> {diag.ready} {READY_STATE[diag.ready] ?? "?"}</div>
            <div><b>network</b> {diag.network} {NETWORK_STATE[diag.network] ?? "?"}</div>
            <div><b>error</b> {diag.error}</div>
            <div><b>dims</b> {diag.dims} · <b>t</b> {diag.currentTime.toFixed(2)}</div>
            <div><b>fetch</b> {fetchResult}</div>
          </div>
        )}
      </div>

      <div className="transport">
        <button
          className="icon-btn"
          onClick={() => setPlayhead(0)}
          disabled={!clip}
          title="Back to start"
        >
          <IconStart />
        </button>
        <button
          className="icon-btn primary"
          onClick={() => setPlaying(!playing)}
          disabled={!clip}
          title="Play / pause (space)"
        >
          {playing ? <IconPause /> : <IconPlay />}
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
