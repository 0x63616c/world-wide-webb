/**
 * FrontendLogsTileView , the board's window onto the panel's own log store.
 *
 * The wall panel is a TestFlight Capacitor build with no attachable inspector
 * (see LogsModal.tsx); the modal is the only log viewer, and until now the only
 * way to know it was worth opening was to open it. This tile is the tell: the
 * last 24h of the panel's OWN frontend logs , an hourly warn/error histogram
 * (when it got loud) over a full level tally (how loud, how bad). Tapping the
 * tile opens the LogsModal, which the container owns.
 *
 * Debug/info are counted but not charted: on a polling dashboard they are a
 * steady firehose whose bars would flatten the warn/error signal the tile
 * exists to surface.
 */

import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { LOG_LEVELS, type LogLevel } from "../../lib/log/types";

/** Same status colors as LogsModal , level identity is always color + label. */
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "var(--ink-3, #6b7280)",
  info: "var(--ink-2, #9ca3af)",
  warn: "#e0a02c",
  error: "#e5484d",
};

const CHART_H = 64;

/** One hourly slice of the 24h window, oldest first. */
export interface LogHourBucket {
  warn: number;
  error: number;
}

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
  /** 24 hourly warn/error buckets, oldest first. */
  buckets: LogHourBucket[];
  onTileTap: () => void;
}

export type FrontendLogsTileViewProps =
  | FrontendLogsTileViewLoadingProps
  | FrontendLogsTileViewPopulatedProps;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

function FrontendLogsSkeleton() {
  // Real title stays visible while loading; only the data body shimmers.
  return (
    <Tile padding={22}>
      <TileHeader icon="apps" title="Frontend Logs" right={<Skeleton w={64} h={13} />} />
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

  const { counts, buckets, onTileTap } = props;
  const max = Math.max(...buckets.map((b) => b.warn + b.error), 1);

  return (
    <Tile padding={22} onClick={onTileTap} style={{ cursor: "pointer" }}>
      <TileHeader
        icon="apps"
        title="Frontend Logs"
        right={
          <span className="mono" style={{ fontSize: 13, color: LEVEL_COLOR.error }}>
            {compact(counts.error)} errors
          </span>
        }
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Stacked warn+error per hour; 2px surface gaps; rounded data-ends. A
            quiet hour keeps a 2px stub so the axis reads as 24 slots, not a
            chart that failed to load. */}
        <div
          data-testid="logs-histogram"
          style={{ display: "flex", alignItems: "flex-end", gap: 2, height: CHART_H }}
        >
          {buckets.map((bucket, i) => {
            const errH = (bucket.error / max) * CHART_H;
            const warnH = (bucket.warn / max) * CHART_H;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed hourly slots
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: bucket.error > 0 && bucket.warn > 0 ? 2 : 0,
                  height: "100%",
                }}
              >
                {bucket.error > 0 && (
                  <div
                    style={{
                      height: Math.max(3, errH),
                      background: LEVEL_COLOR.error,
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
                {bucket.warn > 0 && (
                  <div
                    style={{
                      height: Math.max(3, warnH),
                      background: LEVEL_COLOR.warn,
                      borderRadius: bucket.error > 0 ? 0 : "2px 2px 0 0",
                      opacity: 0.85,
                    }}
                  />
                )}
                {bucket.error === 0 && bucket.warn === 0 && (
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
