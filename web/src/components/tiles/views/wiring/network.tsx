/**
 * Network tile , live wiring for its detail-page variants.
 *
 * Data sources (all live, already exposed):
 *  - trpc.network.status → { status, ssid, down, up, ping, traffic[24] }
 *  - config/network → MONTHLY_CAP_GB (user configuration, not a network metric;
 *    a data cap can't be measured from the WAN, so it's local config, not API)
 *
 * All four variants map straight from the one query. Note the prop-name drift
 * across the views: ConnectionHealth wants `isOnline:boolean` (derived from
 * status==="Online"), DataBudget wants `connectionStatus:string`, and
 * TrafficTimeline wants `status:string` , each is fed the exact shape it asks for.
 */

import type { DetailVariant, TileDetailPageEntry } from "@/components/tiles/detail/types";
import { NetworkModalConnectionHealth } from "@/components/tiles/views/NetworkModalConnectionHealth";
import { NetworkModalDataBudget } from "@/components/tiles/views/NetworkModalDataBudget";
import { NetworkModalTrafficTimeline } from "@/components/tiles/views/NetworkModalTrafficTimeline";
import { NetworkModalUsageSignature } from "@/components/tiles/views/NetworkModalUsageSignature";
import { MONTHLY_CAP_GB } from "@/config/network";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

function useNetworkVariants(): { variants: DetailVariant[]; loading: boolean } {
  const network = trpc.network.status.useQuery(undefined, { refetchInterval: POLL.network });

  const n = network.data;
  // All variants need the live status payload; wait for it so the switcher list
  // is stable rather than popping variants in once data lands.
  if (!n) return { variants: [], loading: true };

  const isOnline = n.status === "Online";

  const variants: DetailVariant[] = [
    {
      slug: "connection-health",
      label: "Health",
      render: () => (
        <NetworkModalConnectionHealth
          isOnline={isOnline}
          ping={n.ping}
          ssid={n.ssid}
          down={n.down}
          up={n.up}
          traffic={n.traffic}
        />
      ),
    },
    {
      slug: "data-budget",
      label: "Budget",
      render: () => (
        <NetworkModalDataBudget
          connectionStatus={n.status}
          ssid={n.ssid}
          down={n.down}
          up={n.up}
          traffic={n.traffic}
          monthlyCapGb={MONTHLY_CAP_GB}
        />
      ),
    },
    {
      slug: "traffic-timeline",
      label: "Timeline",
      render: () => (
        <NetworkModalTrafficTimeline
          traffic={n.traffic}
          down={n.down}
          up={n.up}
          ssid={n.ssid}
          ping={n.ping}
          status={n.status}
          newestBucketAt={Date.now()}
        />
      ),
    },
    {
      slug: "usage-signature",
      label: "Signature",
      render: () => (
        <NetworkModalUsageSignature ssid={n.ssid} down={n.down} up={n.up} traffic={n.traffic} />
      ),
    },
  ];

  return { variants, loading: false };
}

export const networkDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_wifi",
  title: "Network",
  defaultSlug: "connection-health",
  useVariants: useNetworkVariants,
};
