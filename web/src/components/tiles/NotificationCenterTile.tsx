/**
 * NotificationCenterTile , thin container for the Notification Center tile face.
 *
 * Data: trpc.notifications.list, always the `unread` slice (that's what the
 * tile renders and what the count pill reports). Tapping the tile opens the
 * full-page Notification Center via the board's tile-detail registry (wired in
 * detail/wiring/notifications.tsx, which owns the tab state + mutations).
 *
 * Presentation lives in NotificationCenterTileView +
 * ExpandedNotificationCenterView; this file holds no markup.
 */

import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import { type NotificationItem, notificationAge, tileRows } from "@/lib/notifications";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import type { NotificationRow } from "./NotificationCenterTileView";
import { NotificationCenterTileView } from "./NotificationCenterTileView";

/** How many unread rows the 4x3 tile has room for. */
const TILE_ROW_LIMIT = 3;

export function NotificationCenterTile() {
  // Ages are coarse ("3mins", "1hr"), so a 30s tick is enough to keep them
  // honest without re-rendering the tile every second.
  const now = useNow(30_000);

  const unreadQuery = trpc.notifications.list.useQuery(
    { filter: "unread" },
    { refetchInterval: POLL.notifications },
  );

  const tile = useTileQuery(unreadQuery);

  if (tile.status !== TileStatus.Populated) {
    return <NotificationCenterTileView status={tile.status} />;
  }

  const unreadItems = tile.data.items as NotificationItem[];
  const unreadCount = tile.data.unreadCount;

  const rows: NotificationRow[] = tileRows(unreadItems, TILE_ROW_LIMIT).map((n) => ({
    id: n.id,
    severity: n.severity,
    category: n.category,
    title: n.title,
    age: notificationAge(n.createdAt, now.getTime()),
  }));

  return <NotificationCenterTileView status={TileStatus.Populated} data={{ unreadCount, rows }} />;
}
