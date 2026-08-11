import { useStore } from "../doc/store";
import { fmtTime } from "./format";

const EFFECTS = [
  { id: "zoom", name: "Zoom", desc: "Push the camera into a point", ready: true },
  { id: "cursor", name: "Cursor", desc: "Smoothed pointer, needs the recorder", ready: false },
  { id: "click", name: "Click ripple", desc: "Highlight taps, needs the recorder", ready: false },
  { id: "text", name: "Text", desc: "Callouts and titles", ready: false },
  { id: "blur", name: "Blur region", desc: "Redact keys and names", ready: false },
];

export default function Library() {
  const blocks = useStore((s) => s.doc.blocks);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const clip = useStore((s) => s.doc.clip);
  const playhead = useStore((s) => s.playhead);
  const addZoom = useStore((s) => s.addZoom);

  return (
    <aside className="panel library">
      <div className="section">
        <div className="section-title">Effects</div>
        {EFFECTS.map((e) => (
          <button
            key={e.id}
            className={`effect${e.ready ? "" : " disabled"}`}
            disabled={!e.ready || !clip}
            onClick={() => addZoom(playhead, { x: 0.5, y: 0.5 })}
          >
            <span className="effect-name">
              {e.name}
              {e.ready ? null : <span className="soon">soon</span>}
            </span>
            <span className="effect-desc">{e.desc}</span>
          </button>
        ))}
      </div>

      <div className="section grow">
        <div className="section-title">Layers</div>
        {blocks.length === 0 ? (
          <p className="note">No camera moves yet.</p>
        ) : (
          <ul className="layer-list">
            {blocks.map((b, i) => (
              <li key={b.id}>
                <button
                  className={`layer${b.id === selectedId ? " selected" : ""}`}
                  onClick={() => {
                    select(b.id);
                    setPlayhead((b.start + b.end) / 2);
                  }}
                >
                  <span className="layer-name">Zoom {i + 1}</span>
                  <span className="layer-meta">
                    {b.scale.toFixed(1)}× · {fmtTime(b.start).slice(0, -3)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
