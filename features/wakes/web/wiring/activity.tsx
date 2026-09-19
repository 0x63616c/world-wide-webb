/**
 * Activity tile , live wiring for its single detail-page variant (the wake
 * photos grid / timelapse / sessions viewer).
 *
 * PIN-gated: the wake photos are the one surface on the wall that looks like a
 * camera, so the host runs PinGateModal (titled "Activity") before this page
 * mounts , the gate WakesTile used to hand-wire itself.
 *
 * Data: trpc.wakePhotos.list (same query key as the tile face, so react-query
 * dedupes the fetch) plus the sessions list , both mounted only while the page
 * is open, so a closed tile never polls sessions.
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import { POLL } from "@/lib/hooks";
import { closeTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { ActivityPage } from "../ActivityPage";

function useActivityVariants(): { variants: DetailVariant[]; loading: boolean } {
  const listing = trpc.wakePhotos.list.useQuery(undefined, {
    refetchInterval: POLL.wakePhotos,
  });
  const sessions = trpc.sessions.list.useQuery(undefined, {
    refetchInterval: POLL.wakePhotos,
  });
  const data = listing.data;
  if (!data) return { variants: [], loading: true };

  const sessionRows = sessions.data ?? [];

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
          onBack={closeTileDetail}
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
  // Full-bleed so the gallery grid runs edge-to-edge like the photo booth's;
  // ActivityPage owns its own PageHeader. The App manifest owns the PIN policy;
  // GatedTileDetail resolves it before chrome matters.
  chrome: "none",
  defaultSlug: "activity",
  useVariants: useActivityVariants,
};
