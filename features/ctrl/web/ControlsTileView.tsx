/**
 * ControlsTileView , pure presentational layer for the Controls tile.
 * All data and callbacks come in as props; no trpc or hooks inside.
 */

import { Icon } from "@/components/Icon";
import { ControlTap, ControlTapRow, Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export const ControlKey = {
  Lamps: "lamps",
  Lights: "lights",
  Fan: "fan",
  BedroomLamps: "bedroomLamps",
  OtherLamps: "otherLamps",
  Ceiling: "ceiling",
  Cabinet: "cabinet",
  All: "all",
} as const;
export type ControlKey = (typeof ControlKey)[keyof typeof ControlKey];

/**
 * The lamps' currently-active preset: one of the scene ids, "party" (party mode
 * running), or null (custom/no recognised scene). Drives the active highlight on
 * the scene + Party tiles in the expanded detail page. The scene ids match
 * ExpandedControlsView's LampScene; declared here (the lower-level module)
 * so ControlEntry can carry it without importing that view (avoids a cycle).
 */
type ActiveScene = "white" | "mood" | "red" | "blue" | "party" | null;

export type SavedColorSlot = "red" | "blue" | "custom";
export interface SavedLampColorView {
  slot: SavedColorSlot;
  label: string;
  hex: string;
}

interface ControlEntry {
  on: boolean;
  sub?: string;
  pending?: boolean;
  /** Lamp brightness 0..100 (avg of on-lamps). Only the lamps entry carries this;
   *  seeds the expanded detail page's brightness slider. */
  brightness?: number;
  /** Active scene/mode , only the lamps entry carries this; drives the detail
   *  page's scene + Party tile highlight. Undefined treated as null (no active scene). */
  activeScene?: ActiveScene;
  /** Three user-editable colors shown in the full lamp controls page. */
  savedColors?: SavedLampColorView[];
}

export interface ControlsViewData {
  lamps: ControlEntry;
  lights: ControlEntry;
  fan: ControlEntry;
  bedroomLamps: ControlEntry;
  otherLamps: ControlEntry;
  ceiling: ControlEntry;
  cabinet: ControlEntry;
  /** A master toggle over every lamp and fixture , see ControlKey.All and
   *  service.ts's ControlsState.all for the AND-vs-OR semantics note. */
  all: ControlEntry;
}

export type ControlsTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error; error?: string }
  | {
      status: typeof TileStatus.Populated;
      data: ControlsViewData;
      onToggle: (key: ControlKey, currentOn: boolean) => void;
      /** Opens the full-page Controls detail , forwarded to the grid's "more" button. */
      onMore?: () => void;
    };

// ─── ControlsGridView , renders real tap cells ────────────────────────────────

interface ControlsGridViewProps {
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
  /** Opens the full-page Controls detail. Wired to the "more" button's onClick. */
  onMore?: () => void;
  /** Suppress the "more" button , set when the grid is reused INSIDE the detail
   *  page, where a second "more" affordance would be redundant/recursive. */
  hideMore?: boolean;
}

/** One sub-control inside a ControlGroupCard (a room lamp split or a fixture split). */
interface ControlGroupCardSub {
  key: ControlKey;
  icon: "lamp" | "bulb";
  label: string;
  entry: ControlEntry;
}

interface ControlGroupCardProps {
  icon: "lamp" | "bulb";
  masterLabel: string;
  master: ControlEntry;
  onMasterToggle: () => void;
  subs: ControlGroupCardSub[];
  onSubToggle: (key: ControlKey, currentOn: boolean) => void;
}

/**
 * A group card , the "Lamps" or "Lights" card in the redesigned Controls grid
 * (Option 3, "Group Cards"). Groups by containment instead of grid position:
 * the combined master toggle sits as a full-width header bar (ControlTapRow)
 * above its two room/fixture sub-controls (plain ControlTap, half-width each),
 * all on one shared card background.
 */
