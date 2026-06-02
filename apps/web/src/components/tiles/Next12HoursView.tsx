import { useCallback, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Skeleton, Tile, TileHeader } from "../ui";
import { TileStatus } from "./EventsTileView";

// Width used on first render before ResizeObserver fires, preventing a
// blank frame on slow mounts (e.g. wall-panel cold start, missing ResizeObserver).
const CHART_INITIAL_WIDTH = 400;

export type HourlyEntry = {
  t: string;
  temp: number;
  feels: number;
  ic: string;
};

// Flat props shape: hours is optional so Storybook can spread args without a
// discriminated-union wrapper. status="populated" with no hours falls back to skeleton.
export type Next12HoursViewProps = {
  status: typeof TileStatus.Loading | typeof TileStatus.Populated;
  hours?: HourlyEntry[];
};

function Next12HoursSkeleton() {
  return (
    <Tile padding={22}>
      <Skeleton w="60%" h={20} borderRadius={6} />
      <div style={{ flex: 1, marginTop: 16 }}>
        <Skeleton w="100%" h="100%" borderRadius={8} />
      </div>
    </Tile>
  );
}

/** useWid — responsive width+height via ResizeObserver.
 *  Uses a CALLBACK ref (not useRef + mount effect) so the observer attaches the
 *  moment the measured node actually mounts. The chart node only renders once
 *  data is populated — it is absent during the loading skeleton — so a []-deps
 *  mount effect would run while the ref is still null and never re-attach,
 *  leaving width/height stuck at 0 (bars drawn at the 400px fallback width while
 *  the label row flexes the real width → horizontal drift). */
function useWid() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!node) return;
    const update = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    roRef.current = ro;
  }, []);
  return [ref, size.w, size.h] as const;
}

export function Next12HoursView(props: Next12HoursViewProps) {
  // All hooks must be called before any early return.
  const [ref, w, h] = useWid();

  if (props.status !== TileStatus.Populated || !props.hours?.length) return <Next12HoursSkeleton />;

  const hours = props.hours;
  const n = hours.length;
  const feels = hours.map((x) => x.feels);
  const gMin = Math.min(...hours.map((x) => x.temp), ...feels);
  const gMax = Math.max(...hours.map((x) => x.temp));
  const topRes = 22;
  const minBar = 14;
  const chartH = Math.max(120, (h || 200) - 44);

  const barH = (val: number) =>
    minBar + ((val - gMin) / (gMax - gMin || 1)) * (chartH - topRes - minBar);

  // Use measured width or initial width so the chart is never blank on first paint.
  const renderW = w || CHART_INITIAL_WIDTH;
  const colW = renderW / n;
  const cx = (i: number) => (i + 0.5) * colW;
  const barW = colW * 0.44;

  const fpts = feels
    .map((f, i) => `${cx(i).toFixed(1)},${(chartH - barH(f)).toFixed(1)}`)
    .join(" ");

  return (
    <Tile padding={22}>
      {/* Section header */}
      <TileHeader
        icon="cloud"
        title="Next 12 Hours"
        right={
          <span className="mono" style={{ fontSize: 11, display: "flex", gap: 10 }}>
            <span style={{ color: "rgba(255,255,255,0.35)" }}>┈ Feels</span>
            <span style={{ color: "var(--acc)" }}>▮ Temp</span>
          </span>
        }
      />

      {/* Chart area */}
      <div ref={ref} style={{ position: "relative", flex: 1 }}>
        <svg
          width={renderW}
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
          {/* Dotted feels-like polyline — secondary reference, kept subtle under temp bars */}
          <polyline
            points={fpts}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
            strokeDasharray="2 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.45}
          />
          {/* Feels-like dots — smaller to stay secondary */}
          {feels.map((f, i) => (
            <circle
              key={hours[i].t}
              cx={cx(i)}
              cy={chartH - barH(f)}
              r={1}
              fill="rgba(255,255,255,0.18)"
              opacity={0.45}
            />
          ))}
        </svg>

        {/* Icon + hour label row.
            Sits 2px under the bar baseline (not 6) — the solid bar edge reads
            heavier than the thin icon, so an equal box-gap looked lopsided
            toward the chart. 4px here (vs the 6px icon→time gap) lands the icon
            glyph visually centered between the bar baseline and the time label. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 4 + chartH + 4,
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
                gap: 6,
              }}
            >
              <Icon
                name={
                  dd.ic === "sun" || dd.ic === "moon" || dd.ic === "cloud" || dd.ic === "cloud-sun"
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
      </div>
    </Tile>
  );
}
