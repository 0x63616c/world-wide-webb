import { useCallback, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Skeleton, Tile, TileHeader, TileStatus } from "../ui";

// Vertical rhythm token. The SAME value separates bar→icon and icon→time, so the
// spacing is even by construction — there are no per-element pixel offsets to tune.
const GAP = 6;
// Bar width as a fraction of its column — a proportion, so it scales with the tile.
const BAR_WIDTH = "44%";
// px reserved above the tallest bar for its temp label (one mono line) and the
// px floor so the coldest hour still reads as a bar. These are scale inputs to the
// value→height mapping, not layout nudges.
const LABEL_HEADROOM = 22;
const MIN_BAR = 14;
// First-paint fallbacks before the ResizeObserver reports real dimensions.
const INITIAL_W = 360;
const INITIAL_H = 180;

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
  // feels must bound gMax as well as gMin — otherwise a feels value hotter than the
  // hottest temp lands above the band top and the overflow:visible overlay paints
  // the dashed line up over the header/title.
  const gMax = Math.max(...hours.map((x) => x.temp), ...feels);

  // Measured bar-band dimensions drive the value→height scale (h) and the
  // feels-like overlay's pixel coords (w). Bar heights are px so MIN_BAR and
  // LABEL_HEADROOM are honoured at any tile size.
  const bandW = w || INITIAL_W;
  const bandH = h || INITIAL_H;
  const barH = (val: number) =>
    MIN_BAR + ((val - gMin) / (gMax - gMin || 1)) * Math.max(0, bandH - LABEL_HEADROOM - MIN_BAR);

  // Feels-like overlay coords. x = column centre ((i+0.5)/n) — identical to where
  // each flex:1 column centres — so the line tracks the bars without any matching math.
  const colCx = (i: number) => ((i + 0.5) * bandW) / n;
  const fpts = feels
    .map((f, i) => `${colCx(i).toFixed(1)},${(bandH - barH(f)).toFixed(1)}`)
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

      {/* Chart: a bar band stacked over a label band, separated by one GAP. The
          icon→time gap inside each label column is the SAME GAP, so bar→icon and
          icon→time are even by construction — no per-element offsets. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: GAP }}>
        {/* Bar band — one flex:1 column per hour; bars share a baseline via flex-end */}
        <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
          {hours.map((dd, i) => {
            const first = i === 0;
            return (
              <div
                key={dd.t}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                {/* Temp label rides directly on top of its bar */}
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 5,
                    color: first ? "var(--acc)" : "var(--ink)",
                  }}
                >
                  {dd.temp}°
                </span>
                <div
                  data-bar=""
                  data-temp={dd.temp}
                  style={{
                    width: BAR_WIDTH,
                    height: barH(dd.temp),
                    borderRadius: 4,
                    background: first ? "var(--acc)" : "var(--tile-2)",
                    border: first ? "none" : "1px solid var(--hair-2)",
                  }}
                />
              </div>
            );
          })}

          {/* Feels-like reference — a single overlay spanning the whole bar band
              (inset:0), so it can draw across columns. Pixel coords from the
              measured band; no preserveAspectRatio stretch, so dashes stay crisp. */}
          <svg
            width={bandW}
            height={bandH}
            style={{ position: "absolute", inset: 0, overflow: "visible" }}
            aria-hidden="true"
          >
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
            {feels.map((f, i) => (
              <circle
                key={hours[i].t}
                cx={colCx(i)}
                cy={bandH - barH(f)}
                r={1}
                fill="rgba(255,255,255,0.18)"
                opacity={0.45}
              />
            ))}
          </svg>
        </div>

        {/* Label band — same flex:1 columns as the bars above, so icon + time stay
            locked under their bar with zero alignment math. */}
        <div style={{ display: "flex" }}>
          {hours.map((dd, i) => (
            <div
              key={dd.t}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: GAP,
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
                style={{ fontSize: 11, color: i === 0 ? "var(--acc)" : "var(--ink-3)" }}
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
