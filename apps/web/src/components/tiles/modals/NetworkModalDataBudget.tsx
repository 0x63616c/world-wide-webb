/**
 * NetworkModalDataBudget — "Data Budget Projection" expanded view for the
 * Network tile.
 *
 * WHY this layout:
 *   The wall-panel tile shows raw window totals (down/up GB) with no sense of
 *   how fast the connection burns through data over time. This modal answers the
 *   question the tile can't: "at today's pace, how much will I use this month?"
 *
 *   The hero gives one glanceable number — projected 30-day GB — and maps it
 *   against a local monthly cap via a filled progress bar so over-budget risk
 *   reads in a second. Below, a 4-cell StatCell grid breaks the projection into
 *   its components: projected 24h, live average rate, the peak 5-min bucket
 *   (the largest single contributor to the extrapolation), and the actual 2h
 *   window total as a ground-truth anchor.
 *
 *   All derived values (average rate, peak bucket, extrapolations) are computed
 *   from the 24 real traffic buckets — NOT invented. The monthly cap is a local
 *   prop (e.g. from user settings or env), not fetched or fabricated.
 *
 *   Every projection is explicitly labeled "projected" so the user is never
 *   misled into reading an estimate as a measured counter.
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks. Composes
 * trivially in Storybook and unit tests.
 *
 * Width 600, maxHeight 680 (matched to the concept brief).
 */

import { Modal, Pill, PillTone, Stat, StatusDot } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** One 5-minute traffic bucket (raw bytes from UniFi). */
export interface TrafficBucket {
  down: number;
  up: number;
}

export interface NetworkModalDataBudgetProps {
  open: boolean;
  onClose: () => void;
  /** "Online" | "Offline" from UniFi getWanHealth().status */
  connectionStatus: "Online" | "Offline";
  /** Primary Wi-Fi SSID from env WIFI_SSID */
  ssid: string;
  /** Total download GB over the 2h bucket window, e.g. "18.4" */
  down: string;
  /** Total upload GB over the 2h bucket window, e.g. "4.2" */
  up: string;
  /**
   * Exactly 24 buckets of raw bytes, 5-minute windows, index 0 = oldest.
   * Leading gaps zero-filled per UniFi API contract.
   */
  traffic: TrafficBucket[];
  /**
   * User-configured monthly data cap in GB. Drives the budget progress bar.
   * Pass the value from local config/settings — never fabricate it.
   */
  monthlyCapGb: number;
}

// ─── pure helpers (no side effects, no mutable state) ─────────────────────────

const BYTES_PER_GB = 1_073_741_824;
/** 5-minute buckets per day and per 30-day month */
const BUCKETS_PER_DAY = 288;
const BUCKETS_PER_MONTH = BUCKETS_PER_DAY * 30;

interface Projection {
  /** Average bytes/bucket across the 24-bucket window (down + up combined) */
  avgBytesPerBucket: number;
  /** Projected 24h GB (down + up) from the current average rate */
  projected24hGb: number;
  /** Projected 30-day GB (down + up) from the current average rate */
  projected30dGb: number;
  /** Index (0–23) of the highest-traffic bucket */
  peakBucketIndex: number;
  /** GB total of the actual 2h window (down + up), derived from the string props */
  actual2hGb: number;
  /** Average rate in Mbps (megabits per second) across the window */
  avgRateMbps: number;
}

function computeProjection(
  traffic: TrafficBucket[],
  downGbStr: string,
  upGbStr: string,
): Projection {
  // Use the raw bucket bytes for rate derivation. The string totals are the
  // ground-truth window sums from the tile — we keep them as the "actual 2h"
  // anchor displayed in the stat grid.
  const totalBytes = traffic.reduce((acc, b) => acc + b.down + b.up, 0);
  const nonZeroBuckets = traffic.filter((b) => b.down + b.up > 0).length;
  // Divide by non-zero buckets only — leading zero-fill pads would under-count
  // the true average rate during the active window.
  const activeBuckets = nonZeroBuckets > 0 ? nonZeroBuckets : 1;
  const avgBytesPerBucket = totalBytes / activeBuckets;

  const projected24hGb = (avgBytesPerBucket * BUCKETS_PER_DAY) / BYTES_PER_GB;
  const projected30dGb = (avgBytesPerBucket * BUCKETS_PER_MONTH) / BYTES_PER_GB;

  // Peak bucket = highest combined (down+up) bytes in the window.
  let peakBucketIndex = 0;
  let peakBytes = 0;
  for (let i = 0; i < traffic.length; i++) {
    const combined = traffic[i].down + traffic[i].up;
    if (combined > peakBytes) {
      peakBytes = combined;
      peakBucketIndex = i;
    }
  }

  const actual2hGb = parseFloat(downGbStr) + parseFloat(upGbStr);

  // Average rate in Mbps: bytes/bucket ÷ (5 min × 60 s) × 8 bits/byte ÷ 1e6
  const avgRateMbps = ((avgBytesPerBucket / 300) * 8) / 1_000_000;

  return {
    avgBytesPerBucket,
    projected24hGb,
    projected30dGb,
    peakBucketIndex,
    actual2hGb,
    avgRateMbps,
  };
}

/**
 * Convert a bucket index (0–23) into an approximate clock label.
 * Bucket 23 is the most recent 5-minute window; bucket 0 is ~2h ago.
 * We label relative to "now" because the bucket timestamps are not
 * available in the public API shape.
 */
