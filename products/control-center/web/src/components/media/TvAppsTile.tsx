/**
 * TvAppsTile , container for the TV Apps 4×2 tile (www-51hf.21 / A26).
 *
 * Resolves media.tvApps via tRPC with a 10s poll. Renders Skeleton while
 * pending/error (A18). On success passes apps list to TvAppsTileView.
 * Opens AllAppsModal on expand (A27).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { AllAppsModal } from "./AllAppsModal";
import { TvAppsTileView } from "./TvAppsTileView";

const TV_APPS_POLL_MS = 10_000;

export function TvAppsTile() {
  const { data, isError } = trpc.media.tvApps.useQuery(undefined, {
    refetchInterval: TV_APPS_POLL_MS,
  });

  const launchMutation = trpc.media.tvLaunchApp.useMutation();
  const [allAppsOpen, setAllAppsOpen] = useState(false);

  if (!data) {
    return (
      <TvAppsTileView
        status={isError ? "error" : "loading"}
        apps={[]}
        currentApp={null}
        onLaunchApp={() => {}}
        onOpenAllApps={() => {}}
      />
    );
  }

  return (
    <>
      <TvAppsTileView
        status="populated"
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
