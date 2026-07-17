/**
 * SchedulesTileView , pure presentational layer for the Schedules tile.
 * All data + callbacks come in as props; no trpc or hooks inside (mirrors
 * ControlsTileView). Shows the count of enabled schedules and the single next
 * upcoming event; tapping the tile opens the expanded schedules modal.
 */

import type { MouseEventHandler } from "react";
import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";

export interface SchedulesViewData {
  /** Number of enabled schedules. */
  enabledCount: number;
  /** Label of the next upcoming fire, e.g. "Red night · 21:30"; null when none. */
  nextLabel: string | null;
}

export type SchedulesTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error; error?: string }
  | { status: typeof TileStatus.Populated; data: SchedulesViewData; onOpen?: () => void };

export function SchedulesTileView(props: SchedulesTileViewProps) {
  const onOpen = props.status === TileStatus.Populated ? props.onOpen : undefined;
  const onTileTap: MouseEventHandler<HTMLDivElement> | undefined = onOpen
    ? (e) => {
        e.stopPropagation();
        onOpen();
      }
    : undefined;

  return (
    <Tile padding={20} onClick={onTileTap} style={onOpen ? { cursor: "pointer" } : undefined}>
      <TileHeader icon="calendar" title="Schedules" />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {props.status === TileStatus.Populated ? (
          <>
            <div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink-1)", lineHeight: 1 }}>
              {props.data.enabledCount}
              <span style={{ fontSize: 15, fontWeight: 400, color: "var(--ink-3)", marginLeft: 6 }}>
                active
              </span>
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-3)" }}>
              {props.data.nextLabel ? `Next · ${props.data.nextLabel}` : "No upcoming"}
            </div>
          </>
        ) : (
          <>
            <Skeleton w="40%" h={30} borderRadius={8} />
            <Skeleton w="70%" h={16} borderRadius={8} />
          </>
        )}
      </div>
    </Tile>
  );
}
