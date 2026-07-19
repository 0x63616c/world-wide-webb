/**
 * NotificationCenterTileView , pure presentational layer for the Notification
 * Center tile. All data + callbacks arrive as props; no trpc or data hooks
 * inside (mirrors SchedulesTileView).
 *
 * A header with an unread-count pill, the newest unread notifications as dense
 * severity-coded rows, and a footer summarising the oldest-unread age. Tapping
 * the tile opens the expanded Notification Center modal.
 */

import type { MouseEventHandler } from "react";
import { Pill, PillTone, Skeleton, StatusDot, Tile, TileHeader, TileStatus } from "@/components/ui";
import {
  CATEGORY_LABEL,
  type NotificationCategory,
  type NotificationSeverity,
  SEVERITY_COLOR,
  unreadBadge,
} from "@/lib/notifications";

/** One compact unread row , the newest few unread notifications are shown. */
export interface NotificationRow {
  id: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  title: string;
  /** Pre-formatted relative age, e.g. "3mins" , the view never reads a clock. */
  age: string;
}

export interface NotificationCenterViewData {
  /** Unread count as the server reports it (before local category mutes). */
  unreadCount: number;
  /** Up to three newest unread notifications, already muted-filtered + sorted. */
  rows: NotificationRow[];
}

export type NotificationCenterTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error; error?: string }
  | {
      status: typeof TileStatus.Populated;
      data: NotificationCenterViewData;
      onOpen?: () => void;
    };

export function NotificationCenterTileView(props: NotificationCenterTileViewProps) {
  const onOpen = props.status === TileStatus.Populated ? props.onOpen : undefined;
  const onTileTap: MouseEventHandler<HTMLDivElement> | undefined = onOpen
    ? (e) => {
        e.stopPropagation();
        onOpen();
      }
    : undefined;

  const populated = props.status === TileStatus.Populated;
  const unread = populated ? props.data.unreadCount : 0;

  return (
    <Tile padding={16} onClick={onTileTap} style={onOpen ? { cursor: "pointer" } : undefined}>
      <TileHeader
        icon="bell"
        title="Notifications"
        titleSize={15}
        iconSize={17}
        right={
          populated ? (
            // Amber once anything is waiting; the neutral tone reads as "clear".
            <Pill tone={unread > 0 ? PillTone.Amber : PillTone.Default}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                {unreadBadge(unread)} new
              </span>
            </Pill>
          ) : undefined
        }
      />

      {populated ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {props.data.rows.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>All caught up</span>
            ) : (
              props.data.rows.map((row) => (
                <div
                  key={row.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32 }}
                >
                  {/* Severity is carried by a colour rail rather than a word, so
                      the row's one text line can be the actual message. */}
                  <span
                    aria-hidden="true"
                    style={{
                      width: 3,
                      alignSelf: "stretch",
                      borderRadius: 2,
                      background: SEVERITY_COLOR[row.severity],
                      flexShrink: 0,
                    }}
                  />
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
                        fontSize: 13.5,
                        color: "var(--ink-1)",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.title}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {CATEGORY_LABEL[row.category]}
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>
                    {row.age}
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
            <StatusDot online={unread === 0} />
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {unread === 0 ? "Nothing waiting" : `${unread} unread`}
            </span>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          <Skeleton w="70%" h={20} borderRadius={8} />
          <Skeleton w="55%" h={20} borderRadius={8} />
          <Skeleton w="40%" h={14} borderRadius={8} />
        </div>
      )}
    </Tile>
  );
}
