import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";

// 24-bucket fallback traffic so the chart never renders blank
const FALLBACK_TRAFFIC = Array.from({ length: 24 }, (_, i) => ({
  d: 0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + 1)) * (i > 17 || i < 2 ? 1.3 : 0.7),
  u: 0.18 + 0.5 * Math.abs(Math.cos(i * 0.4)) * 0.6,
}));

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

export function NetworkTile() {
  const { data, isLoading, isError } = trpc.network.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  // Graceful placeholders
  const status = data?.status ?? "Online";
  const ssid = data?.ssid ?? "—";
  const down = data?.down ?? "—";
  const up = data?.up ?? "—";
  const ping = data?.ping ?? "—";

  const traffic: Array<{ down: number; up: number }> =
    data?.traffic ?? FALLBACK_TRAFFIC.map((t) => ({ down: t.d, up: t.u }));

  const isOffline = !isLoading && (isError || status === "Offline");

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
          {isLoading ? "…" : status}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {ssid}
        </span>
      </div>

      {/* Download label */}
      <div className="mono" style={{ fontSize: 12.5, color: "var(--acc)", marginBottom: 5 }}>
        ↓ {down} GB
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
        <ButterflyChart traffic={traffic} />
      </div>

      {/* Upload label */}
      <div
        className="mono"
        style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5, marginBottom: 8 }}
      >
        ↑ {up} GB
      </div>

      {/* Footer: SSID + ping */}
      <div className="cap" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{ssid}</span>
        <span>{ping === "—" ? "—" : `${ping}ms`}</span>
      </div>
    </div>
  );
}
