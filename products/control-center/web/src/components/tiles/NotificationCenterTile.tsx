/**
 * NotificationCenterTile , thin container for the Notification Center tile.
 *
 * Data: trpc.notifications.list. The tile itself always watches the `unread`
 * slice (that's what it renders and what the count pill reports); the expanded
 * panel adds a second query for whichever tab is active, enabled only while the
 * modal is open so a closed modal costs nothing. Mutations (markRead /
 * markAllRead / dismiss) invalidate the whole `list` key on settle, so both
 * queries re-settle on the authoritative rows.
 *
 * Presentation lives in NotificationCenterTileView +
 * ExpandedNotificationCenterModalView; this file holds no markup.
 */

import { useState } from "react";
import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import {
  applyMutes,
  type NotificationFilter,
  type NotificationItem,
  notificationAge,
  sortNewestFirst,
  tileRows,
} from "@/lib/notifications";
import { mutedCategoriesOf, useSettings } from "@/lib/settings";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { ExpandedNotificationCenterModalView } from "./modals/ExpandedNotificationCenterModalView";
import type { NotificationRow } from "./NotificationCenterTileView";
import { NotificationCenterTileView } from "./NotificationCenterTileView";

/** How many unread rows the 4x3 tile has room for. */
const TILE_ROW_LIMIT = 3;

export function NotificationCenterTile() {
  const utils = trpc.useUtils();
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("unread");

  const settings = useSettings();
  const muted = mutedCategoriesOf(settings);
  // Ages are coarse ("3mins", "1hr"), so a 30s tick is enough to keep them
  // honest without re-rendering the tile every second.
  const now = useNow(30_000);

  const unreadQuery = trpc.notifications.list.useQuery(
    { filter: "unread" },
    { refetchInterval: POLL.notifications },
  );
  const tabQuery = trpc.notifications.list.useQuery(
    { filter },
    { refetchInterval: POLL.notifications, enabled: modalOpen },
  );

  const tile = useTileQuery(unreadQuery);

  const invalidate = () => {
    void utils.notifications.list.invalidate();
  };
  const markReadMutation = trpc.notifications.markRead.useMutation({ onSettled: invalidate });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({ onSettled: invalidate });
  const dismissMutation = trpc.notifications.dismiss.useMutation({ onSettled: invalidate });

  if (tile.status !== TileStatus.Populated) {
    return <NotificationCenterTileView status={tile.status} />;
  }

  const unreadItems = tile.data.items as NotificationItem[];
  const unreadCount = tile.data.unreadCount;

  const rows: NotificationRow[] = tileRows(unreadItems, muted, TILE_ROW_LIMIT).map((n) => ({
    id: n.id,
    severity: n.severity,
    category: n.category,
    title: n.title,
    age: notificationAge(n.createdAt, now.getTime()),
  }));

  // The modal shows whichever tab is active. Muting is a display preference, so
  // it applies to every tab; ordering is newest-first everywhere.
  const modalItems = sortNewestFirst(
    applyMutes((tabQuery.data?.items ?? []) as NotificationItem[], muted),
  );

  return (
    <>
      <NotificationCenterTileView
        status={TileStatus.Populated}
        data={{ unreadCount, rows }}
        onOpen={() => setModalOpen(true)}
      />
      <ExpandedNotificationCenterModalView
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        filter={filter}
        onFilterChange={setFilter}
        items={modalItems}
        unreadCount={unreadCount}
        // Only a genuinely empty cache is "loading" , a failed poll on top of a
        // previous snapshot keeps showing that snapshot (the useTileQuery rule).
        loading={modalOpen && tabQuery.data === undefined && !tabQuery.isError}
        error={
          tabQuery.isError && tabQuery.data === undefined ? "The API is unreachable." : undefined
        }
        nowMs={now.getTime()}
        onMarkRead={(id) => markReadMutation.mutate({ id })}
        onDismiss={(id) => dismissMutation.mutate({ id })}
        onMarkAllRead={() => markAllReadMutation.mutate()}
      />
    </>
  );
}
