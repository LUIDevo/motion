import { useStore } from "../doc/store";
import { segmentLength } from "../doc/time";
import { EASE_NAMES } from "../render/easing";
import { PRESETS, backgroundCss, sameBackground } from "../render/backgrounds";
import { EaseCurve, Field, Field2, Section } from "./controls";
import type { Background, Crop, CursorStyle } from "../doc/types";

/* Section accents follow the active Catppuccin ramp. */
const MAUVE = "var(--ctp-mauve)";
const BLUE = "var(--ctp-blue)";
const TEAL = "var(--ctp-teal)";
const PEACH = "var(--ctp-peach)";
const GREEN = "var(--ctp-green)";

function ZoomPanel({ id }: { id: string }) {
  const block = useStore((s) => s.doc.blocks.find((b) => b.id === id))!;
  const update = useStore((s) => s.updateBlock);
  const remove = useStore((s) => s.removeBlock);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const hasCursor = useStore((s) => (s.doc.clip?.cursor?.length ?? 0) > 0);
  const applyToAll = useStore((s) => s.applyZoomStyle);

  // Blocks are kept sorted, so the chain always hands to the one after it.
  const next = useStore((s) => {
    const i = s.doc.blocks.findIndex((b) => b.id === id);
    return i >= 0 ? (s.doc.blocks[i + 1] ?? null) : null;
  });
  /** True when the previous block hands over to this one, which means this
   *  block's ramp-in is not used and shouldn't be offered. */
  const chainedIn = useStore((s) => {
    const i = s.doc.blocks.findIndex((b) => b.id === id);
    return i > 0 && s.doc.blocks[i - 1].chain;
  });

  // Clicking the preview only re-aims the selected block while the playhead is
  // inside it — otherwise Stage treats the click as placing a new zoom.
  const playhead = useStore((s) => s.playhead);
  const aimable = playhead >= block.start && playhead <= block.end;

  const len = block.end - block.start;
  const maxRamp = Math.max(0.05, len / 2);
  const chainedOut = !!next && block.chain;
  const gap = next ? next.start - block.end : 0;

  return (
    <>
      <div className="panel-head">
        <div>
          <h2>Zoom</h2>
          <span className="panel-sub">
            {block.start.toFixed(1)}s → {block.end.toFixed(1)}s · {len.toFixed(1)}s
          </span>
        </div>
        <button className="ghost danger" onClick={() => remove(id)}>
          Delete
        </button>
      </div>

      <Section title="Camera" accent={MAUVE}>
        <Field
          label="Scale"
          value={block.scale}
          min={1}
          max={6}
          step={0.05}
          suffix="×"
          onChange={(v) => update(id, { scale: v })}
        />

        {/* The target is a place on the frame, so it's picked on the frame. */}
        <Field2 label="Target" hint={block.followCursor ? "cursor" : "fixed"}>
          <button
            className={`toggle${block.followCursor ? " on" : ""}`}
            disabled={!hasCursor}
            onClick={() => update(id, { followCursor: !block.followCursor })}
          >
            <span className="toggle-knob" />
            <span>Follow the cursor</span>
          </button>

          {/* Why a control is unavailable belongs on the page, not in a
              tooltip the button is too disabled to show. */}
          {!hasCursor && (
            <p className="note">
              This clip has no cursor track, so there's nothing to follow. A
              finished video only shows a pointer — it doesn't record where it
              was. Only recordings made in the Motion desktop app carry one.
            </p>
          )}

          {hasCursor && block.followCursor && (
            <p className="note">The camera tracks the recorded pointer, smoothed.</p>
          )}

          {!block.followCursor &&
            (aimable ? (
              <p className="note">
                Aimed at {(block.target.x * 100).toFixed(0)}%,{" "}
                {(block.target.y * 100).toFixed(0)}%. Click anywhere on the
                preview to move it.
              </p>
            ) : (
              <>
                <p className="note">
                  Aimed at {(block.target.x * 100).toFixed(0)}%,{" "}
                  {(block.target.y * 100).toFixed(0)}%. The playhead is outside
                  this zoom, so clicking the preview would start a new one
                  instead of re-aiming this.
                </p>
                <button
                  className="wide-btn"
                  onClick={() => setPlayhead((block.start + block.end) / 2)}
                >
                  Move the playhead into this zoom
                </button>
              </>
            ))}
        </Field2>
      </Section>

      <Section title="Motion" accent={PEACH}>
        {/* Seeing the curve is the point: this app is about how movement
            feels, and a dropdown alone can't tell you that. */}
        <EaseCurve name={block.ease} bounce={block.bounce} />

        <div className="ease-picker">
          {EASE_NAMES.map((n) => (
            <button
              key={n}
              className={`ease-chip${block.ease === n ? " selected" : ""}`}
              onClick={() => update(id, { ease: n })}
            >
              {n}
            </button>
          ))}
        </div>

        {block.ease === "spring" && (
          <Field
            label="Bounce"
            value={block.bounce}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => update(id, { bounce: v })}
          />
        )}
        {chainedIn ? (
          <p className="note">
            The zoom before this one chains into it, so the camera arrives
            already held — this block has no ramp in.
          </p>
        ) : (
          <Field
            label="Ramp in"
            value={Math.min(block.rampIn, maxRamp)}
            min={0}
            max={maxRamp}
            step={0.05}
            suffix="s"
            onChange={(v) => update(id, { rampIn: v })}
          />
        )}
        {!chainedOut && (
          <Field
            label="Ramp out"
            value={Math.min(block.rampOut, maxRamp)}
            min={0}
            max={maxRamp}
            step={0.05}
            suffix="s"
            onChange={(v) => update(id, { rampOut: v })}
          />
        )}

        {/* The gap on the timeline is the transition, so the control that
            matters after chaining is the one you already have: drag the
            blocks. Saying so beats adding a duration field that fights it. */}
        <Field2
          label="Next shot"
          hint={chainedOut ? `${gap.toFixed(1)}s move` : next ? "releases" : "last"}
        >
          <button
            className={`toggle${block.chain ? " on" : ""}`}
            disabled={!next}
            onClick={() => update(id, { chain: !block.chain })}
            title={
              next
                ? "Go straight to the next zoom without pulling back"
                : "Nothing after this one to hand over to"
            }
          >
            <span className="toggle-knob" />
            <span>Chain to the next zoom</span>
          </button>
          <p className="note">
            {chainedOut
              ? `The camera moves straight to the next zoom over the ${gap.toFixed(1)}s gap between them. Drag either block to change how long that takes.`
              : next
                ? "The camera pulls back to full view before the next zoom starts."
                : "Chaining needs a zoom after this one."}
          </p>
        </Field2>
      </Section>

      <Section title="Apply" accent={TEAL} defaultOpen={false}>
        <button className="wide-btn" onClick={() => applyToAll(id)}>
          Use this zoom's feel everywhere
        </button>
        <button className="wide-btn" onClick={() => setPlayhead(block.start)}>
          Jump to start
        </button>
        <p className="note">
          Copies scale, easing, bounce and ramps onto every other zoom, and
          makes them the default for new ones.
        </p>
      </Section>
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
        <div>
          <h2>Clip</h2>
          <span className="panel-sub">
            {seg.srcStart.toFixed(2)}s → {seg.srcEnd.toFixed(2)}s of source
          </span>
        </div>
        <button
          className="ghost danger"
          onClick={() => remove(id)}
          disabled={count <= 1}
          title={count <= 1 ? "The timeline needs at least one clip" : "Delete this clip"}
        >
          Delete
        </button>
      </div>

      <Section title="Speed" accent={BLUE}>
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
        <Field
          label="Custom"
          value={seg.speed}
          min={0.25}
          max={8}
          step={0.05}
          suffix="×"
          onChange={(v) => setSpeed(id, v)}
        />
        <div className="stat-row">
          <div className="stat">
            <span className="stat-value">{segmentLength(seg).toFixed(2)}s</span>
            <span className="stat-label">On timeline</span>
          </div>
          <div className="stat">
            <span className="stat-value">{(seg.srcEnd - seg.srcStart).toFixed(2)}s</span>
            <span className="stat-label">Of source</span>
          </div>
        </div>
        <p className="note">
          Drag the clip's edges on the timeline to trim. Splitting never touches
          the source file.
        </p>
      </Section>
    </>
  );
}

