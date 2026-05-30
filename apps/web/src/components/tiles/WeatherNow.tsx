import { trpc } from "../../lib/trpc";
import { Icon, type IconName } from "../Icon";

/** Fallback shown when data is unavailable. */
const PLACEHOLDER = {
  temp: "--",
  cond: "—",
  hi: "--",
  lo: "--",
  feels: "--",
  hum: "--",
  wind: "--",
  sunset: "--:--",
  city: "Los Angeles",
};

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

/** Skeleton pulse line for loading state. */
function SkeletonLine({ w, h = 12 }: { w: number | string; h?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        background: "var(--tile-2)",
        opacity: 0.6,
      }}
    />
  );
}

export function WeatherNow() {
  const { data, isLoading, isError } = trpc.weather.now.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });

  const dim = isError && !data;

  const w = data
    ? {
        temp: String(Math.round(data.temp)),
        cond: data.cond,
        hi: String(Math.round(data.hi)),
        lo: String(Math.round(data.lo)),
        feels: String(Math.round(data.feels)),
        hum: String(data.hum),
        wind: String(Math.round(data.wind)),
        sunset: data.sunset,
        city: data.city,
      }
    : PLACEHOLDER;

  return (
    <div
      className="tile"
      style={{
        height: "100%",
        padding: 22,
        display: "flex",
        flexDirection: "column",
        opacity: dim ? 0.55 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      {/* Header */}
      <Sec icon="cloud-sun" right={<span className="cap">{w.city}</span>}>
        Weather Now
      </Sec>

      {/* Main body */}
      {isLoading ? (
        /* Loading skeleton */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flex: 1 }}>
            <SkeletonLine w={76} h={76} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonLine w={120} h={52} />
              <SkeletonLine w={80} h={18} />
            </div>
            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              <SkeletonLine w={48} h={16} />
              <SkeletonLine w={48} h={16} />
            </div>
          </div>
          <div className="divider" style={{ margin: "4px 0 14px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <SkeletonLine w="60%" h={10} />
                <SkeletonLine w="80%" h={16} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Data (or graceful fallback) */
        <>
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
        </>
      )}
    </div>
  );
}
