import { Icon } from "../Icon";
import { Skeleton, Tile, TileHeader, TileStatus } from "../ui";

// MetricCell uses a smaller type scale (10px cap / 16px mono) than the shared
// Stat primitive (cap / 22px mono) — kept private to match the design's compact
// 4-metric footer. Do not replace with shared Stat without a design sign-off.
function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cap" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 16, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function WeatherNowSkeleton() {
  return (
    <Tile padding={22}>
      <Skeleton w="50%" h={20} borderRadius={6} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flex: 1 }}>
          <Skeleton w={76} h={76} borderRadius={12} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton w={120} h={52} borderRadius={8} />
            <Skeleton w={80} h={18} borderRadius={6} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton w={48} h={16} borderRadius={6} />
            <Skeleton w={48} h={16} borderRadius={6} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton w="60%" h={10} borderRadius={4} />
              <Skeleton w="80%" h={16} borderRadius={4} />
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}

// When status is "populated" all remaining fields are required; otherwise they
// are unused so we make them optional to keep call sites clean.
export type WeatherNowViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error }
  | {
      status: typeof TileStatus.Populated;
      temp: string;
      cond: string;
      hi: string;
      lo: string;
      feels: string;
      hum: string;
      wind: string;
      city: string;
      solarLabel: string;
      solarValue: string;
    };

export function WeatherNowView(props: WeatherNowViewProps) {
  if (props.status !== TileStatus.Populated) {
    return <WeatherNowSkeleton />;
  }

  const { temp, cond, hi, lo, feels, hum, wind, city, solarLabel, solarValue } = props;

  return (
    <Tile padding={22}>
      {/* Header */}
      <TileHeader
        icon="cloud-sun"
        title="Weather Now"
        right={<span className="cap">{city}</span>}
      />

      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 20 }}>
        <Icon name="cloud-sun" s={76} c="var(--ink)" sw={1.3} />
        <div>
          <div
            className="mono"
            style={{
              fontSize: 66,
              fontWeight: 700,
              lineHeight: 0.8,
              letterSpacing: "-0.04em",
            }}
          >
            {temp}°
          </div>
          <div style={{ fontSize: 16, color: "var(--ink-2)", marginTop: 9 }}>{cond}</div>
        </div>
        <div
          className="mono"
          style={{
            marginLeft: "auto",
            textAlign: "right",
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontSize: 15 }}>H {hi}°</div>
          <div style={{ fontSize: 15, color: "var(--ink-2)" }}>L {lo}°</div>
        </div>
      </div>

      <div className="divider" style={{ margin: "4px 0 14px" }} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
        }}
      >
        <MetricCell label="Feels" value={`${feels}°`} />
        <MetricCell label="Humidity" value={`${hum}%`} />
        <MetricCell label="Wind" value={`${wind} mph`} />
        <MetricCell label={solarLabel} value={solarValue} />
      </div>
    </Tile>
  );
}
