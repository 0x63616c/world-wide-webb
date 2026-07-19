/**
 * TV Apps tile , live wiring for its single detail-page variant (the
 * searchable All Apps grid).
 *
 * Data: trpc.media.tvApps, polled here while the page is open (same query key
 * as the tile face, so react-query dedupes the fetch). Launching an app fires
 * tvLaunchApp and closes the page , preserving the old modal's
 * launch-and-close behavior.
 */

import { AllAppsModal } from "@/components/media/AllAppsModal";
import { POLL } from "@/lib/hooks";
import { closeTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function useTvAppsVariants(): { variants: DetailVariant[]; loading: boolean } {
  const query = trpc.media.tvApps.useQuery(undefined, { refetchInterval: POLL.tvApps });
  const launchMutation = trpc.media.tvLaunchApp.useMutation();

  const d = query.data;
  if (!d) return { variants: [], loading: true };

  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "TV Apps",
      render: () => (
        <AllAppsModal
          apps={d.apps}
          currentApp={d.currentApp}
          onLaunchApp={(app) => {
            launchMutation.mutate({ app });
            closeTileDetail();
          }}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const tvAppsDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_tvapps",
  title: "TV Apps",
  defaultSlug: "detail",
  useVariants: useTvAppsVariants,
};
