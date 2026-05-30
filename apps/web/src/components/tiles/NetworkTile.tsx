import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";
import { Skeleton } from "../ui/Skeleton";

interface ButterflyChartProps {
  traffic: Array<{ down: number; up: number }>;
}

function ButterflyChart({ traffic }: ButterflyChartProps) {
  const half = 50;
  const dMax = Math.max(...traffic.map((t) => t.down), 0.001);
  const uMax = Math.max(...traffic.map((t) => t.up), 0.001);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: half * 2,
      }}
    >
      {traffic.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static-length chart buckets
        <div key={i} style={{ flex: 1, position: "relative", height: "100%" }}>
          {/* download bar — grows upward from center */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "50%",
              height: (t.down / dMax) * half,
              background: "var(--acc)",
              borderRadius: "2px 2px 0 0",
              opacity: i > 21 ? 1 : 0.82,
            }}
          />
          {/* upload bar — grows downward from center */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "50%",
              height: (t.up / uMax) * half,
              background: "#3a4049",
              borderRadius: "0 0 2px 2px",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function NetworkSkeleton() {
  return (
    <div
      className="tile"
      style={{ height: "100%", padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Skeleton w="50%" h={20} borderRadius={6} />
      <Skeleton w="40%" h={26} borderRadius={6} />
      <Skeleton w="30%" h={14} borderRadius={6} />
      <div style={{ flex: 1 }}>
        <Skeleton w="100%" h="100%" borderRadius={6} />
      </div>
      <Skeleton w="30%" h={14} borderRadius={6} />
      <Skeleton w="100%" h={16} borderRadius={6} />
    </div>
  );
}

export function NetworkTile() {
  const { data } = trpc.network.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (!data) return <NetworkSkeleton />;

  const isOffline = data.status === "Offline";

  return (
    <div
      className="tile"
      style={{
        height: "100%",
        padding: 22,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div className="sec">
          <span className="ic">
            <Icon name="wifi" s={16} c="var(--ink-2)" />
          </span>
          <span
            style={{
              fontSize: 17.5,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              whiteSpace: "nowrap",
            }}
          >
            Network
          </span>
        </div>
        <span style={{ marginLeft: "auto" }}>
          {isOffline ? (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#565c66",
                display: "inline-block",
              }}
            />
          ) : (
            <span className="dot" role="status" aria-label="Online" />
          )}
        </span>
      </div>

      {/* Status + SSID line */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: isOffline ? "var(--ink-3)" : "var(--acc)",
          }}
        >
          {data.status}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {data.ssid}
        </span>
      </div>

      {/* Download label */}
      <div className="mono" style={{ fontSize: 12.5, color: "var(--acc)", marginBottom: 5 }}>
        ↓ {data.down} GB
      </div>

      {/* Butterfly chart */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {data.traffic.length > 0 && <ButterflyChart traffic={data.traffic} />}
      </div>

      {/* Upload label */}
      <div
        className="mono"
        style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5, marginBottom: 8 }}
      >
        ↑ {data.up} GB
      </div>

      {/* Footer: SSID + ping */}
      <div className="cap" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{data.ssid}</span>
        <span>{`${data.ping}ms`}</span>
      </div>
    </div>
  );
}
