import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../doc/store";
import { docDuration, segmentLength, segmentOffset } from "../doc/time";
import { fmtTime } from "./format";

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
  if (duration > 0) {
    const step = tickStep(duration, width);
    for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  }

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
            Split
          </button>
        </div>
        <div className="track-label">
          Video <span className="count">{doc.segments.length}</span>
        </div>
        <div className="track-label">
          Zoom <span className="count">{doc.blocks.length}</span>
        </div>
      </div>

      <div className="track-area">
        <div className="ruler" onPointerDown={scrub} onPointerMove={scrubMove}>
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: `${pct(t)}%` }}>
              <span>{fmtTime(t).slice(0, -3)}</span>
            </div>
          ))}
        </div>

        <div className="lanes" ref={laneRef}>
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
                    <span className="clip-name">
                      {doc.clip!.name}
                      {seg.speed !== 1 && <em> {seg.speed}×</em>}
                    </span>
                    <span className="handle right" onPointerDown={(e) => beginTrim(e, seg.id, "right")} />
                  </div>
                );
              })
            ) : (
              <div className="lane-empty">no recording imported</div>
            )}
          </div>

          <div className="lane zoom-lane" onPointerDown={() => select(null)}>
            {doc.blocks.map((b) => (
              <div
                key={b.id}
                className={`block${b.id === selectedId ? " selected" : ""}`}
                style={{ left: `${pct(b.start)}%`, width: `${pct(b.end - b.start)}%` }}
                onPointerDown={(e) => beginBlockDrag(e, b.id, "move")}
                onDoubleClick={() => removeBlock(b.id)}
                title="Drag to move · edges to resize · double-click to delete"
              >
                <span className="handle left" onPointerDown={(e) => beginBlockDrag(e, b.id, "left")} />
                <span className="block-label">{b.scale.toFixed(1)}×</span>
                <span className="handle right" onPointerDown={(e) => beginBlockDrag(e, b.id, "right")} />
              </div>
            ))}
          </div>

          <div className="playhead" style={{ left: `${pct(playhead)}%` }}>
            <div className="playhead-grip" />
          </div>
        </div>
      </div>
    </section>
  );
}
