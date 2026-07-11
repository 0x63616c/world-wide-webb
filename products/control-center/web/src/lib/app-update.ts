import { Capacitor } from "@capacitor/core";
import { formatRelativeAge } from "./relative-age";

// Pure logic for the TestFlight update-available banner. The api's
// system.appUpdateStatus serves the latest installable ASC build (cached by the
// asc-version-poll worker); this module compares it against the installed
// CFBundleVersion and formats the banner copy. Kept free of React/tRPC so the
// comparison is unit-testable and the Storybook story can drive it with props.

export interface AppUpdateStatus {
  buildNumber: number;
  marketingVersion: string;
  uploadedDate: string;
  fetchedAt: string;
}

export interface AppUpdateBannerModel {
  /** Latest build number, used as the dismissal key. */
  buildNumber: number;
  message: string;
  detail: string;
}

/**
 * Installed native build number (CFBundleVersion) via @capacitor/app, or null
 * in a plain browser (dev/Storybook) where no native shell exists. Build
 * numbers are contiguous (fastlane latest_testflight_build_number + 1), so
 * "builds behind" is a plain subtraction against this value.
 */
export async function getInstalledBuildNumber(): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const build = Number.parseInt(info.build, 10);
    return Number.isFinite(build) ? build : null;
  } catch {
    return null;
  }
}

/**
 * Banner model when the panel is behind the latest TestFlight build, else null
 * (unknown installed build, no cached status yet, or already up to date).
 * e.g. message "Update available", detail "1.0 (68) · 3 builds behind · 2 days 4hrs old".
 */
export function computeAppUpdateBanner(
  installedBuild: number | null,
  status: AppUpdateStatus | null,
  nowMs: number,
): AppUpdateBannerModel | null {
  if (installedBuild === null || status === null) return null;
  const behind = status.buildNumber - installedBuild;
  if (behind <= 0) return null;

  const version = status.marketingVersion
    ? `${status.marketingVersion} (${status.buildNumber})`
    : `build ${status.buildNumber}`;
  const age = formatRelativeAge(Date.parse(status.uploadedDate), nowMs);
  const parts = [version, `${behind} build${behind === 1 ? "" : "s"} behind`];
  if (age) parts.push(`${age} old`);

  return {
    buildNumber: status.buildNumber,
    message: "Update available",
    detail: parts.join(" · "),
  };
}
