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

function linePoints(lbs: number[]): { x: number; y: number }[] {
  const min = Math.min(...lbs);
  const max = Math.max(...lbs);
  const span = lbs.length > 1 ? lbs.length - 1 : 1;
  return lbs.map((lb, i) => ({
    x: PAD + (i / span) * (W - 2 * PAD),
    y: PAD + ((max - lb) / (max - min || 1)) * (H - 2 * PAD),
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
  const pts = linePoints(lbs);
  const iMin = lbs.indexOf(Math.min(...lbs));
  const iMax = lbs.indexOf(Math.max(...lbs));
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
            {high.toFixed(1)}
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
            {low.toFixed(1)}
          </span>
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
