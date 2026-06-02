/**
 * ControlsTileView — pure presentational layer for the Controls tile.
 * All data and callbacks come in as props; no trpc or hooks inside.
 */

import type { MouseEventHandler } from "react";
import { Icon } from "../Icon";
import { ControlTap, Skeleton, Tile, TileHeader } from "../ui";
import { TileStatus } from "./EventsTileView";

// ─── types ────────────────────────────────────────────────────────────────────

export const ControlKey = {
  Lamps: "lamps",
  Lights: "lights",
  Fan: "fan",
} as const;
export type ControlKey = (typeof ControlKey)[keyof typeof ControlKey];

export interface ControlEntry {
  on: boolean;
  sub?: string;
  pending?: boolean;
  /** Lamp brightness 0..100 (avg of on-lamps). Only the lamps entry carries this;
   *  seeds the expanded modal's brightness slider. */
  brightness?: number;
}

export interface ControlsViewData {
  lamps: ControlEntry;
  lights: ControlEntry;
  fan: ControlEntry;
}

export type ControlsTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error; error?: string }
  | {
      status: typeof TileStatus.Populated;
      data: ControlsViewData;
      onToggle: (key: ControlKey, currentOn: boolean) => void;
      /** Opens the expanded controls modal — forwarded to the grid's "more" button. */
      onMore?: () => void;
    };

// ─── ControlsGridView — renders real tap cells ────────────────────────────────

interface ControlsGridViewProps {
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  /** Opens the expanded controls modal. Wired to the "more" button's onClick. */
  onMore?: () => void;
  /** Suppress the "more" button — set when the grid is reused INSIDE the modal,
   *  where a second "more" affordance would be redundant/recursive. */
  hideMore?: boolean;
}

export function ControlsGridView({ data, onToggle, onMore, hideMore }: ControlsGridViewProps) {
  return (
    <>
      <ControlTap
        icon="lamp"
        label="Lamps"
        on={data.lamps.on}
        sub={data.lamps.sub}
        pending={data.lamps.pending}
        onToggle={() => onToggle(ControlKey.Lamps, data.lamps.on)}
      />

      <ControlTap
        icon="bulb"
        label="Lights"
        on={data.lights.on}
        pending={data.lights.pending}
        onToggle={() => onToggle(ControlKey.Lights, data.lights.on)}
      />

      <ControlTap
        icon="fan"
        label="Fan"
        on={data.fan.on}
        sub={data.fan.sub}
        pending={data.fan.pending}
        onToggle={() => onToggle(ControlKey.Fan, data.fan.on)}
      />

      {/* "More" affordance — opens the expanded controls modal. Suppressed via
          hideMore when this grid is reused inside that modal. */}
      {!hideMore && (
        <button
          type="button"
          onClick={onMore}
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
          <Icon name="chevron" s={22} c="var(--ink-3)" />
          <span style={{ fontSize: 13 }}>more</span>
        </button>
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
  const onMore = props.status === TileStatus.Populated ? props.onMore : undefined;

  // Whole-tile tap opens the expanded modal — the same surface the "more" button
  // opens — EXCEPT taps on a toggle cell (.tap), which operate that control.
  // stopPropagation keeps any ancestor tap handler from also firing.
  const onTileTap: MouseEventHandler<HTMLDivElement> | undefined = onMore
    ? (e) => {
        if ((e.target as HTMLElement).closest(".tap")) return;
        e.stopPropagation();
        onMore();
      }
    : undefined;

  return (
    <Tile padding={20} onClick={onTileTap} style={onMore ? { cursor: "pointer" } : undefined}>
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
        {props.status === TileStatus.Populated ? (
          <ControlsGridView data={props.data} onToggle={props.onToggle} onMore={props.onMore} />
        ) : (
          // Both loading and error show skeletons; error retries automatically via QueryClient
          <SkeletonGrid />
        )}
      </div>
    </Tile>
  );
}
