/**
 * About settings page , build provenance and device identity. The web SHA/age
 * come from the compiled-in build constants, the server SHA/age from
 * `health.buildHash`, and the native app build number from the Capacitor shell
 * (async, "n/a" in a plain browser). Everything is real; nothing is invented.
 */

import { useEffect, useState } from "react";
import { BUILD_HASH, BUILD_TIME } from "../../../config/build";
import { getInstalledBuildNumber } from "../../../lib/app-update";
import { getDeviceId } from "../../../lib/device-id";
import { formatRelativeAge } from "../../../lib/relative-age";
import { trpc } from "../../../lib/trpc";
import { Skeleton } from "../../ui/Skeleton";
import { RowShell, SectionCard } from "../blocks";

const VALUE_TEXT = { fontFamily: "var(--mono)", fontSize: 14, color: "var(--ink)" } as const;

function shortSha(hash: string): string {
  return hash.slice(0, 7);
}

/** "<sha> · <age>" when an age is available, else just the SHA. */
function shaWithAge(hash: string, builtAtMs: number, nowMs: number): string {
  const age = formatRelativeAge(builtAtMs, nowMs);
  return age ? `${shortSha(hash)} · ${age}` : shortSha(hash);
}

export function AboutPage() {
  const server = trpc.health.buildHash.useQuery();

  // Native CFBundleVersion resolves asynchronously and only on the device; a
  // plain browser (dev/Storybook) yields null, shown as "n/a".
  const [appBuild, setAppBuild] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void getInstalledBuildNumber().then((n) => {
      if (live) setAppBuild(n);
    });
    return () => {
      live = false;
    };
  }, []);

  // A single "now" captured at render is fine for a coarse age readout that only
  // needs minute/hour/day granularity.
  const now = Date.now();

  return (
    <>
      <SectionCard title="Build">
        {[
          <RowShell
            key="web"
            label="Web"
            sub="The panel bundle currently running."
            control={<span style={VALUE_TEXT}>{shaWithAge(BUILD_HASH, BUILD_TIME, now)}</span>}
          />,
          <RowShell
            key="server"
            label="Server"
            sub="The control-center API build serving this panel."
            control={
              server.isLoading ? (
                <Skeleton w={120} />
              ) : server.data ? (
                <span style={VALUE_TEXT}>
                  {shaWithAge(server.data.hash, Date.parse(server.data.deployedAt), now)}
                </span>
              ) : (
                <span style={{ ...VALUE_TEXT, color: "var(--ink-3)" }}>unavailable</span>
              )
            }
          />,
          <RowShell
            key="app"
            label="App build"
            sub="The native TestFlight build installed on this device."
            control={<span style={VALUE_TEXT}>{appBuild === null ? "n/a" : appBuild}</span>}
          />,
        ]}
      </SectionCard>

      <SectionCard title="Device">
        {[
          <RowShell
            key="id"
            label="Device ID"
            sub="Stable identity used to tag this panel's logs."
            control={<span style={VALUE_TEXT}>{getDeviceId()}</span>}
          />,
          <RowShell
            key="screen"
            label="Screen"
            sub="Fixed wall-panel resolution."
            control={<span style={VALUE_TEXT}>1366×1024</span>}
          />,
        ]}
      </SectionCard>
    </>
  );
}