function ControlGroupCard({
  icon,
  masterLabel,
  master,
  onMasterToggle,
  subs,
  onSubToggle,
}: ControlGroupCardProps) {
  return (
    <div
      style={{
        background: "var(--tile-2)",
        border: "1px solid var(--hair)",
        borderRadius: 15,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flex: 1,
        minHeight: 0,
      }}
    >
      <ControlTapRow
        icon={icon}
        label={masterLabel}
        on={master.on}
        pending={master.pending}
        onToggle={onMasterToggle}
      />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1, minHeight: 0 }}
      >
        {subs.map((sub) => (
          <ControlTap
            key={sub.key}
            icon={sub.icon}
            label={sub.label}
            on={sub.entry.on}
            pending={sub.entry.pending}
            onToggle={() => onSubToggle(sub.key, sub.entry.on)}
          />
        ))}
      </div>
    </div>
  );
}

export function ControlsGridView({ data, onToggle, onMore, hideMore }: ControlsGridViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13, height: "100%" }}>
      {/* Utility row , All (a real master toggle, see ControlKey.All) plus Fan and,
          on the compact tile, the "more" affordance. Same ControlTap cell every
          other quick control uses, so Fan keeps its real sub-label (Auto/On/Off)
          instead of collapsing to a plain on/off row. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: hideMore ? "1fr 1fr" : "1fr 1fr 1fr",
          gap: 13,
          height: 96,
          flex: "0 0 auto",
        }}
      >
        <ControlTap
          icon="bolt"
          label="All"
          on={data.all.on}
          pending={data.all.pending}
          onToggle={() => onToggle(ControlKey.All, data.all.on)}
        />

        <ControlTap
          icon="fan"
          label="Fan"
          on={data.fan.on}
          sub={data.fan.sub}
          pending={data.fan.pending}
          onToggle={() => onToggle(ControlKey.Fan, data.fan.on)}
        />

        {/* "More" affordance , opens the full-page Controls detail. Suppressed via
            hideMore when this grid is reused inside that page. */}
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
              gap: 6,
              color: "var(--ink-3)",
              cursor: "pointer",
              font: "inherit",
              background: "none",
            }}
            aria-label="More"
          >
            <Icon name="chevron" s={20} c="var(--ink-3)" />
            <span style={{ fontSize: 13 }}>more</span>
          </button>
        )}
      </div>

      <ControlGroupCard
        icon="lamp"
        masterLabel="Lamps"
        master={data.lamps}
        onMasterToggle={() => onToggle(ControlKey.Lamps, data.lamps.on)}
        subs={[
          {
            key: ControlKey.BedroomLamps,
            icon: "lamp",
            label: "Bedroom",
            entry: data.bedroomLamps,
          },
          {
            key: ControlKey.OtherLamps,
            icon: "lamp",
            label: "Living Room",
            entry: data.otherLamps,
          },
        ]}
        onSubToggle={onToggle}
      />

      <ControlGroupCard
        icon="bulb"
        masterLabel="Lights"
        master={data.lights}
        onMasterToggle={() => onToggle(ControlKey.Lights, data.lights.on)}
        subs={[
          { key: ControlKey.Ceiling, icon: "bulb", label: "Ceiling", entry: data.ceiling },
          { key: ControlKey.Cabinet, icon: "bulb", label: "Cabinet", entry: data.cabinet },
        ]}
        onSubToggle={onToggle}
      />
    </div>
  );
}

// ─── SkeletonGrid , shimmer placeholders while data loads ─────────────────────

function SkeletonGrid() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13, height: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 13,
          height: 96,
          flex: "0 0 auto",
        }}
      >
        {Array.from({ length: 3 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list, never reordered
          <Skeleton key={i} w="100%" h="100%" borderRadius={15} />
        ))}
      </div>
      <Skeleton w="100%" h="100%" borderRadius={15} />
      <Skeleton w="100%" h="100%" borderRadius={15} />
    </div>
  );
}

// ─── ControlsTileView , pure view ─────────────────────────────────────────────

export function ControlsTileView(props: ControlsTileViewProps) {
  // Tapping the tile surface (outside the toggle cells / "more" button) bubbles
  // to the board, which opens the full-page Controls detail via the tile-detail
  // registry; toggle cells and the "more" button own their own taps.
  return (
    <Tile padding={20}>
      <TileHeader icon="bulb" title="Controls" />

      <div
        style={{
          flex: 1,
          // minHeight:0 prevents the implicit min-height:auto from causing the
          // content to overflow the bottom padding when the flex child expands.
          // The utility row + group cards below own their own layout (flex
          // column), so this wrapper no longer declares a grid itself.
          minHeight: 0,
          position: "relative",
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
