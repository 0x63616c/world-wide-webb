/**
 * TvAppsTile , container for the TV Apps 4×2 tile (www-51hf.21 / A26).
 *
 * Resolves media.tvApps via tRPC with a 10s poll. Renders Skeleton while
 * pending/error (A18). On success passes apps list to TvAppsTileView; the
 * hero/grid buttons launch apps directly. Tapping the tile surface opens the
 * full-page All Apps detail via the board's tile-detail registry (wired in
 * detail/wiring/tv-apps.tsx).
 */

import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { TvAppsTileView } from "./TvAppsTileView";

export function TvAppsTile() {
  const q = useTileQuery(
    trpc.media.tvApps.useQuery(undefined, {
      refetchInterval: POLL.tvApps,
    }),
  );

  const launchMutation = trpc.media.tvLaunchApp.useMutation();

  if (!q.data) {
    return <TvAppsTileView status={q.status} apps={[]} currentApp={null} onLaunchApp={() => {}} />;
  }

  const data = q.data;
  return (
    <TvAppsTileView
      status={q.status}
      apps={data.apps}
      currentApp={data.currentApp}
      onLaunchApp={(app) => launchMutation.mutate({ app })}
    />
  );
}
