/**
 * Network settings page , live Wi-Fi/WAN readouts from `network.status` plus the
 * panel's own connection health. All values are real: the Wi-Fi card is the
 * tRPC query (Skeleton while loading, "unavailable" on error/absent), and the
 * Panel card reflects this browser's actual connection state, never a fixture.
 *
 * The two cards are separate components on purpose. `useConnectionStatus`
 * subscribes to the React Query cache and calls setState on every cache event;
 * if it shared a component with the `network.status` query observer, each such
 * setState would re-render that observer, emit a fresh cache event, and feed
 * back into an infinite render loop. Keeping the query observer (WifiCard) and
 * the cache subscriber (PanelCard) in different component instances breaks that
 * cycle , PanelCard's re-renders produce no query-cache events.
 */

import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";
import { useConnectionStatus } from "../../../lib/useConnectionStatus";
import { Skeleton } from "../../ui/Skeleton";
import { StatusDot } from "../../ui/StatusDot";
import { RowShell, SectionCard } from "../blocks";

const VALUE_TEXT = { fontFamily: "var(--mono)", fontSize: 14, color: "var(--ink)" } as const;
const UNAVAILABLE_TEXT = { ...VALUE_TEXT, color: "var(--ink-3)" } as const;

/** Mono value, a Skeleton while the query is in flight, or plain "unavailable". */
function ValueOr({
  loading,
  available,
  children,
}: {
  loading: boolean;
  available: boolean;
  children: React.ReactNode;
}) {
  if (loading) return <Skeleton w={72} />;
  if (!available) return <span style={UNAVAILABLE_TEXT}>unavailable</span>;
  return <span style={VALUE_TEXT}>{children}</span>;
}

/** A StatusDot paired with its label, the shared shape for the on/off rows. */
function DotValue({ online, label }: { online: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <StatusDot online={online} />
      <span style={VALUE_TEXT}>{label}</span>
    </span>
  );
}

/** Clock time of an event timestamp, for the "connection lost since" sub-line. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function WifiCard() {
  const wifi = trpc.network.status.useQuery();
  const loading = wifi.isLoading;
  const data = wifi.data;
  const has = !!data;
  const wanOnline = data?.status === "Online";

  return (
    <SectionCard title="Wi-Fi">
      {[
        <RowShell
          key="ssid"
          label="Network"
          sub="The Wi-Fi network this panel is joined to."
          control={
            <ValueOr loading={loading} available={has}>
              {data?.ssid}
            </ValueOr>
          }
        />,
        <RowShell
          key="wan"
          label="WAN status"
          sub="Whether the router can reach the internet."
          control={
            loading ? (
              <Skeleton w={72} />
            ) : !has ? (
              <span style={UNAVAILABLE_TEXT}>unavailable</span>
            ) : (
              <DotValue online={wanOnline} label={wanOnline ? "Online" : "Offline"} />
            )
          }
        />,
        <RowShell
          key="ping"
          label="Gateway ping"
          sub="Round-trip latency to the router."
          control={
            <ValueOr loading={loading} available={has}>
              {data ? `${data.ping} ms` : null}
            </ValueOr>
          }
        />,
        <RowShell
          key="down"
          label="Download (24 h)"
          sub="WAN data pulled down in the last day."
          control={
            <ValueOr loading={loading} available={has}>
              {data ? `${data.down} GB` : null}
            </ValueOr>
          }
        />,
        <RowShell
          key="up"
          label="Upload (24 h)"
          sub="WAN data pushed up in the last day."
          control={
            <ValueOr loading={loading} available={has}>
              {data ? `${data.up} GB` : null}
            </ValueOr>
          }
        />,
      ]}
    </SectionCard>
  );
}

function PanelCard() {
  const conn = useConnectionStatus();

  // The panel's own reachability, distinct from WAN status: navigator.onLine
  // flips when this device loses its link, tracked live via the browser events.
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return (
    <SectionCard title="Panel">
      {[
        <RowShell
          key="conn"
          label="Connection"
          sub={
            conn.isLost && conn.since
              ? `Lost contact with the server at ${clockTime(conn.since)}.`
              : "This panel's link to the control-center server."
          }
          control={
            <DotValue online={!conn.isLost} label={conn.isLost ? "connection lost" : "connected"} />
          }
        />,
        <RowShell
          key="browser"
          label="Browser online"
          sub="Whether this device reports a network connection."
          control={<DotValue online={browserOnline} label={browserOnline ? "online" : "offline"} />}
        />,
      ]}
    </SectionCard>
  );
}

export function NetworkPage() {
  return (
    <>
      <WifiCard />
      <PanelCard />
    </>
  );
}
