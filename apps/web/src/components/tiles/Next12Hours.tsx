import { useEffect, useRef, useState } from "react";
import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";

// Placeholder data for graceful degradation — mirrors weather-service PLACEHOLDER_HOURLY
const PLACEHOLDER = [
  { t: "Now", temp: 74, feels: 75, ic: "cloud-sun" },
  { t: "2", temp: 76, feels: 76, ic: "sun" },
  { t: "3", temp: 78, feels: 78, ic: "sun" },
  { t: "4", temp: 79, feels: 79, ic: "sun" },
  { t: "5", temp: 77, feels: 77, ic: "cloud-sun" },
  { t: "6", temp: 73, feels: 72, ic: "cloud" },
  { t: "7", temp: 70, feels: 69, ic: "cloud" },
  { t: "8", temp: 68, feels: 67, ic: "moon" },
  { t: "9", temp: 66, feels: 65, ic: "moon" },
  { t: "10", temp: 65, feels: 64, ic: "moon" },
  { t: "11", temp: 64, feels: 63, ic: "moon" },
  { t: "12", temp: 63, feels: 62, ic: "moon" },
] as const;

/** useWid — responsive width+height via ResizeObserver */
function useWid() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h] as const;
}

export function Next12Hours() {
  const { data, isError } = trpc.weather.hourly.useQuery(undefined, {
    refetchInterval: POLL.weather,
    retry: 2,
  });

  // Use real data, fall back to placeholder on error / loading
  const hours = data ?? PLACEHOLDER;

  const [ref, w, h] = useWid();

  const n = hours.length;
  const feels = hours.map((x) => x.feels);
  const gMin = Math.min(...hours.map((x) => x.temp), ...feels);
  const gMax = Math.max(...hours.map((x) => x.temp));
  const topRes = 22;
  const minBar = 14;
  const chartH = Math.max(120, (h || 200) - 44);

  const barH = (val: number) =>
    minBar + ((val - gMin) / (gMax - gMin || 1)) * (chartH - topRes - minBar);

  const colW = w / n;
  const cx = (i: number) => (i + 0.5) * colW;
  const barW = colW * 0.44;

  const fpts = feels
    .map((f, i) => `${cx(i).toFixed(1)},${(chartH - barH(f)).toFixed(1)}`)
    .join(" ");

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
        <Icon name="cloud" s={19} c="var(--ink-2)" />
        <span
          style={{
            fontSize: 17.5,
            fontWeight: 600,
            letterSpacing: "-.015em",
            whiteSpace: "nowrap",
          }}
        >
          Next 12 Hours
        </span>
        {/* Legend */}
        <span
          className="mono"
          style={{
            marginLeft: "auto",
            fontSize: 11,
            display: "flex",
            gap: 10,
          }}
        >
          <span style={{ color: "#6E747D" }}>┈ Feels</span>
          <span style={{ color: "var(--acc)" }}>▮ Temp</span>
        </span>
      </div>

      {/* Error notice — shown briefly over placeholder data */}
      {isError && (
        <div
          style={{
            marginBottom: 8,
            padding: "4px 10px",
            borderRadius: 8,
            background: "rgba(255,255,255,.04)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          Using cached data
        </div>
      )}

      {/* Chart area — always mounted so the ResizeObserver gets a real width;
          placeholder data renders immediately, real data swaps in on load */}
      <div ref={ref} style={{ position: "relative", flex: 1 }}>
        {w > 0 && (
          <>
            <svg
              width={w}
              height={chartH}
              style={{
                position: "absolute",
                top: 4,
                left: 0,
                overflow: "visible",
              }}
              aria-hidden="true"
            >
              {hours.map((dd, i) => {
                const hh = barH(dd.temp);
                const y = chartH - hh;
                const first = i === 0;
                return (
                  <g key={dd.t}>
                    <rect
                      x={cx(i) - barW / 2}
                      y={y}
                      width={barW}
                      height={hh}
                      rx={4}
                      fill={first ? "var(--acc)" : "var(--tile-2)"}
                      stroke={first ? "none" : "var(--hair-2)"}
                      strokeWidth={1}
                    />
                    <text
                      x={cx(i)}
                      y={y - 7}
                      textAnchor="middle"
                      fill={first ? "var(--acc)" : "var(--ink)"}
                      style={{ font: "700 11px var(--mono)" }}
                    >
                      {dd.temp}°
                    </text>
                  </g>
                );
              })}
              {/* Dotted feels-like polyline */}
              <polyline
                points={fpts}
                fill="none"
                stroke="#6E747D"
                strokeWidth={1.6}
                strokeDasharray="2 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Feels-like dots */}
              {feels.map((f, i) => (
                <circle key={hours[i].t} cx={cx(i)} cy={chartH - barH(f)} r={1.7} fill="#6E747D" />
              ))}
            </svg>

            {/* Icon + hour label row */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 4 + chartH + 6,
                display: "flex",
              }}
            >
              {hours.map((dd, i) => (
                <div
                  key={dd.t}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Icon
                    name={
                      dd.ic === "sun" ||
                      dd.ic === "moon" ||
                      dd.ic === "cloud" ||
                      dd.ic === "cloud-sun"
                        ? dd.ic
                        : "sun"
                    }
                    s={15}
                    c={i === 0 ? "var(--acc)" : "var(--ink-3)"}
                  />
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: i === 0 ? "var(--acc)" : "var(--ink-3)",
                    }}
                  >
                    {dd.t}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
