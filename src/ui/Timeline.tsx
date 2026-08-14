import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../doc/store";
import { docDuration, segmentLength, segmentOffset } from "../doc/time";
import { fmtTime } from "./format";
import { ease } from "../render/easing";
import type { ZoomBlock } from "../doc/types";

/**
 * Each block draws its own motion: the ramp-in curve, the hold, the ramp-out.
 * Reading a timeline should tell you how something moves, not just when — and
 * this is sampled from the same easing function the renderer uses.
 */
function BlockCurve({
  block,
  chainedIn,
  chainedOut,
}: {
  block: ZoomBlock;
  chainedIn: boolean;
  chainedOut: boolean;
}) {
  const len = block.end - block.start;
  if (len <= 0) return null;

  const w = 100;
  const h = 100;
  // A chained edge has no ramp — the neighbouring gap owns that move — so the
  // curve has to show a flat edge or it contradicts what the camera does.
  const inFrac = chainedIn ? 0 : Math.min(0.5, block.rampIn / len);
  const outFrac = chainedOut ? 0 : Math.min(0.5, block.rampOut / len);

  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    let v: number;
    if (inFrac > 0 && u < inFrac) v = ease(block.ease, u / inFrac, block.bounce);
    else if (outFrac > 0 && u > 1 - outFrac) {
      v = ease(block.ease, (1 - u) / outFrac, block.bounce);
    } else v = 1;
    pts.push(`${(u * w).toFixed(1)},${(h - v * h * 0.82 - 9).toFixed(1)}`);
  }

  return (
    <svg
      className="block-curve"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline points={pts.join(" ")} />
    </svg>
  );
}

const IconFilm = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <rect x="2" y="3.5" width="12" height="9" rx="1.6" />
    <path d="M5.4 3.5v9M10.6 3.5v9" />
  </svg>
);

const IconZoomTrack = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <circle cx="7.2" cy="7.2" r="4" />
    <path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" />
    <path d="M7.2 5.6v3.2M5.6 7.2h3.2" strokeLinecap="round" />
  </svg>
);

const IconSplit = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M8 2v12" strokeLinecap="round" strokeDasharray="2.2 2" />
    <path d="M3.4 5.2 6 8l-2.6 2.8M12.6 5.2 10 8l2.6 2.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconIn = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M3.2 3.5v9" strokeLinecap="round" />
    <path d="M12.8 4.2 8.8 8l4 3.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconOut = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M12.8 3.5v9" strokeLinecap="round" />
    <path d="M3.2 4.2 7.2 8l-4 3.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconCut = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <circle cx="4" cy="4" r="1.9" />
    <circle cx="4" cy="12" r="1.9" />
    <path d="M5.5 5.3 13 12M5.5 10.7 13 4" strokeLinecap="round" />
  </svg>
);

type BlockMode = "move" | "left" | "right";

interface BlockDrag {
  kind: "block";
  id: string;
  mode: BlockMode;
  grabT: number;
  start: number;
  end: number;
}

interface TrimDrag {
  kind: "trim";
  id: string;
  edge: "left" | "right";
  grabT: number;
  srcStart: number;
  srcEnd: number;
  speed: number;
}

type Drag = BlockDrag | TrimDrag;

/** Tick spacing that keeps labels readable at any zoom level. */
function tickStep(duration: number, width: number): number {
  const target = 90; // px between labels
  const perPx = duration / Math.max(1, width);
  const raw = perPx * target;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s >= raw) ?? 600;
}

