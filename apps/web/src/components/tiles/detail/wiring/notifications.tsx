/**
 * Notifications tile , live wiring for its single detail-page variant.
 *
 * Data: trpc.notifications.list twice , the `unread` slice for the header pill
 * + Mark-all-read, and whichever tab is active (Unread / All) for the list. The
 * tab state lives HERE (internal to the page, not a variant switcher). Mutations
 * (markRead / markAllRead) invalidate the whole `list` key on settle, so the
 * tile face and this page re-settle together.
 */

import { ExpandedNotificationCenterView } from "@features/notif/web";
import { useState } from "react";
import { POLL, useNow } from "@/lib/hooks";
import {
  type NotificationFilter,
  type NotificationItem,
  sortNewestFirst,
} from "@/lib/notifications";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function useNotificationsVariants(): { variants: DetailVariant[]; loading: boolean } {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<NotificationFilter>("unread");

  // Coarse ages ("3mins", "1hr") , a 30s tick keeps them honest.
  const now = useNow(30_000);

  const unreadQuery = trpc.notifications.list.useQuery(
    { filter: "unread" },
    { refetchInterval: POLL.notifications },
  );
  const tabQuery = trpc.notifications.list.useQuery(
    { filter },
    { refetchInterval: POLL.notifications },
  );

  const invalidate = () => {
    void utils.notifications.list.invalidate();
  };
  const markReadMutation = trpc.notifications.markRead.useMutation({ onSettled: invalidate });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({ onSettled: invalidate });

  const unreadData = unreadQuery.data;
  if (!unreadData) return { variants: [], loading: true };

  const unreadCount = unreadData.unreadCount;
  // The page shows whichever tab is active, newest-first everywhere.
  const items = sortNewestFirst((tabQuery.data?.items ?? []) as NotificationItem[]);

  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "Notifications",
      render: () => (
        <ExpandedNotificationCenterView
          filter={filter}
          onFilterChange={setFilter}
          items={items}
          unreadCount={unreadCount}
          // Only a genuinely empty cache is "loading" , a failed poll on top of
          // a previous snapshot keeps showing that snapshot (the useTileQuery
          // rule).
          loading={tabQuery.data === undefined && !tabQuery.isError}
          error={
            tabQuery.isError && tabQuery.data === undefined ? "The API is unreachable." : undefined
          }
          nowMs={now.getTime()}
          onMarkRead={(id) => markReadMutation.mutate({ id })}
          onMarkAllRead={() => markAllReadMutation.mutate()}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const notificationsDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_notif",
  title: "Notifications",
  defaultSlug: "detail",
  useVariants: useNotificationsVariants,
};
