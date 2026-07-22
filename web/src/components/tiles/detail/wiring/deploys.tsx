/**
 * Deploys tile , live wiring for its single detail-page variant.
 *
 * Data source: trpc.github.status (same endpoint the tile polls), re-queried
 * here at the same cadence while the page is open. Derivation helpers
 * (formatAgo/formatElapsed/staleForOf/toModalCommits) live in DeployTile.tsx ,
 * pure and shared, so the tile face and this page always agree on formatting.
 */

import {
  formatAgo,
  formatElapsed,
  staleForOf,
  toModalCommits,
} from "@/components/tiles/DeployTile";
import { DeployModalPipeline } from "@/components/tiles/modals/DeployModalPipeline";
import { POLL, useNow } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

const SHORT_SHA_LEN = 9;

function useDeploysVariants(): { variants: DetailVariant[]; loading: boolean } {
  const query = trpc.github.status.useQuery(undefined, { refetchInterval: POLL.deploy });
  const now = useNow();

  const d = query.data;
  // No data yet, unconfigured, or the worker has not completed a poll (no
  // deployed pointer to render): skeleton, never invented data , mirrors the
  // tile face's loading verdict.
  if (!d?.configured || !d.deployedSha) return { variants: [], loading: true };

  const nowMs = now.getTime();
  const run = d.run
    ? {
        jobName: d.run.jobName,
        stepName: d.run.stepName,
        elapsed: formatElapsed(d.run.startedAtUtc, nowMs),
        htmlUrl: d.run.htmlUrl,
      }
    : null;

  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "Deploys",
      render: () => (
        <DeployModalPipeline
          deployedSha={(d.deployedSha ?? "").slice(0, SHORT_SHA_LEN)}
          deployedWhen={d.deployedAtUtc ? `${formatAgo(d.deployedAtUtc, nowMs)} ago` : ""}
          run={run}
          failure={
            d.failure
              ? {
                  jobName: d.failure.jobName,
                  stepName: d.failure.stepName,
                  logTail: d.failure.logTail ?? "(log tail not captured yet)",
                  htmlUrl: d.failure.htmlUrl,
                }
              : null
          }
          commits={toModalCommits(d, nowMs)}
          staleFor={staleForOf(d, nowMs)}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const deploysDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_deploys",
  title: "Deploys",
  defaultSlug: "detail",
  useVariants: useDeploysVariants,
};
