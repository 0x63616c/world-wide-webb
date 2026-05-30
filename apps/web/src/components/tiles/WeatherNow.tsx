import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";
import { Skeleton, Tile, TileHeader } from "../ui";

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

// Format an ISO local datetime "2024-06-01T19:52" as "h:mm AM/PM"
function formatIsoTime(iso: string): string {
  const parts = iso.match(/T(\d+):(\d+)/);
  if (!parts) return iso;
  let h = parseInt(parts[1], 10);
  const m = parts[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Parse "2024-06-01T19:52" to a Date treating the string as local wall-clock time.
// Open-Meteo returns local datetime strings without a timezone suffix.
function isoLocalToDate(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(0);
  return new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10),
  );
}

// Determine which solar event to show: Sunset before it occurs, then Sunrise after.
// Uses full calendar-aware comparison so night hours are correctly classified.
function nextSolarEvent(
  now: Date,
  sunsetIso: string,
  tomorrowSunriseIso: string,
): { label: string; value: string } {
  const sunsetDate = isoLocalToDate(sunsetIso);
  const tomorrowSunriseDate = isoLocalToDate(tomorrowSunriseIso);

  if (now < sunsetDate) {
    return { label: "Sunset", value: formatIsoTime(sunsetIso) };
  }

  if (now < tomorrowSunriseDate) {
    return { label: "Sunrise", value: formatIsoTime(tomorrowSunriseIso) };
  }

  // Past tomorrow's sunrise — next sunset is the upcoming one for the day
  return { label: "Sunset", value: formatIsoTime(sunsetIso) };
}

export function WeatherNow() {
  const { data, isError } = trpc.weather.now.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    retry: 2,
  });

  if (!data || isError) return <WeatherNowSkeleton />;

  const w = {
    temp: String(Math.round(data.temp)),
    cond: data.cond,
    hi: String(Math.round(data.hi)),
    lo: String(Math.round(data.lo)),
    feels: String(Math.round(data.feels)),
    hum: String(data.hum),
    wind: String(Math.round(data.wind)),
    city: data.city,
  };

  const solarEvent = nextSolarEvent(new Date(), data.sunsetIso, data.tomorrowSunriseIso);

  return (
    <Tile padding={22}>
      {/* Header */}
      <TileHeader
        icon="cloud-sun"
        title="Weather Now"
        right={<span className="cap">{w.city}</span>}
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
        <MetricCell label={solarEvent.label} value={solarEvent.value} />
      </div>
    </Tile>
  );
}
