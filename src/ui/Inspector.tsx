import { useStore } from "../doc/store";
import { segmentLength } from "../doc/time";
import { EASE_NAMES } from "../render/easing";
import { PRESETS, backgroundCss, sameBackground } from "../render/backgrounds";
import type { Background } from "../doc/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <span className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="slider-value">
        {value.toFixed(step < 1 ? 2 : 0)}
        {suffix}
      </span>
    </span>
  );
}

function ZoomPanel({ id }: { id: string }) {
  const block = useStore((s) => s.doc.blocks.find((b) => b.id === id))!;
  const update = useStore((s) => s.updateBlock);
  const remove = useStore((s) => s.removeBlock);
  const setPlayhead = useStore((s) => s.setPlayhead);

  const len = block.end - block.start;
  const maxRamp = Math.max(0.05, len / 2);

  return (
    <>
      <div className="panel-head">
        <h2>Zoom</h2>
        <button className="ghost danger" onClick={() => remove(id)}>
          Delete
        </button>
      </div>

      <div className="section">
        <Row label="Scale">
          <Slider
            value={block.scale}
            min={1}
            max={6}
            step={0.05}
            suffix="×"
            onChange={(v) => update(id, { scale: v })}
          />
        </Row>
        <Row label="Easing">
          <select
            value={block.ease}
            onChange={(e) => update(id, { ease: e.target.value as never })}
          >
            {EASE_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Ramp in">
          <Slider
            value={Math.min(block.rampIn, maxRamp)}
            min={0}
            max={maxRamp}
            step={0.05}
            suffix="s"
            onChange={(v) => update(id, { rampIn: v })}
          />
        </Row>
        <Row label="Ramp out">
          <Slider
            value={Math.min(block.rampOut, maxRamp)}
            min={0}
            max={maxRamp}
            step={0.05}
            suffix="s"
            onChange={(v) => update(id, { rampOut: v })}
          />
        </Row>
      </div>

      <div className="section">
        <div className="section-title">Target</div>
        <Row label="X">
          <Slider
            value={block.target.x}
            min={0}
            max={1}
            step={0.005}
            onChange={(v) => update(id, { target: { ...block.target, x: v } })}
          />
        </Row>
        <Row label="Y">
          <Slider
            value={block.target.y}
            min={0}
            max={1}
            step={0.005}
            onChange={(v) => update(id, { target: { ...block.target, y: v } })}
          />
        </Row>
        <p className="note">
          Scrub into the block and click the preview to re-aim it.
        </p>
      </div>

      <div className="section">
        <div className="section-title">Timing</div>
        <Row label="Start">
          <button className="ghost" onClick={() => setPlayhead(block.start)}>
            {block.start.toFixed(2)}s
          </button>
        </Row>
        <Row label="Length">
          <span className="static-value">{len.toFixed(2)}s</span>
        </Row>
      </div>
    </>
  );
}

const SPEEDS = [0.5, 1, 1.5, 2, 4];

function SegmentPanel({ id }: { id: string }) {
  const seg = useStore((s) => s.doc.segments.find((x) => x.id === id))!;
  const count = useStore((s) => s.doc.segments.length);
  const setSpeed = useStore((s) => s.setSegmentSpeed);
  const remove = useStore((s) => s.removeSegment);

  return (
    <>
      <div className="panel-head">
        <h2>Clip</h2>
        <button
          className="ghost danger"
          onClick={() => remove(id)}
          disabled={count <= 1}
          title={count <= 1 ? "The timeline needs at least one clip" : "Delete this clip"}
        >
          Delete
        </button>
      </div>

      <div className="section">
        <div className="section-title">Speed</div>
        <div className="chips">
          {SPEEDS.map((v) => (
            <button
              key={v}
              className={`chip${Math.abs(seg.speed - v) < 1e-6 ? " selected" : ""}`}
              onClick={() => setSpeed(id, v)}
            >
              {v}×
            </button>
          ))}
        </div>
        <Row label="Custom">
          <Slider
            value={seg.speed}
            min={0.25}
            max={8}
            step={0.05}
            suffix="×"
            onChange={(v) => setSpeed(id, v)}
          />
        </Row>
      </div>

      <div className="section">
        <div className="section-title">Source range</div>
        <Row label="In">
          <span className="static-value">{seg.srcStart.toFixed(2)}s</span>
        </Row>
        <Row label="Out">
          <span className="static-value">{seg.srcEnd.toFixed(2)}s</span>
        </Row>
        <Row label="On timeline">
          <span className="static-value">{segmentLength(seg).toFixed(2)}s</span>
        </Row>
        <p className="note">
          Drag the clip's edges on the timeline to trim. Splitting never touches
          the source file.
        </p>
      </div>
    </>
  );
}

function ScenePanel() {
  const doc = useStore((s) => s.doc);
  const patch = useStore((s) => s.patchDoc);
  const bg = doc.background;

  const setBg = (next: Background) => patch({ background: next });
  const setFrame = (k: keyof typeof doc.frame, v: number) =>
    patch({ frame: { ...doc.frame, [k]: v } });

  return (
    <>
      <div className="panel-head">
        <h2>Scene</h2>
      </div>

      <div className="section">
        <div className="section-title">Background</div>
        <div className="swatches">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className={`swatch${sameBackground(p.bg, bg) ? " selected" : ""}`}
              style={{ background: backgroundCss(p.bg) }}
              onClick={() => setBg(p.bg)}
              title={p.name}
            />
          ))}
        </div>
        <Row label="Type">
          <select
            value={bg.kind}
            onChange={(e) => {
              const k = e.target.value;
              setBg(
                k === "solid"
                  ? { kind: "solid", color: "#EDEDED" }
                  : k === "radial"
                    ? { kind: "radial", from: "#FFFFFF", to: "#D9DDE3" }
                    : { kind: "linear", from: "#EDEDED", to: "#DCDCDC", angle: 120 },
              );
            }}
          >
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
            <option value="solid">Solid</option>
          </select>
        </Row>
        {bg.kind === "solid" ? (
          <Row label="Colour">
            <input
              type="color"
              value={bg.color}
              onChange={(e) => setBg({ ...bg, color: e.target.value })}
            />
          </Row>
        ) : (
          <>
            <Row label="From">
              <input
                type="color"
                value={bg.from}
                onChange={(e) => setBg({ ...bg, from: e.target.value })}
              />
            </Row>
            <Row label="To">
              <input
                type="color"
                value={bg.to}
                onChange={(e) => setBg({ ...bg, to: e.target.value })}
              />
            </Row>
            {bg.kind === "linear" && (
              <Row label="Angle">
                <Slider
                  value={bg.angle}
                  min={0}
                  max={360}
                  step={1}
                  suffix="°"
                  onChange={(v) => setBg({ ...bg, angle: v })}
                />
              </Row>
            )}
          </>
        )}
      </div>

      <div className="section">
        <div className="section-title">Frame</div>
        <Row label="Padding">
          <Slider
            value={doc.frame.padding}
            min={0}
            max={0.2}
            step={0.005}
            onChange={(v) => setFrame("padding", v)}
          />
        </Row>
        <Row label="Radius">
          <Slider
            value={doc.frame.radius}
            min={0}
            max={64}
            step={1}
            onChange={(v) => setFrame("radius", v)}
          />
        </Row>
        <Row label="Shadow">
          <Slider
            value={doc.frame.shadowOpacity}
            min={0}
            max={0.6}
            step={0.01}
            onChange={(v) => setFrame("shadowOpacity", v)}
          />
        </Row>
        <Row label="Spread">
          <Slider
            value={doc.frame.shadowBlur}
            min={0}
            max={200}
            step={1}
            onChange={(v) => setFrame("shadowBlur", v)}
          />
        </Row>
      </div>

      <div className="section">
        <div className="section-title">Output</div>
        <Row label="Size">
          <span className="static-value">
            {doc.output.width} × {doc.output.height}
          </span>
        </Row>
      </div>
    </>
  );
}

export default function Inspector() {
  const selectedId = useStore((s) => s.selectedId);
  const blockExists = useStore((s) => s.doc.blocks.some((b) => b.id === selectedId));
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const segmentExists = useStore((s) =>
    s.doc.segments.some((x) => x.id === selectedSegmentId),
  );

  return (
    <aside className="panel inspector">
      {selectedId && blockExists ? (
        <ZoomPanel id={selectedId} />
      ) : selectedSegmentId && segmentExists ? (
        <SegmentPanel id={selectedSegmentId} />
      ) : (
        <ScenePanel />
      )}
    </aside>
  );
}
