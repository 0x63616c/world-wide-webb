/**
 * FrontendLogsTileView , the board's window onto the panel's own log store.
 *
 * The wall panel is a TestFlight Capacitor build with no attachable inspector
 * (see logs/LogsView.tsx); the Logs settings page is the only log viewer, and
 * until now the only way to know it was worth opening was to open it. This tile
 * is the tell: the last 24h of the panel's OWN frontend logs , an hourly
 * histogram of every level (when it got loud) over a full level tally (how loud,
 * how bad). Tapping the tile deep-links into Settings → Logs (behind the PIN).
 *
 * All four levels are charted, stacked error-on-top so the severe end of the
 * scale reads first even when debug volume dominates the bar height.
 */

import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { LOG_LEVELS, type LogLevel } from "../../lib/log/types";

/** Same status colors as LogsView , level identity is always color + label. */
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "var(--ink-3, #6b7280)",
  info: "var(--ink-2, #9ca3af)",
  warn: "#e0a02c",
  error: "#e5484d",
};

const CHART_H = 64;

/** Stacking order, topmost first , severity reads from the top of the bar down. */
const STACK_ORDER = [...LOG_LEVELS].reverse();

/** One hourly slice of the 24h window, oldest first. */
export type LogHourBucket = Record<LogLevel, number>;

interface FrontendLogsTileViewBaseProps {
  status: TileStatus;
}

interface FrontendLogsTileViewLoadingProps extends FrontendLogsTileViewBaseProps {
  status: typeof TileStatus.Loading;
}

interface FrontendLogsTileViewPopulatedProps extends FrontendLogsTileViewBaseProps {
  status: typeof TileStatus.Populated;
  /** Level tally over the last 24h. */
  counts: Record<LogLevel, number>;
  /** 24 hourly per-level buckets, oldest first. */
  buckets: LogHourBucket[];
}

export type FrontendLogsTileViewProps =
  | FrontendLogsTileViewLoadingProps
  | FrontendLogsTileViewPopulatedProps;

/**
 * Comma-grouped up to 5 digits (23,456), then unit-suffixed: 100k, 999k, 1.1m.
 * The tally row holds four of these side by side on a fixed-width panel, so the
 * ceiling is "5 characters of digits", not scientific precision.
 */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

function bucketTotal(bucket: LogHourBucket): number {
  return LOG_LEVELS.reduce((sum, level) => sum + bucket[level], 0);
}

function FrontendLogsSkeleton() {
  // Real title stays visible while loading; only the data body shimmers.
  return (
    <Tile padding={22}>
      <TileHeader icon="apps" title="Frontend Logs" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Skeleton w="100%" h={CHART_H} borderRadius={6} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {LOG_LEVELS.map((level) => (
          <Skeleton key={level} w={56} h={12} borderRadius={4} />
        ))}
      </div>
    </Tile>
  );
}

export function FrontendLogsTileView(props: FrontendLogsTileViewProps) {
  if (props.status === TileStatus.Loading) return <FrontendLogsSkeleton />;

  const { counts, buckets } = props;
  const max = Math.max(...buckets.map(bucketTotal), 1);

  return (
    <Tile padding={22}>
      <TileHeader icon="apps" title="Frontend Logs" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Stacked per-level bars per hour; 2px surface gaps; rounded data-ends.
            A quiet hour keeps a 2px stub so the axis reads as 24 slots, not a
            chart that failed to load. */}
        <div
          data-testid="logs-histogram"
          style={{ display: "flex", alignItems: "flex-end", gap: 2, height: CHART_H }}
        >
          {buckets.map((bucket, i) => {
            const levels = STACK_ORDER.filter((level) => bucket[level] > 0);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed hourly slots
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: 2,
                  height: "100%",
                }}
              >
                {levels.map((level, stackIdx) => (
                  <div
                    key={level}
                    style={{
                      height: Math.max(3, (bucket[level] / max) * CHART_H),
                      background: LEVEL_COLOR[level],
                      borderRadius: stackIdx === 0 ? "2px 2px 0 0" : 0,
                      opacity: level === "warn" ? 0.85 : 1,
                    }}
                  />
                ))}
                {levels.length === 0 && (
                  <div style={{ height: 2, background: "var(--nest)", borderRadius: 1 }} />
                )}
              </div>
            );
          })}
        </div>
        <div
          className="cap"
          style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}
        >
          <span>24h ago</span>
          <span>now</span>
        </div>
      </div>
      {/* Level tally spread across the full width. Storage-vs-cap stays in the
          modal footer , the tile answers "how loud, how bad", not "how full". */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--mono, ui-monospace, monospace)",
          fontSize: 12,
          marginTop: 4,
        }}
      >
        {LOG_LEVELS.map((level) => (
          <span key={level} style={{ color: LEVEL_COLOR[level], whiteSpace: "nowrap" }}>
            {compact(counts[level])} {level}
          </span>
        ))}
      </div>
    </Tile>
  );
}
