/**
 * ControlsTileView , pure presentational layer for the Controls tile.
 * All data and callbacks come in as props; no trpc or hooks inside.
 */

import type { MouseEventHandler } from "react";
import { Icon } from "@/components/Icon";
import { ControlTap, Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { deriveLightsMode, LightsMode, lightsModeLabel } from "@/lib/lights-mode";

// ─── types ────────────────────────────────────────────────────────────────────

export const ControlKey = {
  Lamps: "lamps",
  Lights: "lights",
  Fan: "fan",
} as const;
export type ControlKey = (typeof ControlKey)[keyof typeof ControlKey];

/**
 * The lamps' currently-active preset: one of the scene ids, "party" (party mode
 * running), or null (custom/no recognised scene). Drives the active highlight on
 * the scene + Party tiles in the expanded modal. The scene ids match
 * ExpandedControlsModalView's LampScene; declared here (the lower-level module)
 * so ControlEntry can carry it without importing the modal (avoids a cycle).
 */
export type ActiveScene = "white" | "mood" | "red" | "blue" | "party" | null;

export interface ControlEntry {
  on: boolean;
  sub?: string;
  pending?: boolean;
  /** Lamp brightness 0..100 (avg of on-lamps). Only the lamps entry carries this;
   *  seeds the expanded modal's brightness slider. */
  brightness?: number;
  /** Active scene/mode , only the lamps entry carries this; drives the modal's
   *  scene + Party tile highlight. Undefined treated as null (no active scene). */
  activeScene?: ActiveScene;
}

/**
 * The Lights control is a 4-state mode cycle over two independent fixtures
 * (kitchen = under-cabinet, overhead), not a simple on/off. The mode + label are
 * derived from these two booleans; see `@/lib/lights-mode`.
 */
export interface LightsControlEntry {
  kitchen: boolean;
  overhead: boolean;
  pending?: boolean;
}

export interface ControlsViewData {
  lamps: ControlEntry;
  lights: LightsControlEntry;
  fan: ControlEntry;
}

export type ControlsTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error; error?: string }
  | {
      status: typeof TileStatus.Populated;
      data: ControlsViewData;
      onToggle: (key: ControlKey, currentOn: boolean) => void;
      /** Advance the Lights mode cycle one step (OFF → K ON → O ON → ON → OFF). */
      onLightsCycle: () => void;
      /** Opens the expanded controls modal , forwarded to the grid's "more" button. */
      onMore?: () => void;
    };

// ─── ControlsGridView , renders real tap cells ────────────────────────────────

interface ControlsGridViewProps {
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  /** Advance the Lights mode cycle one step (OFF → K ON → O ON → ON → OFF). */
  onLightsCycle: () => void;
  /** Opens the expanded controls modal. Wired to the "more" button's onClick. */
  onMore?: () => void;
  /** Suppress the "more" button , set when the grid is reused INSIDE the modal,
   *  where a second "more" affordance would be redundant/recursive. */
  hideMore?: boolean;
}

export function ControlsGridView({
  data,
  onToggle,
  onLightsCycle,
  onMore,
  hideMore,
}: ControlsGridViewProps) {
  // Lights is a 4-state mode cycle over the two fixtures, not a binary toggle.
  // `on` (any fixture lit) drives the bulb glyph + accent; `status` shows the
  // mode label (OFF / K ON / O ON / ON); a tap advances to the next mode.
  const lightsMode = deriveLightsMode(data.lights);

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
        on={lightsMode !== LightsMode.Off}
        status={lightsModeLabel(lightsMode)}
        pending={data.lights.pending}
        onToggle={onLightsCycle}
      />

      <ControlTap
        icon="fan"
        label="Fan"
        on={data.fan.on}
        sub={data.fan.sub}
        pending={data.fan.pending}
        onToggle={() => onToggle(ControlKey.Fan, data.fan.on)}
      />

      {/* "More" affordance , opens the expanded controls modal. Suppressed via
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

// ─── SkeletonGrid , shimmer placeholders while data loads ─────────────────────

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

// ─── ControlsTileView , pure view ─────────────────────────────────────────────

export function ControlsTileView(props: ControlsTileViewProps) {
  const onMore = props.status === TileStatus.Populated ? props.onMore : undefined;

  // Whole-tile tap opens the expanded modal , the same surface the "more" button
  // opens , EXCEPT taps on a toggle cell (.tap), which operate that control.
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
          <ControlsGridView
            data={props.data}
            onToggle={props.onToggle}
            onLightsCycle={props.onLightsCycle}
            onMore={props.onMore}
          />
        ) : (
          // Both loading and error show skeletons; error retries automatically via QueryClient
          <SkeletonGrid />
        )}
      </div>
    </Tile>
  );
}
