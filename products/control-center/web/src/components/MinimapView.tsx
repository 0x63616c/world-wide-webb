/**
 * MinimapView , pure presentational minimap.
 *
 * Accepts pre-computed layout props (world dimensions, tile rects, viewport
 * rect, optional hover label, visibility flag) and renders the minimap DOM
 * exactly as Minimap does , no hooks, no event handlers, no window listeners.
 * All interaction state lives in the Minimap container and is passed in.
 */

// Outer pad around the world area. Must match Minimap.tsx.
const MINIMAP_PAD = 6;

export type MinimapRect = { x: number; y: number; w: number; h: number };
export type MinimapLabelledRect = MinimapRect & { label: string };

export interface MinimapViewProps {
  /** Scaled width of the world area (WORLD_W * SCALE). */
  worldViewW: number;
  /** Scaled height of the world area (WORLD_H * SCALE). */
  worldViewH: number;
  /** SCALE factor (MAX_EXTENT / max(WORLD_W, WORLD_H)). */
  scale: number;
  /** Real tile rects (world coords). Rendered as faint blocks. */
  tiles: MinimapLabelledRect[];
  /** Decorative placeholder rects. Rendered fainter than real tiles. */
  ghosts?: MinimapRect[];
  /** The current viewport rect (world coords). Rendered as the bright indicator. */
  viewportRect: MinimapRect;
  /** Label to show floating to the right of the minimap (hover tile name). */
  hoveredLabel?: string | null;
  /** When true the outer container is opaque; when false it is transparent. */
  shown: boolean;
  // Pointer handlers forwarded from the container so MinimapView participates
  // in the interaction without owning any state.
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerEnter?: React.PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
  /** Ref forwarded to the world area so the container can map screen→world coords. */
  worldAreaRef?: React.RefObject<HTMLDivElement | null>;
}

// MINIMAP_TOP / MINIMAP_LEFT match the constants exported from Minimap.tsx.
const VIEW_TOP = 12;

export function MinimapView({
  worldViewW,
  worldViewH,
  scale,
  tiles,
  ghosts = [],
  viewportRect,
  hoveredLabel,
  shown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  worldAreaRef,
}: MinimapViewProps) {
  return (
    <div
      aria-hidden
      data-testid="minimap-root"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        position: "absolute",
        top: VIEW_TOP,
        left: 12,
        padding: MINIMAP_PAD,
        background: "rgba(12, 14, 17, 0.82)",
        border: "1px solid var(--hair)",
        borderRadius: 10,
        backdropFilter: "blur(6px)",
        opacity: shown ? 1 : 0,
        transition: "opacity 0.4s ease",
        pointerEvents: "auto",
        cursor: "pointer",
        touchAction: "none",
      }}
    >
      {/* Tile name for whatever the cursor is over, floated to the right of the map. */}
      {hoveredLabel && (
        <div
          data-testid="minimap-label"
          style={{
            position: "absolute",
            left: "100%",
            top: 6,
            marginLeft: 6,
            padding: "3px 8px",
            background: "rgba(12, 14, 17, 0.92)",
            border: "1px solid var(--hair-2)",
            borderRadius: 6,
            fontFamily: "var(--ui)",
            fontSize: 11,
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {hoveredLabel}
        </div>
      )}
      <div
        ref={worldAreaRef}
        data-testid="minimap-world"
        style={{
          position: "relative",
          width: worldViewW,
          height: worldViewH,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {/* Decorative placeholder halo, drawn first and fainter than real tiles. */}
        {ghosts.map((r) => (
          <div
            key={`g${r.x},${r.y}`}
            style={{
              position: "absolute",
              left: r.x * scale,
              top: r.y * scale,
              width: r.w * scale,
              height: r.h * scale,
              background: "var(--ink-3)",
              opacity: 0.4,
              borderRadius: 1,
            }}
          />
        ))}
        {/* "Everything" , each tile as a faint block. */}
        {tiles.map((r) => (
          <div
            key={`${r.x},${r.y}`}
            style={{
              position: "absolute",
              left: r.x * scale,
              top: r.y * scale,
              width: r.w * scale,
              height: r.h * scale,
              background: "var(--ink-3)",
              borderRadius: 1,
            }}
          />
        ))}
        {/* The current viewport, proportionally placed within the world. */}
        <div
          data-testid="minimap-viewport"
          style={{
            position: "absolute",
            left: viewportRect.x * scale,
            top: viewportRect.y * scale,
            width: viewportRect.w * scale,
            height: viewportRect.h * scale,
            border: "1px solid var(--acc)",
            background: "var(--acc-dim)",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
// Export the constants so stories/tests can build valid props easily.
