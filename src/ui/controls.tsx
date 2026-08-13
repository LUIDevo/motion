import { useCallback, useEffect, useRef, useState } from "react";
import { ease } from "../render/easing";
import type { EaseName } from "../doc/types";

/**
 * A number you can drag.
 *
 * Sliders are good for exploring a range and bad for landing on a value. Every
 * serious tool lets you grab the number itself and scrub it, so that's what
 * this does — drag horizontally to change, or double-click to type. Holding
 * shift gives fine control, which matters when a step of 0.05 is still too
 * coarse to nail a feel.
 */
export function NumberScrub({
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const dragRef = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, v)),
    [min, max],
  );

  useEffect(() => {
    if (!dragRef.current) return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 2) d.moved = true;
      // A pixel of travel per step feels sluggish on fine steps and twitchy on
      // coarse ones; scaling by the range keeps the gesture consistent.
      const perPx = (max - min) / 240;
      const scale = e.shiftKey ? 0.15 : 1;
      const next = d.start + dx * perPx * scale;
      onChange(clamp(Math.round(next / step) * step));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  if (editing) {
    return (
      <input
        className="num-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = parseFloat(draft);
          if (!Number.isNaN(parsed)) onChange(clamp(parsed));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      className="num"
      title="Drag to adjust · double-click to type · hold shift for fine control"
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, start: value, moved: false };
        document.body.style.cursor = "ew-resize";
      }}
      onDoubleClick={() => {
        setDraft(value.toFixed(decimals));
        setEditing(true);
      }}
    >
      {value.toFixed(decimals)}
      {suffix && <span className="num-suffix">{suffix}</span>}
    </button>
  );
}

/**
 * A labelled control: name and value on one line, the track full width beneath.
 *
 * The old layout squeezed a slider into whatever was left after the label and
 * the number, so every track was short and none of them lined up. Giving the
 * track the full width makes the panel scannable — you can read the fill
 * levels down the column like a bar chart.
 */
export function Field({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        <NumberScrub
          value={value}
          min={min}
          max={max}
          step={step}
          suffix={suffix}
          onChange={onChange}
        />
      </div>
      <input
        className="field-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

/** A row for controls that aren't numeric — selects, toggles, colours. */
export function Field2({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * The easing curve, drawn.
 *
 * In an app whose entire job is how movement feels, describing a curve with
 * the word "spring" and a number is a missed opportunity — you should be able
 * to see the overshoot you're dialling in. The path is sampled from the same
 * function the renderer uses, so it cannot drift out of sync with the result.
 */
export function EaseCurve({ name, bounce }: { name: EaseName; bounce: number }) {
  const w = 260;
  const h = 62;
  const pad = 8;

  const samples: number[] = [];
  for (let i = 0; i <= 60; i++) samples.push(ease(name, i / 60, bounce));

  // Springs overshoot past 1, so the viewport has to grow to fit rather than
  // clipping the very thing you're trying to look at.
  const lo = Math.min(0, ...samples);
  const hi = Math.max(1, ...samples);
  const span = hi - lo || 1;

  const pts = samples.map((v, i) => {
    const x = pad + (i / 60) * (w - pad * 2);
    const y = h - pad - ((v - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const restY = h - pad - ((1 - lo) / span) * (h - pad * 2);

  return (
    <svg className="ease-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line
        x1={pad}
        y1={restY}
        x2={w - pad}
        y2={restY}
        className="ease-rest"
        strokeDasharray="3 4"
      />
      <polyline points={pts.join(" ")} className="ease-path" />
    </svg>
  );
}

/** A section that can be folded away. Panels get long; not every group is
 *  relevant at once. */
export function Section({
  title,
  children,
  defaultOpen = true,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`sec${open ? " open" : ""}`}>
      <button className="sec-head" onClick={() => setOpen((v) => !v)}>
        <span className="sec-dot" style={accent ? { background: accent } : undefined} />
        <span className="sec-title">{title}</span>
        <svg className="sec-chevron" viewBox="0 0 12 12" aria-hidden>
          <path
            d="M3 4.75 6 7.75 9 4.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && <div className="sec-body">{children}</div>}
    </div>
  );
}
