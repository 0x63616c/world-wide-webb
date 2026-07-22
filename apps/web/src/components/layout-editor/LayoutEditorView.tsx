/**
 * LayoutEditorView , pure presentational drag-and-drop board layout editor.
 * Stages nothing itself: every tile position it renders comes straight from
 * `tiles` (props), and a legal drop is reported via `onMove` for the caller to
 * apply , this view never mutates its own copy of the arrangement.
 *
 * Camera: fit-to-cluster (every tile's bbox + a fixed cell margin), recomputed
 * only when `tiles` changes , which happens on a committed drop, never mid-drag
 * (drag offsets are pure local view state, see `drag` below). No panning: the
 * camera always shows the whole arrangement, so there is nothing to pan to.
 *
 * Drag: pointer capture on the tile wrapper, live offset tracked in world px
 * (screen px ÷ scale) so it stays lattice-accurate regardless of zoom, snapped
 * to the nearest cell pitch on release. An overlapping drop is simply never
 * committed (`onMove` doesn't fire) , the wrapper's own position resets to its
 * pre-drag `tiles`-derived spot and a CSS transition animates the spring-back.
 */
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BOARD_H, BOARD_W, WALL_THICKNESS, worldCellRect } from "../../lib/grid-constants";
import { bentoFor } from "../../lib/placeholder-tiles";
import type { TileRegistryEntry } from "../../lib/tile-registry";
import { PlaceholderTile } from "../PlaceholderTile";

export type LayoutEditorTile = TileRegistryEntry & { worldCol: number; worldRow: number };

export type LayoutEditorViewProps = {
  tiles: LayoutEditorTile[];
  renderTile: (entry: LayoutEditorTile) => ReactNode;
  onMove: (tileId: string, col: number, row: number) => void;
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  valid: boolean;
  invalidReason: string | null;
  dirty: boolean;
};

// Fallback frame: the fixed wall-panel size (see CLAUDE.md invariant: "Fixed
// wall panel, 1366x1024, not responsive"). The stage itself fills whatever
// viewport it's given (a desktop browser is often larger) and the camera fits
// against the MEASURED size; these are only the pre-measure / jsdom fallback.
const FRAME_W = 1366;
const FRAME_H = 1024;
// Cell margin added around the cluster bbox before fitting the camera.
const FIT_MARGIN_CELLS = 2;
const MAX_SCALE = 0.8;
// Horizontal/vertical px budget subtracted from the frame before fitting , 16px
// each side horizontally, and headroom at the bottom for the edit bar.
const FIT_PAD_X = 32;
const FIT_PAD_Y = 120;

// Bounds where a tile may be dropped: the inner world, wall ring excluded.
const WORLD_SIZE = 64;

// Lattice pitch in world px (cell + gap), derived from two 1x1 rects so the
// drag-snap math always matches worldCellRect's own pitch rather than a
// hand-copied constant.
const CELL_A = worldCellRect(0, 0, 1, 1);
const CELL_B = worldCellRect(1, 0, 1, 1);
const PITCH = CELL_B.x - CELL_A.x;

type Rect4 = { col: number; row: number; cols: number; rows: number };

function overlapsRect(a: Rect4, b: Rect4): boolean {
  return (
    a.col < b.col + b.cols &&
    b.col < a.col + a.cols &&
    a.row < b.row + b.rows &&
    b.row < a.row + a.rows
  );
}

function clampToInner(value: number, span: number): number {
  return Math.max(WALL_THICKNESS, Math.min(WORLD_SIZE - WALL_THICKNESS - span, value));
}

type DragState = { id: string; startX: number; startY: number; dx: number; dy: number };

type Camera = { bx: number; by: number; scale: number; offsetX: number; offsetY: number };

type Frame = { w: number; h: number };

// Fit-to-cluster camera: bbox of every tile + FIT_MARGIN_CELLS, scaled to fit
// the frame (minus edit-bar/edge padding), capped at MAX_SCALE, then centered.
function fitCamera(tiles: LayoutEditorTile[], frame: Frame): Camera {
  const rects = tiles.map((t) => worldCellRect(t.worldCol, t.worldRow, t.cols, t.rows));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const marginPx = FIT_MARGIN_CELLS * PITCH;
  const bx = minX - marginPx;
  const by = minY - marginPx;
  const bw = maxX - minX + 2 * marginPx;
  const bh = maxY - minY + 2 * marginPx;
  const scale = Math.min((frame.w - FIT_PAD_X) / bw, (frame.h - FIT_PAD_Y) / bh, MAX_SCALE);
  const offsetX = (frame.w - bw * scale) / 2;
  const offsetY = (frame.h - FIT_PAD_Y - bh * scale) / 2;
  return { bx, by, scale, offsetX, offsetY };
}

