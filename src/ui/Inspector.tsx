import { useStore } from "../doc/store";
import { EASE_NAMES } from "../render/easing";
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
        <Row label="Type">
          <select
            value={bg.kind}
            onChange={(e) =>
              setBg(
                e.target.value === "solid"
                  ? { kind: "solid", color: "#EDEDED" }
                  : { kind: "linear", from: "#EDEDED", to: "#DCDCDC", angle: 120 },
              )
            }
          >
            <option value="linear">Gradient</option>
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
  const exists = useStore((s) => s.doc.blocks.some((b) => b.id === selectedId));

  return (
    <aside className="panel inspector">
      {selectedId && exists ? <ZoomPanel id={selectedId} /> : <ScenePanel />}
    </aside>
  );
}
