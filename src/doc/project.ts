import type {
  Background,
  Block,
  Clip,
  Crop,
  CursorSample,
  CursorStyle,
  Doc,
  EaseName,
  FrameStyle,
  Segment,
  ZoomBlock,
  ZoomDefaults,
} from "./types";
import { emptyDoc } from "./store";

/**
 * Project files — the document on disk.
 *
 * A project is the Doc plus the file format's version. The two are kept
 * apart because a format can move (new fields, reshaped structures) without
 * the in-memory document changing at the same time; the version ladder below
 * is where those steps land.
 *
 * Two rules keep files portable:
 *
 *  - `clip.src` is never persisted. It is a runtime handle (blob: in the
 *    browser, asset:// under Tauri) that means nothing on another machine.
 *    `clip.path` is persisted instead, and parseProject hands it back so the
 *    caller can relink the handle after load.
 *
 *  - Reading is tolerant, not exact. Every field that may be absent from an
 *    older file is filled with the default the editor would have created it
 *    with. The schema has already moved several times — cursorSmoothing,
 *    then ZoomBlock.bounce, then cursorStyle, ZoomBlock.chain, and crop —
 *    and it will keep moving, so a file must never be rejected for missing
 *    a field it predates.
 *
 * Pure functions: no I/O, no UI, no store access beyond the defaults. The
 * caller owns files and paths.
 */

export interface ProjectFile {
  version: 1;
  doc: Doc;
}

const FILE_VERSION = 1 as const;
/** Highest format this build can read. Bump when a migration is added. */
const LATEST_VERSION = 1;

const EASE_NAMES: readonly EaseName[] = [
  "linear",
  "easeInOut",
  "easeOut",
  "easeIn",
  "spring",
];
const BG_KINDS = ["solid", "linear", "radial"] as const;

const isEase = (v: unknown): v is EaseName =>
  typeof v === "string" && (EASE_NAMES as readonly string[]).includes(v);
const isBgKind = (v: unknown): v is Background["kind"] =>
  typeof v === "string" && (BG_KINDS as readonly string[]).includes(v);

/** Fallback ids, only for hand-edited files that lost them. */
const uid = () => Math.random().toString(36).slice(2, 10);

/* Values from files are trusted only when finite. Anything else gets the
   default, clamped to a sensible range so a mangled file can't produce a
   document that breaks rendering (negative padding, off-frame targets,
   overlapping ramps, ...). */
const num = (v: unknown, dflt: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.min(max, Math.max(min, n));
};
const str = (v: unknown, dflt = ""): string => (typeof v === "string" ? v : dflt);
const bool = (v: unknown, dflt = false): boolean => (typeof v === "boolean" ? v : dflt);

/**
 * Serialise a document for disk. `clip.src` is stripped — it is a runtime
 * handle, not a project property — and the file is pretty-printed so diffs
 * in git stay readable. The input document is not mutated.
 */
export function serializeDoc(doc: Doc): string {
  const file: ProjectFile = {
    version: FILE_VERSION,
    doc: {
      ...doc,
      clip: doc.clip ? { ...doc.clip, src: "" } : null,
    },
  };
  return JSON.stringify(file, null, 2) + "\n";
}

/**
 * Read a project file. Throws if the text is not a project: bad JSON, a
 * non-object shape, a missing or unknown version, or no document inside.
 *
 * Returns the document (fully migrated, `clip.src` always "") plus the
 * persisted source path — null when the project has no clip — so the caller
 * can relink the video handle before anything renders.
 */
export function parseProject(text: string): { doc: Doc; sourcePath: string | null } {
  const clean = text.replace(/^\uFEFF/, ""); // tolerate editor-added BOMs
  let raw: unknown;
  try {
    raw = JSON.parse(clean);
  } catch (err) {
    throw new Error("Not a project file: invalid JSON", { cause: err });
  }

  const doc = migrate(raw);
  return { doc, sourcePath: doc.clip?.path ?? null };
}

