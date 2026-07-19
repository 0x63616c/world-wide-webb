/**
 * Sound System tile , live wiring for its single detail-page variant (the
 * Sonos Groups patch-bay).
 *
 * Data: trpc.media.soundSystem, polled here while the page is open (same query
 * key as the tile face, so react-query dedupes the fetch). GroupsModal is the
 * existing container that owns the join/leave/grab mutations; it needs
 * dataUpdatedAt to gate useGroupMembership's stale-poll reconcile.
 */

import { GroupsModal } from "@/components/media/GroupsModal";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function useSoundVariants(): { variants: DetailVariant[]; loading: boolean } {
  const query = trpc.media.soundSystem.useQuery(undefined, {
    refetchInterval: POLL.soundSystem,
  });
  const { dataUpdatedAt } = query;

  const rooms = query.data?.rooms;
  if (!rooms) return { variants: [], loading: true };

  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "Sound System",
      render: () => <GroupsModal rooms={rooms} dataUpdatedAt={dataUpdatedAt} />,
    },
  ];

  return { variants, loading: false };
}

export const soundDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_sound",
  title: "Sound System",
  defaultSlug: "detail",
  useVariants: useSoundVariants,
};
