/**
 * Activity tile , live wiring for its single detail-page variant (the wake
 * photos grid / timelapse / sessions viewer).
 *
 * PIN-gated: the wake photos are the one surface on the wall that looks like a
 * camera, so the host runs PinGateModal (titled "Activity") before this page
 * mounts , the gate WakesTile used to hand-wire itself.
 *
 * Data: trpc.wakePhotos.list (same query key as the tile face, so react-query
 * dedupes the fetch) plus the sessions list/detail queries , all mounted only
 * while the page is open, so a closed tile never polls sessions.
 */

import { useState } from "react";
import { ActivityPage } from "@/components/tiles/ActivityPage";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function useActivityVariants(): { variants: DetailVariant[]; loading: boolean } {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const listing = trpc.wakePhotos.list.useQuery(undefined, {
    refetchInterval: POLL.wakePhotos,
  });
  const sessions = trpc.sessions.list.useQuery(undefined, {
    refetchInterval: POLL.wakePhotos,
  });
  const sessionDetail = trpc.sessions.get.useQuery(
    { id: selectedSessionId ?? "" },
    { enabled: selectedSessionId !== null },
  );

  const data = listing.data;
  if (!data) return { variants: [], loading: true };

  const sessionRows = sessions.data ?? [];
  // Only hand over a detail that matches the CURRENT selection , while a
  // newly-selected session's query is in flight, react-query still holds the
  // previous session's data, which would render the wrong transcript under the
  // new row's identity.
  const selectedSession =
    sessionDetail.data && sessionDetail.data.id === selectedSessionId ? sessionDetail.data : null;

  const variants: DetailVariant[] = [
    {
      slug: "activity",
      label: "Activity",
      render: () => (
        <ActivityPage
          days={data.days}
          totalCount={data.totalCount}
          totalBytes={data.totalBytes}
          photoUrl={(path) => `/media/wake-photos/${path}`}
          sessions={sessionRows}
          selectedSession={selectedSession}
          onSelectSession={setSelectedSessionId}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const activityDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_wakes",
  title: "Activity",
  requiresPin: true,
  defaultSlug: "activity",
  useVariants: useActivityVariants,
};