/**
 * Format upgrades, keyed by the version they upgrade *from*. parseProject
 * walks the ladder from the file's version up to LATEST_VERSION. Empty until
 * version 2 exists; this is the scaffold that lets the schema keep moving
 * without touching the field-filling code below.
 */
const MIGRATIONS: Record<number, (doc: Doc) => Doc> = {};

function migrate(raw: unknown): Doc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Not a project file: expected an object");
  }
  const file = raw as Record<string, unknown>;

  const version = file.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Not a project file: missing or invalid version");
  }
  if (version > LATEST_VERSION) {
    throw new Error(
      `Project version ${version} is newer than this build supports (${LATEST_VERSION}); update Motion to open it`,
    );
  }
  if (typeof file.doc !== "object" || file.doc === null) {
    throw new Error("Not a project file: no document inside");
  }

  let doc = fillDoc(file.doc);
  for (let v = version; v < LATEST_VERSION; v++) {
    doc = MIGRATIONS[v](doc);
  }
  return doc;
}

/* ------------------------------------------------------------------ */
/* Version 1 field filling. Every absent field gets a default, every   */
/* present field is kept (coerced to the right shape).                 */
/* ------------------------------------------------------------------ */

function fillDoc(raw: unknown): Doc {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const d = emptyDoc(); // defaults for whatever the file predates

  return {
    version: 1,
    output: fillOutput(r.output, d.output),
    clip: fillClip(r.clip),
    segments: fillSegments(r.segments),
    crop: fillCrop(r.crop, d.crop),
    background: fillBackground(r.background, d.background),
    frame: fillFrame(r.frame, d.frame),
    blocks: fillBlocks(r.blocks),
    zoomDefaults: fillZoomDefaults(r.zoomDefaults, d.zoomDefaults),
    cursorStyle: fillCursorStyle(r.cursorStyle, d.cursorStyle),
    cursorSmoothing: num(r.cursorSmoothing, d.cursorSmoothing, 0, 1),
  };
}

function fillOutput(raw: unknown, dflt: Doc["output"]): Doc["output"] {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    width: num(r.width, dflt.width, 1),
    height: num(r.height, dflt.height, 1),
  };
}

function fillClip(raw: unknown): Clip | null {
  if (raw === null || raw === undefined) return null;
  const r = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    src: "", // never persisted; the caller relinks from path
    path: str(r.path) || null,
    name: str(r.name, "Recording"),
    proxied: bool(r.proxied),
    cursor: fillCursorSamples(r.cursor),
    duration: num(r.duration, 0, 0),
    width: num(r.width, 0, 1),
    height: num(r.height, 0, 1),
  };
}

/** The cursor track must stay time-ordered or a follow-cursor camera jumps. */
function fillCursorSamples(raw: unknown): CursorSample[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((s) => {
      const r = (typeof s === "object" && s !== null ? s : {}) as Record<
        string,
        unknown
      >;
      return {
        t: num(r.t, 0, 0),
        x: num(r.x, 0, 0),
        y: num(r.y, 0, 0),
      };
    })
    .sort((a, b) => a.t - b.t);
}

function fillSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const r = (typeof s === "object" && s !== null ? s : {}) as Record<
        string,
        unknown
      >;
      const srcStart = num(r.srcStart, 0, 0);
      const srcEnd = num(r.srcEnd, srcStart + 1, srcStart);
      return {
        id: str(r.id) || uid(),
        srcStart,
        srcEnd,
        // Floor matches time.ts's own guard: below this, segmentLength would
        // treat the segment as frozen.
        speed: num(r.speed, 1, 0.05, 8),
      };
    })
    .filter((s) => s.srcEnd > s.srcStart); // zero-length segments are noise
}

/** Kept region is 0..1 of the source frame per edge; negative or overflowing
 *  edges are clamped so the crop can never invert the frame. */
