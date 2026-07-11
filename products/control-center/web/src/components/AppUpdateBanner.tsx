import { useEffect, useState } from "react";
import {
  type AppUpdateBannerModel,
  computeAppUpdateBanner,
  getInstalledBuildNumber,
} from "../lib/app-update";
import { trpc } from "../lib/trpc";
import { useNotifications } from "../lib/useNotifications";

const NOTIF_ID = "app-update";
// The asc-version-poll worker refreshes the server cache every minute; the
// panel only needs to notice within a few minutes, so poll slowly.
const REFETCH_MS = 5 * 60_000;

/**
 * "Update available" banner (top-right inside .board, below the connection
 * banner's slot) shown when the installed iOS shell is behind the latest
 * TestFlight build in ASC. Feeds the shared notifications store (same www-awm
 * seam as ConnectionLostBanner). Dismissible per build: dismissing hides the
 * banner until an even newer build appears; a reload re-raises it while still
 * behind. Renders nothing in a plain browser (no native shell to be behind).
 */
export function AppUpdateBanner() {
  const [installedBuild, setInstalledBuild] = useState<number | null>(null);
  const [dismissedBuild, setDismissedBuild] = useState<number | null>(null);
  const { raiseNotification, clearNotification } = useNotifications();

  useEffect(() => {
    let cancelled = false;
    void getInstalledBuildNumber().then((build) => {
      if (!cancelled) setInstalledBuild(build);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: status } = trpc.system.appUpdateStatus.useQuery(undefined, {
    refetchInterval: REFETCH_MS,
    // A plain browser has no installed build to compare against , skip entirely.
    enabled: installedBuild !== null,
  });

  const banner: AppUpdateBannerModel | null = computeAppUpdateBanner(
    installedBuild,
    status ?? null,
    Date.now(),
  );
  const visible = banner !== null && banner.buildNumber !== dismissedBuild;

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

  return (
    <AppUpdateBannerView model={banner} onDismiss={() => setDismissedBuild(banner.buildNumber)} />
  );
}

/** Presentational banner, exported for Storybook. */
export function AppUpdateBannerView({
  model,
  onDismiss,
}: {
  model: AppUpdateBannerModel;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: 62,
        right: 18,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: "rgba(122, 196, 143, 0.1)",
        border: "1px solid rgba(122, 196, 143, 0.35)",
        color: "var(--green, #7ac48f)",
        fontSize: 13,
        fontFamily: "var(--ui, system-ui)",
        letterSpacing: "-0.01em",
        backdropFilter: "blur(6px)",
        // The overlay layer is pointerEvents: none; re-enable so ✕ is tappable.
        pointerEvents: "auto",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--green, #7ac48f)",
          opacity: 0.8,
          flexShrink: 0,
        }}
      />
      <span>
        {model.message}
        <span style={{ opacity: 0.7 }}> · {model.detail}</span>
      </span>
      <button
        type="button"
        aria-label="Dismiss update notification"
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "inherit",
          opacity: 0.6,
          cursor: "pointer",
          padding: "0 2px",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