/** A live miniature of the composition, so padding, radius and shadow are
 *  judged by looking rather than by reading three numbers. */
function FramePreview() {
  const doc = useStore((s) => s.doc);
  const f = doc.frame;

  return (
    <div className="frame-preview" style={{ background: backgroundCss(doc.background) }}>
      <div
        className="frame-preview-inner"
        style={{
          inset: `${Math.max(4, f.padding * 100)}%`,
          borderRadius: `${Math.max(2, f.radius / 3)}px`,
          boxShadow: `0 ${f.shadowY / 6}px ${f.shadowBlur / 5}px rgba(0,0,0,${f.shadowOpacity})`,
        }}
      />
    </div>
  );
}

/** What the crop keeps: a lit rectangle inside a dimmed source frame. The
 *  kept region is scaled to fill the frame, so this is exactly what you'll
 *  see on the stage — judging by eye rather than by four numbers. */
function CropPreview({ crop }: { crop: Crop }) {
  const left = crop.left * 100;
  const top = crop.top * 100;
  const w = Math.max(0.5, 100 - left - crop.right * 100);
  const h = Math.max(0.5, 100 - top - crop.bottom * 100);

  return (
    <div className="crop-preview">
      <div
        className="crop-preview-keep"
        style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
      />
    </div>
  );
}

