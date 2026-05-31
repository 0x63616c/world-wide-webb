/**
 * ControlsTileView — pure presentational layer for the Controls tile.
 * All data and callbacks come in as props; no trpc or hooks inside.
 */

import { ControlTap, Skeleton, Tile, TileHeader } from "../ui";

// ─── types ────────────────────────────────────────────────────────────────────

export type ControlKey = "lamps" | "lights" | "fan";

export interface ControlEntry {
  on: boolean;
  sub?: string;
  pending?: boolean;
}

export interface ControlsViewData {
  lamps: ControlEntry;
  lights: ControlEntry;
  fan: ControlEntry;
}

export type ControlsTileViewProps =
  | { status: "loading" }
  | { status: "error"; error?: string }
  | {
      status: "populated";
      data: ControlsViewData;
      onToggle: (key: ControlKey, currentOn: boolean) => void;
    };

// ─── ControlsGridView — renders real tap cells ────────────────────────────────

interface ControlsGridViewProps {
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
}

export function ControlsGridView({ data, onToggle }: ControlsGridViewProps) {
  return (
    <>
      <ControlTap
        icon="lamp"
        label="Lamps"
        on={data.lamps.on}
        sub={data.lamps.sub}
        pending={data.lamps.pending}
        onToggle={() => onToggle("lamps", data.lamps.on)}
      />

      <ControlTap
        icon="bulb"
        label="Lights"
        on={data.lights.on}
        pending={data.lights.pending}
        onToggle={() => onToggle("lights", data.lights.on)}
      />

      <ControlTap
        icon="fan"
        label="Fan"
        on={data.fan.on}
        sub={data.fan.sub}
        pending={data.fan.pending}
        onToggle={() => onToggle("fan", data.fan.on)}
      />

      {/* Scene placeholder — future scene trigger */}
      <button
        type="button"
        style={{
          borderRadius: 15,
          border: "1.5px dashed var(--hair-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--ink-3)",
          cursor: "pointer",
          font: "inherit",
          background: "none",
        }}
        aria-label="More"
      >
        <span style={{ fontSize: 22, lineHeight: 1, color: "var(--ink-3)" }}>›</span>
        <span style={{ fontSize: 13 }}>more</span>
      </button>
    </>
  );
}

// ─── SkeletonGrid — shimmer placeholders while data loads ─────────────────────

function SkeletonGrid() {
  return (
    <>
      <Skeleton w="100%" h={80} borderRadius={15} />
      <Skeleton w="100%" h={80} borderRadius={15} />
      <Skeleton w="100%" h={80} borderRadius={15} />
      <Skeleton w="100%" h={80} borderRadius={15} />
    </>
  );
}

// ─── ControlsTileView — pure view ─────────────────────────────────────────────

export function ControlsTileView(props: ControlsTileViewProps) {
  return (
    <Tile padding={20}>
      <TileHeader icon="bulb" title="Controls" />

      <div
        style={{
          flex: 1,
          // minHeight:0 prevents the implicit min-height:auto from causing the
          // grid to overflow the bottom padding when the flex child expands.
          minHeight: 0,
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 13,
        }}
      >
        {props.status === "populated" ? (
          <ControlsGridView data={props.data} onToggle={props.onToggle} />
        ) : (
          // Both loading and error show skeletons; error retries automatically via QueryClient
          <SkeletonGrid />
        )}
      </div>
    </Tile>
  );
}
