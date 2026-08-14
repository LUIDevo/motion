import { useStore } from "../doc/store";
import { docDuration } from "../doc/time";
import { Section } from "./controls";

/* The accent hues come from the active Catppuccin ramp, and the chips' soft
   backgrounds from per-theme tint variables in styles.css. */
const MAUVE = "var(--ctp-mauve)";
const TEAL = "var(--ctp-teal)";

const IconZoom = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="8" cy="8" r="4.6" />
    <path d="M11.4 11.4 15 15" strokeLinecap="round" />
    <path d="M8 6.2v3.6M6.2 8h3.6" strokeLinecap="round" />
  </svg>
);

const IconCursor = () => (
  <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden>
    <path d="M5 3.2a.6.6 0 0 1 .95-.48l8 5.9c.44.32.24 1.02-.3 1.06l-3.6.28-1.9 3.35a.6.6 0 0 1-1.12-.2z" />
  </svg>
);

const IconClick = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 3.2V1.8M9 16.2v-1.4M14.8 9h1.4M1.8 9h1.4" strokeLinecap="round" />
    <circle cx="9" cy="9" r="5.6" strokeDasharray="2 2.6" />
  </svg>
);

const IconText = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 5.2V4h10v1.2M9 4v10M6.8 14h4.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconBlur = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <rect x="3" y="3" width="12" height="12" rx="2.6" />
    <path d="M5.6 11.8 11.8 5.6M8.4 13.4l5-5" strokeLinecap="round" />
  </svg>
);

const EFFECTS = [
  {
    id: "zoom",
    name: "Zoom",
    desc: "Push the camera into a point",
    icon: <IconZoom />,
    tint: "var(--tint-mauve)",
    fg: "var(--ctp-mauve)",
    ready: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    desc: "Smoothed pointer and trails",
    icon: <IconCursor />,
    tint: "var(--tint-blue)",
    fg: "var(--ctp-blue)",
    ready: false,
  },
  {
    id: "click",
    name: "Click ripple",
    desc: "Highlight taps and presses",
    icon: <IconClick />,
    tint: "var(--tint-peach)",
    fg: "var(--ctp-peach)",
    ready: false,
  },
  {
    id: "text",
    name: "Text",
    desc: "Callouts and titles",
    icon: <IconText />,
    tint: "var(--tint-teal)",
    fg: "var(--ctp-teal)",
    ready: false,
  },
  {
    id: "blur",
    name: "Blur region",
    desc: "Redact keys and names",
    icon: <IconBlur />,
    tint: "var(--tint-green)",
    fg: "var(--ctp-green)",
    ready: false,
  },
];

export default function Library() {
  const blocks = useStore((s) => s.doc.blocks);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const clip = useStore((s) => s.doc.clip);
  const playhead = useStore((s) => s.playhead);
  const duration = useStore((s) => docDuration(s.doc));
  const addZoom = useStore((s) => s.addZoom);
  const removeBlock = useStore((s) => s.removeBlock);

  return (
    <aside className="panel library">
      <div className="panel-head">
        <div>
          <h2>Effects</h2>
          <span className="panel-sub">
            {clip ? "Click one to add it at the playhead" : "Import or record to begin"}
          </span>
        </div>
      </div>

      <Section title="Library" accent={MAUVE}>
        <div className="effect-list">
          {EFFECTS.map((e) => (
            <button
              key={e.id}
              className={`effect${e.ready ? "" : " soon-card"}`}
              disabled={!e.ready || !clip}
              onClick={() => addZoom(playhead, { x: 0.5, y: 0.5 })}
              title={e.ready ? `Add a ${e.name.toLowerCase()}` : "Not built yet"}
            >
              {/* A tinted icon chip per effect: colour is what makes a list of
                  five similar cards scannable at a glance. */}
              <span
                className="effect-icon"
                style={{ background: e.tint, color: e.fg }}
              >
                {e.icon}
              </span>
              <span className="effect-body">
                <span className="effect-name">
                  {e.name}
                  {!e.ready && <span className="soon">soon</span>}
                </span>
                <span className="effect-desc">{e.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Layers · ${blocks.length}`} accent={TEAL}>
        {blocks.length === 0 ? (
          <p className="empty">
            No camera moves yet. Scrub the timeline and click the preview to
            place one.
          </p>
        ) : (
          <ul className="layer-list">
            {blocks.map((b, i) => {
              const left = duration > 0 ? (b.start / duration) * 100 : 0;
              const width = duration > 0 ? ((b.end - b.start) / duration) * 100 : 0;
              return (
                <li key={b.id}>
                  <button
                    className={`layer${b.id === selectedId ? " selected" : ""}`}
                    onClick={() => {
                      select(b.id);
                      setPlayhead((b.start + b.end) / 2);
                    }}
                  >
                    <span className="layer-top">
                      <span className="layer-name">Zoom {i + 1}</span>
                      <span className="layer-meta">
                        {b.scale.toFixed(1)}×{b.followCursor && " · follow"}
                      </span>
                      <span
                        className="layer-del"
                        title="Delete"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          removeBlock(b.id);
                        }}
                      >
                        ×
                      </span>
                    </span>
                    {/* Where this move sits in the whole piece, at a glance. */}
                    <span className="layer-track">
                      <span
                        className="layer-span"
                        style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </aside>
  );
}