const CROP_EDGES: { key: keyof Crop; label: string }[] = [
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
];

function CropPanel() {
  const doc = useStore((s) => s.doc);
  const patch = useStore((s) => s.patchDoc);
  const crop = doc.crop;
  const setEdge = (k: keyof Crop, v: number) => patch({ crop: { ...crop, [k]: v } });
  const active = crop.left + crop.right + crop.top + crop.bottom > 0;

  return (
    <Section title="Crop" accent={GREEN}>
      <CropPreview crop={crop} />
      <div className="crop-grid">
        {CROP_EDGES.map(({ key, label }) => (
          <Field
            key={key}
            label={label}
            value={crop[key] * 100}
            min={0}
            max={85}
            step={1}
            suffix="%"
            onChange={(v) => setEdge(key, v / 100)}
          />
        ))}
      </div>
      <button
        className="wide-btn"
        disabled={!active}
        onClick={() => patch({ crop: { top: 0, right: 0, bottom: 0, left: 0 } })}
      >
        Reset crop
      </button>
      <p className="note">
        Crops the edges off the recording — the kept region fills the frame.
        Like cutting the timeline, it never touches the source file, so you can
        undo your way back.
      </p>
    </Section>
  );
}

function ScenePanel() {
  const doc = useStore((s) => s.doc);
  const patch = useStore((s) => s.patchDoc);
  const hasCursor = (doc.clip?.cursor?.length ?? 0) > 0;
  const bg = doc.background;

  const setBg = (next: Background) => patch({ background: next });
  const setFrame = (k: keyof typeof doc.frame, v: number) =>
    patch({ frame: { ...doc.frame, [k]: v } });
  const setZoomDefault = <K extends keyof typeof doc.zoomDefaults>(
    k: K,
    v: (typeof doc.zoomDefaults)[K],
  ) => patch({ zoomDefaults: { ...doc.zoomDefaults, [k]: v } });
  const cursorStyle = doc.cursorStyle;
  const setCursor = <K extends keyof CursorStyle>(k: K, v: CursorStyle[K]) =>
    patch({ cursorStyle: { ...cursorStyle, [k]: v } });

  return (
    <>
      <div className="panel-head">
        <div>
          <h2>Scene</h2>
          <span className="panel-sub">
            {doc.output.width} × {doc.output.height}
          </span>
        </div>
      </div>

      <Section title="Backdrop" accent={BLUE}>
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

        <Field2 label="Custom">
          <div className="color-row">
            <select
              value={bg.kind}
              onChange={(e) => {
                const k = e.target.value;
                setBg(
                  k === "solid"
                    ? { kind: "solid", color: "#ECECEA" }
                    : k === "radial"
                      ? { kind: "radial", from: "#FFFFFF", to: "#DFE2E6" }
                      : { kind: "linear", from: "#F2F2F0", to: "#E2E2DF", angle: 120 },
                );
              }}
            >
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
              <option value="solid">Solid</option>
            </select>
            {bg.kind === "solid" ? (
              <input
                type="color"
                value={bg.color}
                onChange={(e) => setBg({ ...bg, color: e.target.value })}
              />
            ) : (
              <>
                <input
                  type="color"
                  value={bg.from}
                  onChange={(e) => setBg({ ...bg, from: e.target.value })}
                />
                <input
                  type="color"
                  value={bg.to}
                  onChange={(e) => setBg({ ...bg, to: e.target.value })}
                />
              </>
            )}
          </div>
        </Field2>

        {bg.kind === "linear" && (
          <Field
            label="Angle"
            value={bg.angle}
            min={0}
            max={360}
            step={1}
            suffix="°"
            onChange={(v) => setBg({ ...bg, angle: v })}
          />
        )}
      </Section>

      <Section title="Frame" accent={TEAL}>
        <FramePreview />
        <Field
          label="Padding"
          value={doc.frame.padding}
          min={0}
          max={0.2}
          step={0.005}
          onChange={(v) => setFrame("padding", v)}
        />
        <Field
          label="Radius"
          value={doc.frame.radius}
          min={0}
          max={64}
          step={1}
          onChange={(v) => setFrame("radius", v)}
        />
        <Field
          label="Shadow"
          value={doc.frame.shadowOpacity}
          min={0}
          max={0.6}
          step={0.01}
          onChange={(v) => setFrame("shadowOpacity", v)}
        />
        <Field
          label="Spread"
          value={doc.frame.shadowBlur}
          min={0}
          max={200}
          step={1}
          onChange={(v) => setFrame("shadowBlur", v)}
        />
      </Section>

      {doc.clip && <CropPanel />}

      <Section title="New zooms" accent={MAUVE}>
        <EaseCurve name={doc.zoomDefaults.ease} bounce={doc.zoomDefaults.bounce} />
        <div className="ease-picker">
          {EASE_NAMES.map((n) => (
            <button
              key={n}
              className={`ease-chip${doc.zoomDefaults.ease === n ? " selected" : ""}`}
              onClick={() => setZoomDefault("ease", n)}
            >
              {n}
            </button>
          ))}
        </div>
        <Field
          label="Scale"
          value={doc.zoomDefaults.scale}
          min={1}
          max={6}
          step={0.05}
          suffix="×"
          onChange={(v) => setZoomDefault("scale", v)}
        />
        <Field
          label="Length"
          value={doc.zoomDefaults.duration}
          min={1}
          max={12}
          step={0.1}
          suffix="s"
          onChange={(v) => setZoomDefault("duration", v)}
        />
        <Field
          label="Ramp"
          value={doc.zoomDefaults.ramp}
          min={0.1}
          max={4}
          step={0.05}
          suffix="s"
          onChange={(v) => setZoomDefault("ramp", v)}
        />
        {doc.zoomDefaults.ease === "spring" && (
          <Field
            label="Bounce"
            value={doc.zoomDefaults.bounce}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setZoomDefault("bounce", v)}
          />
        )}
        <p className="note">
          Ramp is how long the camera spends accelerating. Below about a second
          a push-in reads as a cut rather than a move.
        </p>
      </Section>

      {hasCursor && (
        <Section title="Cursor" accent={PEACH}>
          <Field
            label="Smoothing"
            value={doc.cursorSmoothing}
            min={0.02}
            max={1}
            step={0.02}
            suffix="s"
            onChange={(v) => patch({ cursorSmoothing: v })}
          />
          <p className="note">
            How much pointer jitter to average away — this drives both the
            overlay and any zoom that follows the cursor. Higher is calmer but
            lags fast movements.
          </p>

          <Field2 label="Overlay" hint={cursorStyle.enabled ? "on" : "off"}>
            <button
              className={`toggle${cursorStyle.enabled ? " on" : ""}`}
              onClick={() => setCursor("enabled", !cursorStyle.enabled)}
              title="Draw a glow and trail on the recorded pointer"
            >
              <span className="toggle-knob" />
              <span>Highlight the pointer</span>
            </button>
            <p className="note">
              The recording already contains the real pointer, so this draws
              behind it: a glow for where it is, a streak for where it came
              from.
            </p>
          </Field2>

          {cursorStyle.enabled && (
            <>
              <Field2 label="Tint">
                <div className="color-row">
                  <input
                    type="color"
                    value={cursorStyle.color}
                    onChange={(e) => setCursor("color", e.target.value)}
                  />
                </div>
              </Field2>
              <Field
                label="Glow"
                value={cursorStyle.highlightSize}
                min={0}
                max={0.2}
                step={0.005}
                onChange={(v) => setCursor("highlightSize", v)}
              />
              <Field
                label="Strength"
                value={cursorStyle.highlightOpacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setCursor("highlightOpacity", v)}
              />
              <Field
                label="Trail"
                value={cursorStyle.trail}
                min={0}
                max={1.5}
                step={0.05}
                suffix="s"
                onChange={(v) => setCursor("trail", v)}
              />
              <Field
                label="Thickness"
                value={cursorStyle.trailWidth}
                min={0.002}
                max={0.04}
                step={0.002}
                onChange={(v) => setCursor("trailWidth", v)}
              />
              <Field
                label="Fade"
                value={cursorStyle.trailOpacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setCursor("trailOpacity", v)}
              />
            </>
          )}
        </Section>
      )}
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
