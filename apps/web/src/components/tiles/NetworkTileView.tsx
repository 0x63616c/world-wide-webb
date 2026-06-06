import { Skeleton, StatusDot, Tile, TileHeader, TileStatus } from "@/components/ui";

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
              background: "var(--acc-muted)",
              borderRadius: "0 0 2px 2px",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function NetworkSkeleton() {
  // Real title stays visible while loading; only the data body + the status dot
  // (data-driven) shimmer. The dot skeleton matches StatusDot's 8px footprint so
  // there is no layout shift when data lands.
  return (
    <Tile padding={22}>
      <TileHeader icon="wifi" title="Network" right={<Skeleton w={8} h={8} borderRadius={999} />} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Skeleton w={64} h={13} borderRadius={4} />
        <Skeleton w="100%" h={100} borderRadius={6} />
        <Skeleton w={64} h={13} borderRadius={4} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <Skeleton w={90} h={12} borderRadius={4} />
        <Skeleton w={44} h={12} borderRadius={4} />
      </div>
    </Tile>
  );
}

export type NetworkTileViewStatus = TileStatus;

interface NetworkTileViewBaseProps {
  status: NetworkTileViewStatus;
}

interface NetworkTileViewLoadingProps extends NetworkTileViewBaseProps {
  status: typeof TileStatus.Loading;
}

interface NetworkTileViewPopulatedProps extends NetworkTileViewBaseProps {
  status: typeof TileStatus.Populated;
  isOffline: boolean;
  down: string;
  up: string;
  ssid: string;
  ping: number;
  traffic: Array<{ down: number; up: number }>;
}

export type NetworkTileViewProps = NetworkTileViewLoadingProps | NetworkTileViewPopulatedProps;

export function NetworkTileView(props: NetworkTileViewProps) {
  if (props.status === TileStatus.Loading) return <NetworkSkeleton />;

  const { isOffline, down, up, ssid, ping, traffic } = props;

  return (
    <Tile padding={22}>
      <TileHeader icon="wifi" title="Network" right={<StatusDot online={!isOffline} />} />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div className="mono" style={{ fontSize: 12.5, color: "var(--acc)", marginBottom: 5 }}>
          ↓ {down} GB
        </div>
        {traffic.length > 0 ? (
          <ButterflyChart traffic={traffic} />
        ) : (
          <Skeleton w="100%" h={100} borderRadius={6} />
        )}
        <div className="mono" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5 }}>
          ↑ {up} GB
        </div>
      </div>

      <div
        className="cap"
        style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}
      >
        <span>{ssid}</span>
        <span>{`${ping}ms`}</span>
      </div>
    </Tile>
  );
}