export default function Timeline() {
  const doc = useStore((s) => s.doc);
  const playhead = useStore((s) => s.playhead);
  const selectedId = useStore((s) => s.selectedId);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const setPlaying = useStore((s) => s.setPlaying);
  const select = useStore((s) => s.select);
  const selectSegment = useStore((s) => s.selectSegment);
  const moveBlock = useStore((s) => s.moveBlock);
  const removeBlock = useStore((s) => s.removeBlock);
  const trimSegment = useStore((s) => s.trimSegment);
  const splitAt = useStore((s) => s.splitAt);
  const inPoint = useStore((s) => s.inPoint);
  const outPoint = useStore((s) => s.outPoint);
  const setInPoint = useStore((s) => s.setInPoint);
  const setOutPoint = useStore((s) => s.setOutPoint);
  const cutRange = useStore((s) => s.cutRange);

  const laneRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);

  const duration = docDuration(doc);

  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const toTime = useCallback(
    (clientX: number) => {
      const el = laneRef.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * duration;
    },
    [duration],
  );

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  const scrub = (e: React.PointerEvent) => {
    if (duration <= 0) return;
    setPlaying(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    setPlayhead(toTime(e.clientX));
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    setPlayhead(toTime(e.clientX));
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dt = toTime(e.clientX) - drag.grabT;

      if (drag.kind === "block") {
        const len = drag.end - drag.start;
        if (drag.mode === "move") {
          const s = Math.max(0, Math.min(duration - len, drag.start + dt));
          moveBlock(drag.id, s, s + len);
        } else if (drag.mode === "left") {
          moveBlock(drag.id, Math.max(0, Math.min(drag.end - 0.3, drag.start + dt)), drag.end);
        } else {
          moveBlock(drag.id, drag.start, Math.min(duration, Math.max(drag.start + 0.3, drag.end + dt)));
        }
        return;
      }

      // Trimming moves an in/out point in *source* time, so the drag distance
      // on the timeline has to be scaled back up by the segment's speed.
      const srcDelta = dt * drag.speed;
      if (drag.edge === "left") {
        trimSegment(drag.id, drag.srcStart + srcDelta, drag.srcEnd);
      } else {
        trimSegment(drag.id, drag.srcStart, drag.srcEnd + srcDelta);
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, toTime, duration, moveBlock, trimSegment]);

  const beginBlockDrag = (e: React.PointerEvent, id: string, mode: BlockMode) => {
    e.stopPropagation();
    const b = doc.blocks.find((x) => x.id === id);
    if (!b) return;
    select(id);
    setPlaying(false);
    setDrag({ kind: "block", id, mode, grabT: toTime(e.clientX), start: b.start, end: b.end });
  };

  const beginTrim = (e: React.PointerEvent, id: string, edge: "left" | "right") => {
    e.stopPropagation();
    const seg = doc.segments.find((x) => x.id === id);
    if (!seg) return;
    selectSegment(id);
    setPlaying(false);
    setDrag({
      kind: "trim",
      id,
      edge,
      grabT: toTime(e.clientX),
      srcStart: seg.srcStart,
      srcEnd: seg.srcEnd,
      speed: seg.speed,
    });
  };

  const ticks: number[] = [];
  const minorTicks: number[] = [];
  if (duration > 0) {
    const step = tickStep(duration, width);
    for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
    // Four unlabelled subdivisions between labels give the eye something to
    // judge distance against without adding more numbers to read.
    for (let t = 0; t <= duration + 1e-6; t += step / 4) minorTicks.push(t);
  }

  const rangeValid = inPoint != null && outPoint != null && outPoint > inPoint;
  const rangeLen = rangeValid ? outPoint! - inPoint! : 0;

  return (
    <section className="timeline">
      <div className="track-labels">
        <div className="ruler-spacer">
          <button
            className="mini"
            disabled={!doc.clip}
            onClick={() => {
              setPlaying(false);
              splitAt(useStore.getState().playhead);
            }}
            title="Split at playhead (S)"
          >
            <IconSplit />
            Split
          </button>
          <button
            className={`mini mark${inPoint != null ? " active" : ""}`}
            disabled={!doc.clip}
            onClick={() => {
              setPlaying(false);
              setInPoint();
            }}
            title="Mark where the cut begins (I)"
            aria-label="Mark in point"
          >
            <IconIn />
          </button>
          <button
            className={`mini mark${outPoint != null ? " active" : ""}`}
            disabled={!doc.clip}
            onClick={() => {
              setPlaying(false);
              setOutPoint();
            }}
            title="Mark where the cut ends (O)"
            aria-label="Mark out point"
          >
            <IconOut />
          </button>
          <button
            className={`mini cut${rangeValid ? " armed" : ""}`}
            disabled={!rangeValid}
            onClick={() => {
              setPlaying(false);
              cutRange();
            }}
            title={
              rangeValid
                ? `Remove ${rangeLen.toFixed(2)}s from the timeline (X)`
                : "Mark In and Out points first"
            }
            aria-label="Cut the marked range"
          >
            <IconCut />
          </button>
        </div>
        <div className="track-label">
          <span className="track-icon video">
            <IconFilm />
          </span>
          <span className="track-name">Video</span>
          <span className="count">{doc.segments.length}</span>
        </div>
        <div className="track-label">
          <span className="track-icon zoom">
            <IconZoomTrack />
          </span>
          <span className="track-name">Zoom</span>
          <span className="count">{doc.blocks.length}</span>
        </div>
      </div>

      <div className="track-area">
        <div className="ruler" onPointerDown={scrub} onPointerMove={scrubMove}>
          {minorTicks.map((t) => (
            <div key={`m${t}`} className="tick minor" style={{ left: `${pct(t)}%` }} />
          ))}
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: `${pct(t)}%` }}>
              <span>{fmtTime(t).slice(0, -3)}</span>
            </div>
          ))}
          {inPoint != null && (
            <div className="ruler-mark in" style={{ left: `${pct(inPoint)}%` }} title={`In ${fmtTime(inPoint)}`} />
          )}
          {outPoint != null && (
            <div className="ruler-mark out" style={{ left: `${pct(outPoint)}%` }} title={`Out ${fmtTime(outPoint)}`} />
          )}
          <div className="ruler-playhead" style={{ left: `${pct(playhead)}%` }}>
            <span className="ruler-time">{fmtTime(playhead).slice(0, -1)}</span>
          </div>
        </div>

        <div className="lanes" ref={laneRef}>
          {/* The range about to be cut, drawn under everything: dimmed like
              the void it's about to become. */}
          {rangeValid && (
            <div
              className="cut-range"
              style={{ left: `${pct(inPoint!)}%`, width: `${pct(rangeLen)}%` }}
              title={`Cut ${fmtTime(inPoint!)} – ${fmtTime(outPoint!)}`}
            />
          )}
          <div className="lane video-lane" onPointerDown={() => select(null)}>
            {doc.clip ? (
              doc.segments.map((seg, i) => {
                const off = segmentOffset(doc, i);
                const len = segmentLength(seg);
                return (
                  <div
                    key={seg.id}
                    className={`clip-bar${seg.id === selectedSegmentId ? " selected" : ""}`}
                    style={{ left: `${pct(off)}%`, width: `${pct(len)}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      selectSegment(seg.id);
                    }}
                    title={`${doc.clip!.name} · ${seg.speed}×`}
                  >
                    <span className="handle left" onPointerDown={(e) => beginTrim(e, seg.id, "left")} />
                    <span className="clip-name">{doc.clip!.name}</span>
                    {seg.speed !== 1 && (
                      <span className="clip-badge">{seg.speed}×</span>
                    )}
                    <span className="handle right" onPointerDown={(e) => beginTrim(e, seg.id, "right")} />
                  </div>
                );
              })
            ) : (
              <div className="lane-empty">no recording imported</div>
            )}
          </div>

          <div className="lane zoom-lane" onPointerDown={() => select(null)}>
            {/* Drawn under the blocks: the gap between two chained zooms is
                where the camera move happens, so it has to look occupied
                rather than empty. */}
            {doc.blocks.map((b, i) => {
              const nx = doc.blocks[i + 1];
              if (!b.chain || !nx) return null;
              return (
                <span
                  key={`chain-${b.id}`}
                  className="chain-link"
                  style={{ left: `${pct(b.end)}%`, width: `${pct(nx.start - b.end)}%` }}
                  title={`Camera moves to the next zoom over ${(nx.start - b.end).toFixed(1)}s`}
                />
              );
            })}
            {doc.blocks.map((b, i) => (
              <div
                key={b.id}
                className={`block${b.id === selectedId ? " selected" : ""}`}
                style={{ left: `${pct(b.start)}%`, width: `${pct(b.end - b.start)}%` }}
                onPointerDown={(e) => beginBlockDrag(e, b.id, "move")}
                onDoubleClick={() => removeBlock(b.id)}
                title="Drag to move · edges to resize · double-click to delete"
              >
                <span className="handle left" onPointerDown={(e) => beginBlockDrag(e, b.id, "left")} />
                <BlockCurve
                  block={b}
                  chainedIn={i > 0 && doc.blocks[i - 1].chain}
                  chainedOut={!!doc.blocks[i + 1] && b.chain}
                />
                <span className="block-label">
                  {b.scale.toFixed(1)}×{b.followCursor && <em>follow</em>}
                </span>
                <span className="handle right" onPointerDown={(e) => beginBlockDrag(e, b.id, "right")} />
              </div>
            ))}
          </div>

          <div className="playhead" style={{ left: `${pct(playhead)}%` }} />
        </div>
      </div>
    </section>
  );
}