function bucketToRelativeLabel(index: number): string {
  // Each bucket = 5 min. Bucket 23 = now−5m, bucket 0 = now−120m.
  const minutesAgo = (23 - index) * 5;
  if (minutesAgo === 0) return "now";
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const h = Math.floor(minutesAgo / 60);
  const m = minutesAgo % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

function fmtGb(gb: number): string {
  // Under 100 GB show one decimal; above that the integer is clear enough.
  return gb < 100 ? gb.toFixed(1) : String(Math.round(gb));
}

function fmtMbps(mbps: number): string {
  return mbps < 10 ? mbps.toFixed(2) : mbps.toFixed(1);
}

// ─── sub-components ───────────────────────────────────────────────────────────

interface BudgetBarProps {
  usedGb: number;
  capGb: number;
}

/**
 * Horizontal budget progress bar. Renders as a semantic <meter> so assistive
 * technology reads the fill fraction correctly. The visible bar is a CSS
 * gradient overlay on the meter's default appearance (appearance:none).
 * Over-budget tints amber; within-budget uses the accent green.
 */
function BudgetBar({ usedGb, capGb }: BudgetBarProps) {
  const pct = Math.min((usedGb / capGb) * 100, 100);
  const overBudget = usedGb > capGb;
  const fillColor = overBudget ? "#f4c063" : "var(--acc)";
  return (
    // Use the semantic <meter> element — biome requires it over role="meter".
    // appearance:none drops the browser default so our gradient takes over.
    <meter
      value={usedGb}
      min={0}
      max={capGb}
      aria-label="Monthly data budget"
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        display: "block",
        height: 8,
        borderRadius: 999,
        width: "100%",
        // Static filled track: accent up to pct%, dim rail after.
        background: `linear-gradient(90deg, ${fillColor} ${pct}%, #181818 ${pct}%)`,
        border: "none",
      }}
    />
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function NetworkModalDataBudget({
  open,
  onClose,
  connectionStatus,
  ssid,
  down,
  up,
  traffic,
  monthlyCapGb,
}: NetworkModalDataBudgetProps) {
  const isOnline = connectionStatus === "Online";
  const proj = computeProjection(traffic, down, up);
  const overBudget = proj.projected30dGb > monthlyCapGb;
  const budgetPct = Math.min((proj.projected30dGb / monthlyCapGb) * 100, 100);

  return (
    <Modal open={open} onClose={onClose} title="Network" width={600} maxHeight={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Hero: projected 30-day number + budget bar ─────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Projected 30-day usage</span>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              className="mono"
              style={{
                fontSize: 44,
                fontWeight: 700,
                color: overBudget ? "var(--amber)" : "var(--acc)",
                lineHeight: 1,
              }}
            >
              {fmtGb(proj.projected30dGb)}
            </span>
            <span className="mono" style={{ fontSize: 18, color: "var(--ink-2)", fontWeight: 500 }}>
              GB
            </span>
            {/* Tone signals whether the projection sits inside or over the cap. */}
            <Pill tone={overBudget ? PillTone.Amber : PillTone.On} style={{ marginLeft: "auto" }}>
              {overBudget
                ? `${fmtGb(proj.projected30dGb - monthlyCapGb)} GB over`
                : `${fmtGb(monthlyCapGb - proj.projected30dGb)} GB remaining`}
            </Pill>
          </div>

          {/* Budget progress bar + cap label */}
          <BudgetBar usedGb={proj.projected30dGb} capGb={monthlyCapGb} />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              projected from current 2h window
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              cap {fmtGb(monthlyCapGb)} GB&nbsp;
              <span style={{ color: "var(--ink-3)" }}>{Math.round(budgetPct)}%</span>
            </span>
          </div>
        </section>

        {/* ── StatCell grid: 4 cells, gap 13 ──────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 13,
          }}
        >
          {/* Projected 24h */}
          <div
            style={{
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 14,
              padding: "14px 16px",
            }}
          >
            <Stat
              label="Projected 24h"
              value={`${fmtGb(proj.projected24hGb)} GB`}
              accent
              sub="extrapolated from avg rate"
            />
          </div>

          {/* Current average rate */}
          <div
            style={{
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 14,
              padding: "14px 16px",
            }}
          >
            <Stat
              label="Avg rate (2h window)"
              value={`${fmtMbps(proj.avgRateMbps)} Mbps`}
              sub="down + up combined"
            />
          </div>

          {/* Peak-contributor bucket */}
          <div
            style={{
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 14,
              padding: "14px 16px",
            }}
          >
            <Stat
              label="Peak contributor"
              value={bucketToRelativeLabel(proj.peakBucketIndex)}
              sub="busiest 5-min window"
            />
          </div>

          {/* Actual 2h window total — ground truth anchor */}
          <div
            style={{
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 14,
              padding: "14px 16px",
            }}
          >
            <Stat
              label="Actual 2h total"
              value={`${proj.actual2hGb.toFixed(1)} GB`}
              sub={`↓ ${down}  ↑ ${up}`}
              muted
            />
          </div>
        </div>

        {/* ── Footer: ssid + connection status ────────────────────────────── */}
        <div className="divider" />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusDot online={isOnline} />
            <span className="cap">{connectionStatus}</span>
          </div>
          <span className="cap" style={{ color: "var(--ink-2)" }}>
            {ssid}
          </span>
        </div>
      </div>
    </Modal>
  );
}