export function LayoutEditorView({
  tiles,
  renderTile,
  onMove,
  onReset,
  onCancel,
  onSave,
  saving,
  valid,
  invalidReason,
  dirty,
}: LayoutEditorViewProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Imperative mirror of `drag`, read inside the pointer handlers so a rapid
  // move/up pair never races a stale closure over React state.
  const dragRef = useRef<DragState | null>(null);

  // The stage fills its (fixed, inset: 0) parent, so on a desktop browser it
  // can be larger than the wall panel. Fit the camera against the measured
  // size; jsdom (and the pre-measure first paint) fall back to the panel frame.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<Frame>({ w: FRAME_W, h: FRAME_H });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setFrame({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refit ONLY when the committed arrangement (or the viewport) changes , never
  // mid-drag, since drag offsets live purely in `drag`/`dragRef`, not `tiles`.
  const camera = useMemo(() => fitCamera(tiles, frame), [tiles, frame]);

  const toScreen = (wx: number, wy: number) => ({
    x: camera.offsetX + (wx - camera.bx) * camera.scale,
    y: camera.offsetY + (wy - camera.by) * camera.scale,
  });

  // Dimmed live bento fill behind the real tiles. Regenerates with every
  // committed arrangement; null while the current tiles can't be tiled (a
  // 1-cell slit or overlap), so the fill layer simply omits itself , the
  // invalid-reason line (owned by the caller's `valid`/`invalidReason`) is the
  // feedback for that state, not a broken fill render.
  const fill = useMemo(() => {
    try {
      return bentoFor(
        tiles.map((t) => ({ col: t.worldCol, row: t.worldRow, cols: t.cols, rows: t.rows })),
      );
    } catch {
      return null;
    }
  }, [tiles]);

  // At-rest dashed frame: the live board's own viewport, centered on the
  // CURRENT clock tile (the clock is movable like any other tile, no pin).
  const clock = tiles.find((t) => t.home) ?? tiles[0];
  const clockRect = clock
    ? worldCellRect(clock.worldCol, clock.worldRow, clock.cols, clock.rows)
    : null;
  const restFrame = clockRect
    ? {
        x: clockRect.x + clockRect.w / 2 - BOARD_W / 2,
        y: clockRect.y + clockRect.h / 2 - BOARD_H / 2,
        w: BOARD_W,
        h: BOARD_H,
      }
    : null;

  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Best-effort: a synthetic pointerId isn't always eligible for capture
    // (e.g. in tests), and losing capture only means a fast real drag can
    // outrun the wrapper , the move/up handlers on the stage still work via
    // normal bubbling for the common case.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignored , see comment above
    }
    const state: DragState = { id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 };
    dragRef.current = state;
    setDrag(state);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next: DragState = {
      ...d,
      dx: (e.clientX - d.startX) / camera.scale,
      dy: (e.clientY - d.startY) / camera.scale,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const tile = tiles.find((t) => t.id === d.id);
    if (!tile) return;
    const dc = Math.round(d.dx / PITCH);
    const dr = Math.round(d.dy / PITCH);
    if (dc === 0 && dr === 0) return; // no movement , nothing to commit
    const nextCol = clampToInner(tile.worldCol + dc, tile.cols);
    const nextRow = clampToInner(tile.worldRow + dr, tile.rows);
    const candidate: Rect4 = { col: nextCol, row: nextRow, cols: tile.cols, rows: tile.rows };
    const collides = tiles.some(
      (other) =>
        other.id !== tile.id &&
        overlapsRect(candidate, {
          col: other.worldCol,
          row: other.worldRow,
          cols: other.cols,
          rows: other.rows,
        }),
    );
    if (collides) return; // spring back , drop not committed, onMove does not fire
    onMove(tile.id, nextCol, nextRow);
  };

  return (
    <div
      ref={stageRef}
      data-testid="layout-editor-stage"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
        userSelect: "none",
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {fill?.map((p) => {
        const r = worldCellRect(p.col, p.row, p.cols, p.rows);
        const s = toScreen(r.x, r.y);
        return (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: s.x,
              top: s.y,
              width: r.w * camera.scale,
              height: r.h * camera.scale,
              opacity: 0.5,
              pointerEvents: "none",
            }}
          >
            <PlaceholderTile />
          </div>
        );
      })}

      {restFrame
        ? (() => {
            const s = toScreen(restFrame.x, restFrame.y);
            return (
              <div
                data-testid="layout-editor-rest-frame"
                style={{
                  position: "absolute",
                  left: s.x,
                  top: s.y,
                  width: restFrame.w * camera.scale,
                  height: restFrame.h * camera.scale,
                  border: "2px dashed rgba(245,196,81,0.5)",
                  borderRadius: 8,
                  pointerEvents: "none",
                  zIndex: 3,
                }}
              />
            );
          })()
        : null}

      {tiles.map((t) => {
        const r = worldCellRect(t.worldCol, t.worldRow, t.cols, t.rows);
        const dragging = drag?.id === t.id;
        const wx = r.x + (dragging && drag ? drag.dx : 0);
        const wy = r.y + (dragging && drag ? drag.dy : 0);
        const s = toScreen(wx, wy);
        const innerStyle: CSSProperties = {
          width: r.w,
          height: r.h,
          transform: `scale(${camera.scale})`,
          transformOrigin: "top left",
          display: "flex",
          flexDirection: "column",
          // Inert: drags must never hit a tile's own interactive controls.
          pointerEvents: "none",
        };
        return (
          <div
            key={t.id}
            data-testid={`layout-tile-${t.id}`}
            onPointerDown={onPointerDown(t.id)}
            style={{
              position: "absolute",
              left: s.x,
              top: s.y,
              width: r.w * camera.scale,
              height: r.h * camera.scale,
              cursor: dragging ? "grabbing" : "grab",
              zIndex: dragging ? 10 : 2,
              touchAction: "none",
              // No transition while actively dragging (live 1:1 tracking); once
              // released, any residual offset (a spring-back) eases out.
              transition: dragging ? "none" : "left 150ms ease, top 150ms ease",
              boxShadow: dragging ? "0 12px 40px rgba(0,0,0,0.6)" : undefined,
              borderRadius: 10,
            }}
          >
            <div style={innerStyle}>{renderTile(t)}</div>
          </div>
        );
      })}

      <EditBar
        onReset={onReset}
        onCancel={onCancel}
        onSave={onSave}
        saving={saving}
        valid={valid}
        dirty={dirty}
        invalidReason={invalidReason}
      />
    </div>
  );
}

