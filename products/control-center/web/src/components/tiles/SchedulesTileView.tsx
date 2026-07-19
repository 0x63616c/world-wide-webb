/**
 * SchedulesTileView , pure presentational layer for the Schedules tile.
 * All data + callbacks come in as props; no trpc or hooks inside (mirrors
 * ControlsTileView). A compact header with an "N on" count pill, the two soonest
 * active schedules as dense rows, and a next-run footer; tapping the tile opens
 * the full-page schedules manager via the board's tile-detail registry.
 */

import { Pill, PillTone, Skeleton, StatusDot, Tile, TileHeader, TileStatus } from "@/components/ui";
import { type DisplayScene, SceneChip } from "./schedule-scene";

/** One compact schedule row , the two soonest active schedules are shown. */
export interface SchedulesRow {
  id: string;
  name: string;
  /** Human day summary, e.g. "Every day" or "Weekdays". */
  days: string;
  /** Resolved fire-time label, e.g. "6:45" or "sunset +15m". */
  time: string;
  scene: DisplayScene;
}

export interface SchedulesViewData {
  /** Number of enabled schedules. */
  enabledCount: number;
  /** Up to two soonest active schedules, as dense rows. */
  rows: SchedulesRow[];
  /** The single next upcoming fire, or null when none. */
  next: { name: string; time: string } | null;
}

export type SchedulesTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error; error?: string }
  | { status: typeof TileStatus.Populated; data: SchedulesViewData };

export function SchedulesTileView(props: SchedulesTileViewProps) {
  const populated = props.status === TileStatus.Populated;

  return (
    <Tile padding={16}>
      <TileHeader
        icon="calendar"
        title="Schedules"
        titleSize={15}
        iconSize={17}
        right={
          populated ? (
            <Pill tone={PillTone.On}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                {props.data.enabledCount} on
              </span>
            </Pill>
          ) : undefined
        }
      />

      {populated ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {props.data.rows.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No active schedules</span>
            ) : (
              props.data.rows.map((row) => (
                <div
                  key={row.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 34 }}
                >
                  <SceneChip scene={row.scene} size={28} />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        color: "var(--ink-1)",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{row.days}</span>
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-2)" }}>
                    {row.time}
                  </span>
                </div>
              ))
            )}
          </div>

          <div
            style={{
              marginTop: "auto",
              paddingTop: 12,
              borderTop: "1px solid var(--hair)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <StatusDot online={Boolean(props.data.next)} />
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {props.data.next ? `Next · ${props.data.next.name}` : "No upcoming"}
            </span>
            {props.data.next && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                {props.data.next.time}
              </span>
            )}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          <Skeleton w="60%" h={20} borderRadius={8} />
          <Skeleton w="80%" h={20} borderRadius={8} />
          <Skeleton w="45%" h={14} borderRadius={8} />
        </div>
      )}
    </Tile>
  );
}
