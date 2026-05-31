/**
 * ControlsTileView — pure presentational layer for the Controls tile.
 * All data and callbacks come in as props; no trpc or hooks inside.
 */

import { useState } from "react";
import { Icon } from "../Icon";
import { ControlTap, Skeleton, Tile, TileHeader } from "../ui";
import { ControlOverflow } from "../ui/ControlOverflow";

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
  // Track which control cell has its overflow panel open (null = none)
  const [openOverflow, setOpenOverflow] = useState<ControlKey | null>(null);

  const closeOverflow = () => setOpenOverflow(null);

  return (
    <>
      <ControlTap
        icon="lamp"
        label="Lamps"
        on={data.lamps.on}
        sub={data.lamps.sub}
        pending={data.lamps.pending}
        onToggle={() => onToggle("lamps", data.lamps.on)}
        onMore={() => setOpenOverflow("lamps")}
      />

      <ControlTap
        icon="bulb"
        label="Lights"
        on={data.lights.on}
        pending={data.lights.pending}
        onToggle={() => onToggle("lights", data.lights.on)}
        onMore={() => setOpenOverflow("lights")}
      />

      <ControlTap
        icon="fan"
        label="Fan"
        on={data.fan.on}
        sub={data.fan.sub}
        pending={data.fan.pending}
        onToggle={() => onToggle("fan", data.fan.on)}
        onMore={() => setOpenOverflow("fan")}
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
        aria-label="Scene"
      >
        <Icon name="plus" s={22} c="var(--ink-3)" />
        <span style={{ fontSize: 13 }}>Scene</span>
      </button>

      {/* Overflow panel for rename/scene — floats over the grid */}
      {openOverflow && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
          }}
        >
          <ControlOverflow
            label={openOverflow.charAt(0).toUpperCase() + openOverflow.slice(1)}
            open={true}
            onClose={closeOverflow}
            onRename={closeOverflow}
            onScene={closeOverflow}
          />
        </div>
      )}
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
          <SkeletonGrid />
        )}
      </div>
    </Tile>
  );
}