function EditBar({
  onReset,
  onCancel,
  onSave,
  saving,
  valid,
  dirty,
  invalidReason,
}: {
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  valid: boolean;
  dirty: boolean;
  invalidReason: string | null;
}) {
  const saveDisabled = !valid || !dirty || saving;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 72,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        background: "var(--nest, rgba(20,22,26,0.92))",
        borderTop: "1px solid var(--hair, rgba(255,255,255,0.1))",
        zIndex: 20,
      }}
    >
      <BarButton onClick={onReset} disabled={saving} testId="layout-editor-reset">
        Reset to default
      </BarButton>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {!valid && invalidReason ? (
          <span
            data-testid="layout-editor-invalid-reason"
            style={{ fontFamily: "var(--ui)", fontSize: 13, color: "var(--danger, #ff5470)" }}
          >
            {invalidReason}
          </span>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <BarButton onClick={onCancel} disabled={saving} testId="layout-editor-cancel">
            Cancel
          </BarButton>
          <BarButton onClick={onSave} disabled={saveDisabled} primary testId="layout-editor-save">
            {saving ? "Saving…" : "Save"}
          </BarButton>
        </div>
      </div>
    </div>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
  primary,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 40,
        padding: "0 18px",
        background: primary ? "var(--accent, #f5c451)" : "var(--nest, rgba(255,255,255,0.06))",
        border: primary ? "1px solid transparent" : "1px solid var(--hair, rgba(255,255,255,0.15))",
        borderRadius: 8,
        fontFamily: "var(--ui)",
        fontSize: 14,
        fontWeight: primary ? 600 : 500,
        color: primary ? "#14161a" : "var(--ink-2, #e8edf2)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
