import { Segmented, Skeleton, Stat, TileStatus } from "@/components/ui";

/**
 * WeightPageView — presentational Trend page body for the weight detail page
 * (spec 2026-07-21-weight-tile-design). Hosted by TileDetailHost (which owns
 * the PageHeader/back button): first row = centered 7d/30d/All range picker
 * with the current weight on the right, chart flex-fills the middle, and the
 * Low/High/Average/Change stat row pins to the bottom. Ported from the
 * approved WeightConceptDetail concept.
 */

export type WeightRange = "7d" | "30d" | "all";

export interface WeightPageViewProps {
  status: TileStatus;
  range: WeightRange;
  onRangeChange: (range: WeightRange) => void;
  /** Latest included reading, lb. */
  lb?: number;
  /** Daily medians for the window, lb, oldest → newest. */
  daily?: { day: string; lb: number }[];
  low?: number;
  high?: number;
  average?: number;
  change?: number;
  /** e.g. "Jun 22 – Today". */
  windowLabel?: string;
}

const RANGE_OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
];

// Chart viewBox; stretched to the flexed box with preserveAspectRatio none.
const W = 1120;
const H = 380;
const PAD = 16;

/** Position by real elapsed days, not array index — a skipped weigh-in has to
 *  read as a gap, or the line misstates how fast the weight moved. */
function linePoints(daily: { day: string; lb: number }[]): { x: number; y: number }[] {
  const lbs = daily.map((d) => d.lb);
  const min = Math.min(...lbs);
  const max = Math.max(...lbs);
  const t = daily.map((d) => new Date(`${d.day}T00:00:00`).getTime());
  const t0 = t[0] ?? 0;
  const span = (t[t.length - 1] ?? t0) - t0 || 1;
  return daily.map((d, i) => ({
    x: PAD + (((t[i] ?? t0) - t0) / span) * (W - 2 * PAD),
    y: PAD + ((max - d.lb) / (max - min || 1)) * (H - 2 * PAD),
  }));
}

function pathFrom(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function PageSkeleton() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ alignSelf: "center" }}>
        <Skeleton w={360} h={40} borderRadius={10} />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Skeleton w="100%" h="100%" borderRadius={12} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Skeleton w="100%" h={64} borderRadius={10} />
        <Skeleton w="100%" h={64} borderRadius={10} />
        <Skeleton w="100%" h={64} borderRadius={10} />
        <Skeleton w="100%" h={64} borderRadius={10} />
      </div>
    </div>
  );
}

export function WeightPageView(props: WeightPageViewProps) {
  const { status, range, onRangeChange, lb, daily, low, high, average, change, windowLabel } =
    props;
  // Loading/error and day-one empty (no daily series yet) share the skeleton.
  if (
    status !== TileStatus.Populated ||
    lb == null ||
    daily == null ||
    daily.length === 0 ||
    low == null ||
    high == null ||
    average == null ||
    change == null
  ) {
    return <PageSkeleton />;
  }

  const lbs = daily.map((d) => d.lb);
  // Below two daily points there is no line to draw: one dot on an axis whose
  // min and max labels are identical reads as a broken chart, not as "no data
  // yet". Matches what 3e68f7ff6 did for the tile sparkline.
  const enoughForChart = daily.length >= 2;
  const pts = enoughForChart ? linePoints(daily) : [];
  const dailyMin = Math.min(...lbs);
  const dailyMax = Math.max(...lbs);
  const iMin = lbs.indexOf(dailyMin);
  const iMax = lbs.indexOf(dailyMax);
  const gridMin = pts[iMin];
  const gridMax = pts[iMax];
  const last = pts[pts.length - 1];

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "0 72px",
      }}
    >
      {/* Range picker centered; current weight on the right (host owns the
          header, so the hero number lives in the body's first row). */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 360 }}>
          <Segmented
            label="Range"
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => onRangeChange(v as WeightRange)}
          />
        </div>
        <span
          className="mono"
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {lb.toFixed(1)}
          <span style={{ fontSize: 15, fontWeight: 400, color: "var(--ink-2)" }}> lb</span>
        </span>
      </div>
      {/* Chart fills the space between picker and stats */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {enoughForChart ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: "100%", display: "block" }}
              aria-hidden="true"
            >
              {gridMax && (
                <line
                  x1={PAD}
                  x2={W - PAD}
                  y1={gridMax.y}
                  y2={gridMax.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              )}
              {gridMin && (
                <line
                  x1={PAD}
                  x2={W - PAD}
                  y1={gridMin.y}
                  y2={gridMin.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              )}
              <path
                d={pathFrom(pts)}
                fill="none"
                stroke="var(--acc)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </svg>
            {/* Round latest-point dot — outside the stretched svg so it stays round */}
            {last && (
              <span
                style={{
                  position: "absolute",
                  left: `${(last.x / W) * 100}%`,
                  top: `${(last.y / H) * 100}%`,
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  background: "var(--acc)",
                  transform: "translate(-50%, -50%)",
                }}
              />
            )}
            {/* Axis labels describe the DAILY series, which is what the line
                plots. low/high are raw-reading figures and no longer sit on it. */}
            {gridMax && (
              <span
                className="mono"
                style={{
                  position: "absolute",
                  left: 0,
                  top: `calc(${(gridMax.y / H) * 100}% - 20px)`,
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                {dailyMax.toFixed(1)}
              </span>
            )}
            {gridMin && (
              <span
                className="mono"
                style={{
                  position: "absolute",
                  left: 0,
                  top: `calc(${(gridMin.y / H) * 100}% + 8px)`,
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                {dailyMin.toFixed(1)}
              </span>
            )}
          </>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 15, color: "var(--ink-2)" }}>Not enough data yet</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
              The trend starts once you have weighed in on a second day.
            </span>
          </div>
        )}
        {windowLabel && (
          <span
            className="mono"
            style={{
              position: "absolute",
              right: 0,
              bottom: -18,
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {windowLabel}
          </span>
        )}
      </div>
      {/* Stats for the selected window — pinned under the chart */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginTop: 8,
          flexShrink: 0,
        }}
      >
        <Stat label="Low" value={`${low.toFixed(1)} lb`} />
        <Stat label="High" value={`${high.toFixed(1)} lb`} />
        <Stat label="Average" value={`${average.toFixed(1)} lb`} />
        <Stat label="Change" value={`${change > 0 ? "+" : ""}${change.toFixed(1)} lb`} accent />
      </div>
    </div>
  );
}
