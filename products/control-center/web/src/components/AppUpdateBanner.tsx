import { useEffect, useState } from "react";
import {
  type AppUpdateBannerModel,
  computeAppUpdateBanner,
  getInstalledBuildNumber,
} from "../lib/app-update";
import { trpc } from "../lib/trpc";
import { useNotifications } from "../lib/useNotifications";
import { NotificationBanner } from "./ui/NotificationBanner";

const NOTIF_ID = "app-update";
// The asc-version-poll worker refreshes the server cache every minute; the
// panel only needs to notice within a few minutes, so poll slowly.
const REFETCH_MS = 5 * 60_000;

/**
 * "Update available" banner (top-right inside .board, below the connection
 * banner's slot) shown when the installed iOS shell is behind the latest
 * TestFlight build in ASC. Feeds the shared notifications store (same www-awm
 * seam as ConnectionLostBanner). Not dismissible: stays up until the
 * installed build catches up. Renders nothing in a plain browser (no native
 * shell to be behind).
 */
export function AppUpdateBanner() {
  const [installedBuild, setInstalledBuild] = useState<number | null>(null);

  useEffect(() => {
    let canceled = false;
    void getInstalledBuildNumber().then((build) => {
      if (!canceled) setInstalledBuild(build);
    });
    return () => {
      canceled = true;
    };
  }, []);

  // A plain browser (dev, tests, Storybook) has no installed build to compare
  // against; bailing before the query child mounts also keeps Board renderable
  // without a tRPC provider in component tests.
  if (installedBuild === null) return null;
  return <AppUpdateBannerQuery installedBuild={installedBuild} />;
}

function AppUpdateBannerQuery({ installedBuild }: { installedBuild: number }) {
  const { raiseNotification, clearNotification } = useNotifications();

  const { data: status } = trpc.system.appUpdateStatus.useQuery(undefined, {
    refetchInterval: REFETCH_MS,
  });

  const banner: AppUpdateBannerModel | null = computeAppUpdateBanner(
    installedBuild,
    status ?? null,
    Date.now(),
  );
  const visible = banner !== null;

  // Primitive captures keep the effect's dependency list exact (biome
  // useExhaustiveDependencies) and re-raise when a newer build changes the copy.
  const message = banner?.message ?? null;
  const detail = banner?.detail ?? null;
  useEffect(() => {
    if (visible && message) {
      raiseNotification({ id: NOTIF_ID, message, detail: detail ?? undefined });
    } else {
      clearNotification(NOTIF_ID);
    }
  }, [visible, message, detail, raiseNotification, clearNotification]);

  if (!visible || !banner) return null;

  return <AppUpdateBannerView model={banner} />;
}

/** Presentational banner, exported for Storybook. */
export function AppUpdateBannerView({ model }: { model: AppUpdateBannerModel }) {
  return (
    <NotificationBanner tone="green">
      {model.message}
      <span style={{ opacity: 0.7 }}> · {model.detail}</span>
    </NotificationBanner>
  );
}
