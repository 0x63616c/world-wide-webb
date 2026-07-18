/**
 * TvAppsTile , container for the TV Apps 4×2 tile (www-51hf.21 / A26).
 *
 * Resolves media.tvApps via tRPC with a 10s poll. Renders Skeleton while
 * pending/error (A18). On success passes apps list to TvAppsTileView.
 * Opens AllAppsModal on expand (A27).
 */

import { useState } from "react";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { AllAppsModal } from "./AllAppsModal";
import { TvAppsTileView } from "./TvAppsTileView";

export function TvAppsTile() {
  const q = useTileQuery(
    trpc.media.tvApps.useQuery(undefined, {
      refetchInterval: POLL.tvApps,
    }),
  );

  const launchMutation = trpc.media.tvLaunchApp.useMutation();
  const [allAppsOpen, setAllAppsOpen] = useState(false);

  if (!q.data) {
    return (
      <TvAppsTileView
        status={q.status}
        apps={[]}
        currentApp={null}
        onLaunchApp={() => {}}
        onOpenAllApps={() => {}}
      />
    );
  }

  const data = q.data;
  return (
    <>
      <TvAppsTileView
        status={q.status}
        apps={data.apps}
        currentApp={data.currentApp}
        onLaunchApp={(app) => launchMutation.mutate({ app })}
        onOpenAllApps={() => setAllAppsOpen(true)}
      />

      <AllAppsModal
        open={allAppsOpen}
        onClose={() => setAllAppsOpen(false)}
        apps={data.apps}
        currentApp={data.currentApp}
        onLaunchApp={(app) => launchMutation.mutate({ app })}
      />
    </>
  );
}
