import { trpc } from "../../lib/trpc";
import { Icon, type IconName } from "../Icon";
import { Skeleton } from "../ui/Skeleton";

function Sec({
  icon,
  children,
  right,
}: {
  icon: IconName;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <Icon name={icon} s={19} c="var(--ink-2)" />
      <span
        style={{
          fontSize: 17.5,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

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
    <div
      className="tile"
      style={{ height: "100%", padding: 22, display: "flex", flexDirection: "column" }}
    >
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
    </div>
  );
}

export function WeatherNow() {
  const { data } = trpc.weather.now.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });

  if (!data) return <WeatherNowSkeleton />;

  const w = {
    temp: String(Math.round(data.temp)),
    cond: data.cond,
    hi: String(Math.round(data.hi)),
    lo: String(Math.round(data.lo)),
    feels: String(Math.round(data.feels)),
    hum: String(data.hum),
    wind: String(Math.round(data.wind)),
    sunset: data.sunset,
    city: data.city,
  };

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
      {/* Header */}
      <Sec icon="cloud-sun" right={<span className="cap">{w.city}</span>}>
        Weather Now
      </Sec>

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
            {w.temp}°
          </div>
          <div style={{ fontSize: 16, color: "var(--ink-2)", marginTop: 9 }}>{w.cond}</div>
        </div>
        <div
          className="mono"
          style={{
            marginLeft: "auto",
            textAlign: "right",
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontSize: 15 }}>H {w.hi}°</div>
          <div style={{ fontSize: 15, color: "var(--ink-2)" }}>L {w.lo}°</div>
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
        <MetricCell label="Feels" value={`${w.feels}°`} />
        <MetricCell label="Humidity" value={`${w.hum}%`} />
        <MetricCell label="Wind" value={`${w.wind} mph`} />
        <MetricCell label="Sunset" value={w.sunset} />
      </div>
    </div>
  );
}