function fillCrop(raw: unknown, dflt: Crop): Crop {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    top: num(r.top, dflt.top, 0, 1),
    right: num(r.right, dflt.right, 0, 1),
    bottom: num(r.bottom, dflt.bottom, 0, 1),
    left: num(r.left, dflt.left, 0, 1),
  };
}

function fillBackground(raw: unknown, dflt: Background): Background {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const kind = isBgKind(r.kind) ? r.kind : "linear";
  switch (kind) {
    case "solid":
      return { kind, color: str(r.color, "#ECECEA") };
    case "radial":
      return { kind, from: str(r.from, "#FFFFFF"), to: str(r.to, "#DFE2E6") };
    default:
      return {
        kind: "linear",
        from: str(r.from, dflt.kind === "linear" ? dflt.from : "#F2F2F0"),
        to: str(r.to, dflt.kind === "linear" ? dflt.to : "#E2E2DF"),
        angle: num(r.angle, dflt.kind === "linear" ? dflt.angle : 120, 0, 360),
      };
  }
}

function fillFrame(raw: unknown, dflt: FrameStyle): FrameStyle {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    padding: num(r.padding, dflt.padding, 0, 0.5),
    radius: num(r.radius, dflt.radius, 0),
    shadowBlur: num(r.shadowBlur, dflt.shadowBlur, 0),
    shadowOpacity: num(r.shadowOpacity, dflt.shadowOpacity, 0, 1),
    shadowY: num(r.shadowY, dflt.shadowY, 0),
  };
}

function fillZoomDefaults(raw: unknown, dflt: ZoomDefaults): ZoomDefaults {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    scale: num(r.scale, dflt.scale, 1),
    duration: num(r.duration, dflt.duration, 0),
    ramp: num(r.ramp, dflt.ramp, 0),
    ease: isEase(r.ease) ? r.ease : dflt.ease,
    bounce: num(r.bounce, dflt.bounce, 0, 1),
  };
}

function fillCursorStyle(raw: unknown, dflt: CursorStyle): CursorStyle {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: bool(r.enabled, dflt.enabled),
    highlightSize: num(r.highlightSize, dflt.highlightSize, 0),
    highlightOpacity: num(r.highlightOpacity, dflt.highlightOpacity, 0, 1),
    color: str(r.color, dflt.color),
    trail: num(r.trail, dflt.trail, 0),
    trailWidth: num(r.trailWidth, dflt.trailWidth, 0),
    trailOpacity: num(r.trailOpacity, dflt.trailOpacity, 0, 1),
  };
}

/**
 * Blocks get defaults that keep them renderable: ramps are clamped to half
 * the block so they can't overlap, scale stays >= 1, targets stay on the
 * frame, and the fields added after blocks first existed (ease, bounce,
 * followCursor, chain) default to the editor's own feel — spring, like
 * zoomDefaults.
 */
function fillBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      const r = (typeof b === "object" && b !== null ? b : {}) as Record<
        string,
        unknown
      >;
      const start = num(r.start, 0, 0);
      const end = num(r.end, start + 1, start);
      const half = Math.max(0, end - start) / 2;
      const target = (typeof r.target === "object" && r.target !== null
        ? r.target
        : {}) as Record<string, unknown>;

      return {
        id: str(r.id) || uid(),
        kind: "zoom" as const,
        start,
        end,
        rampIn: Math.min(num(r.rampIn, 0.5, 0), half),
        rampOut: Math.min(num(r.rampOut, 0.5, 0), half),
        scale: num(r.scale, 1.5, 1),
        target: {
          x: num(target.x, 0.5, 0, 1),
          y: num(target.y, 0.5, 0, 1),
        },
        ease: isEase(r.ease) ? r.ease : "spring",
        bounce: num(r.bounce, 0.3, 0, 1),
        followCursor: bool(r.followCursor),
        chain: bool(r.chain),
      } satisfies ZoomBlock;
    })
    .filter((b) => b.end > b.start) // zero-length blocks are noise
    .sort((a, b) => a.start - b.start);
}
