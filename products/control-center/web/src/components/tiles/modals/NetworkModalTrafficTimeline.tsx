/**
 * NetworkModalTrafficTimeline , drill-down overlay for the Network tile.
 *
 * WHY this layout:
 *   The compact tile renders a 50px unlabeled mirror chart with no axis or
 *   values. The same 24 buckets (5-min windows over 2 hours) hold enough
 *   information for a genuine time-series drill-down , real timestamps, per-
 *   bucket MB values, download/upload symmetry, and a peak callout. This modal
 *   surfaces all of that without needing any new data from the API.
 *
 *   Section 1 , area butterfly chart (~580×280): download bars grow upward from
 *   the midline axis; upload bars grow downward. The peak bucket is tagged with
 *   an amber Pill callout. The x-axis renders clock-time labels at 30-min
 *   intervals so the viewer can orient the data in their day.
 *
 *   Section 2 , pinned-bucket inspector: tapping any bucket pins a four-cell
 *   readout (time, down MB, up MB, ratio) below the chart. No tap = last peak
 *   shown by default so the modal is immediately informative.
 *
 *   Section 3 , footer Stat row: SSID, ping, 2 h down total, 2 h up total.
 *
 *   PURE view , all data + callbacks arrive via props. No trpc/hooks. Renders
 *   trivially in Storybook and unit tests.
 */

import { useState } from "react";
import { Modal, Pill, PillTone, Stat, StatusDot, TileHeader } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface TrafficBucket {
  /** Raw bytes downloaded in this 5-minute window. */
  down: number;
  /** Raw bytes uploaded in this 5-minute window. */
  up: number;
}

export interface NetworkModalTrafficTimelineProps {
  open: boolean;
  onClose: () => void;
  /** 24 buckets of 5-min traffic windows; index 0 = oldest, 23 = newest. */
  traffic: TrafficBucket[];
  /** Total download over the 2-hour window, pre-formatted (e.g. "18.4"). */
  down: string;
  /** Total upload over the 2-hour window, pre-formatted (e.g. "4.2"). */
  up: string;
  /** Primary Wi-Fi SSID. */
  ssid: string;
  /** WAN latency in ms from the UniFi uptime monitor. */
  ping: number;
  /** Network connectivity status. */
  status: "Online" | "Offline";
  /**
   * Wall-clock timestamp of the NEWEST bucket (bucket[23]).
   * Used to back-calculate the time label for each bucket.
   * Defaults to Date.now() when omitted (live display).
   */
  newestBucketAt?: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Convert raw bytes to a human-readable MB string (1 decimal place). */
function toMB(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

/** Format a timestamp as HH:MM (24-hour). */
function toHHMM(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── chart types ─────────────────────────────────────────────────────────────

/** Pre-computed render data for a single bucket column. Derived once from
 *  the raw traffic array so the JSX stays declarative. */
interface BucketRender {
  /** 0-based slot position (stable identity , the 24-slot window never reorders). */
  slot: number;
  x: number;
  barW: number;
  downH: number;
  upH: number;
  downColor: string;
  upColor: string;
}

interface AxisLabel {
  slotRef: number;
  cx: number;
  label: string;
}

interface BucketBtn {
  slot: number;
  label: string;
  colW: number;
}

// ─── chart sub-component ─────────────────────────────────────────────────────

interface ChartProps {
  traffic: TrafficBucket[];
  peakIndex: number;
  selectedIndex: number | null;
  newestBucketAt: number;
  onSelectBucket: (slot: number) => void;
}

function TrafficChart({
  traffic,
  peakIndex,
  selectedIndex,
  newestBucketAt,
  onSelectBucket,
}: ChartProps) {
  // Chart geometry. Width is fixed to match the modal body (640 - 40px padding).
  // Each bucket gets an equal column. The vertical half is 130px per direction
  // (down above axis, up below), giving 260px total chart height + 24px axis.
  const W = 560;
  const HALF = 130;
  const AXIS_H = 24;
  const TOTAL_H = HALF * 2 + AXIS_H;
  const N = traffic.length; // 24
  const colW = W / N;
  const BAR_GAP = 2;

  const maxBytes = Math.max(...traffic.map((b) => Math.max(b.down, b.up)), 1);
  const bucketMs = 5 * 60 * 1000;

  // Pre-compute render data outside JSX to avoid index-as-key in map callbacks.
  // BucketRender.slot is the stable identity key , never reordered.
  const bucketRenders: BucketRender[] = traffic.map((bucket, i) => {
    const isSelected = i === selectedIndex;
    const isPeak = i === peakIndex;
    return {
      slot: i,
      x: i * colW,
      barW: colW - BAR_GAP,
      downH: Math.round((bucket.down / maxBytes) * (HALF - 4)),
      upH: Math.round((bucket.up / maxBytes) * (HALF - 4)),
      downColor: isPeak ? "var(--acc)" : isSelected ? "var(--acc-2)" : "var(--acc-line)",
      upColor: isPeak ? "var(--amber)" : isSelected ? "#d4a84b" : "rgba(244,192,99,0.4)",
    };
  });

  const axisLabels: AxisLabel[] = [0, 6, 12, 18, 23].map((i) => ({
    slotRef: i,
    cx: i * colW + colW / 2,
    label: toHHMM(newestBucketAt - (N - 1 - i) * bucketMs),
  }));

  const bucketBtns: BucketBtn[] = traffic.map((_, i) => ({
    slot: i,
    label: `Bucket ${i + 1}`,
    colW,
  }));

  const peakBucket = traffic[peakIndex];
  const peakX = peakIndex * colW + colW / 2;

  return (
    <div style={{ position: "relative" }}>
      {/* Visual-only SVG , no interactive attributes. Interaction lives on the
          HTML button overlay below so Biome's useSemanticElements is satisfied. */}
      <svg
        width={W}
        height={TOTAL_H}
        viewBox={`0 0 ${W} ${TOTAL_H}`}
        style={{ display: "block", overflow: "visible" }}
        aria-hidden="true"
      >
        <line x1={0} y1={HALF} x2={W} y2={HALF} stroke="var(--hair-2)" strokeWidth={1} />

        {/* Bucket bars , keyed by slot (stable positional identity). */}
        {bucketRenders.map((br) => (
          <g key={br.slot}>
            {br.downH > 0 && (
              <rect
                x={br.x + BAR_GAP / 2}
                y={HALF - br.downH}
                width={br.barW}
                height={br.downH}
                rx={2}
                fill={br.downColor}
                style={{ transition: "fill 0.15s" }}
              />
            )}
            {br.upH > 0 && (
              <rect
                x={br.x + BAR_GAP / 2}
                y={HALF}
                width={br.barW}
                height={br.upH}
                rx={2}
                fill={br.upColor}
                style={{ transition: "fill 0.15s" }}
              />
            )}
          </g>
        ))}

        {/* X-axis time labels , keyed by slotRef (stable). */}
        <g style={{ fontSize: 10, fill: "var(--ink-3)", fontFamily: "var(--mono)" }}>
          {axisLabels.map((al) => (
            <text key={al.slotRef} x={al.cx} y={HALF * 2 + 16} textAnchor="middle">
              {al.label}
            </text>
          ))}
        </g>
      </svg>

      {/* HTML button overlay , absolutely positioned over the bar area.
          Each <button> spans one bucket column and is the sole interactive
          element (satisfies Biome useSemanticElements / noStaticElementInteractions).
          Keys come from BucketBtn.slot, not the map index parameter. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: W,
          height: HALF * 2,
          display: "flex",
        }}
      >
        {bucketBtns.map((bb) => (
          <button
            key={bb.slot}
            type="button"
            aria-label={bb.label}
            onClick={() => onSelectBucket(bb.slot)}
            style={{
              flex: "1 1 0",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          />
        ))}
      </div>

      {/* Peak callout Pill , absolutely positioned above the peak bar */}
      {peakBucket && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: peakX,
            transform: "translateX(-50%) translateY(-28px)",
            pointerEvents: "none",
          }}
        >
          <Pill tone={PillTone.Amber}>
            {toMB(Math.max(peakBucket.down, peakBucket.up))} MB peak
          </Pill>
        </div>
      )}
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function NetworkModalTrafficTimeline({
  open,
  onClose,
  traffic,
  down,
  up,
  ssid,
  ping,
  status,
  newestBucketAt = Date.now(),
}: NetworkModalTrafficTimelineProps) {
  // Default selected bucket to the peak (highest combined throughput).
  const peakIndex = traffic.reduce<number>((best, b, i) => {
    const cur = b.down + b.up;
    const bestVal = (traffic[best]?.down ?? 0) + (traffic[best]?.up ?? 0);
    return cur > bestVal ? i : best;
  }, 0);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Use explicit selection, falling back to the peak so the inspector is
  // always populated on first open.
  const inspectorIndex = selectedIndex ?? peakIndex;
  const inspectorBucket = traffic[inspectorIndex];

  // Compute per-bucket time label for the inspector.
  const bucketMs = 5 * 60 * 1000;
  const N = traffic.length;
  const inspectorTs = newestBucketAt - (N - 1 - inspectorIndex) * bucketMs;
  const inspectorDown = inspectorBucket ? toMB(inspectorBucket.down) : "0.0";
  const inspectorUp = inspectorBucket ? toMB(inspectorBucket.up) : "0.0";
  const inspectorRatio =
    inspectorBucket && inspectorBucket.up > 0
      ? (inspectorBucket.down / inspectorBucket.up).toFixed(1)
      : ",";

  const isOnline = status === "Online";

  return (
    <Modal open={open} onClose={onClose} title="Network" width={640} maxHeight={760}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Header row , wifi icon + status dot */}
        <TileHeader
          icon="wifi"
          title="Traffic"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusDot online={isOnline} />
              <span
                style={{
                  fontSize: 13,
                  color: isOnline ? "var(--acc)" : "var(--ink-3)",
                }}
              >
                {status}
              </span>
            </div>
          }
        />

        {/* Section 1 , area/butterfly timeline chart */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <span className="cap">2-Hour timeline</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
              {/* Download legend */}
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "rgba(0,112,243,0.6)",
                  display: "inline-block",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Down</span>
              {/* Upload legend */}
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "rgba(244,192,99,0.5)",
                  display: "inline-block",
                  marginLeft: 6,
                }}
              />
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Up</span>
            </div>
          </div>

          {/* Chart container , add top padding for the peak callout pill */}
          <div
            style={{
              paddingTop: 32,
              paddingBottom: 4,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 14,
              padding: "32px 16px 12px",
            }}
          >
            <TrafficChart
              traffic={traffic}
              peakIndex={peakIndex}
              selectedIndex={selectedIndex}
              newestBucketAt={newestBucketAt}
              onSelectBucket={(idx) => setSelectedIndex(idx)}
            />
          </div>
        </section>

        {/* Divider */}
        <div className="divider" />

        {/* Section 2 , pinned bucket inspector */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="cap">Bucket inspector</span>
            {selectedIndex === null && (
              <Pill tone={PillTone.Amber} style={{ fontSize: 10.5 }}>
                peak
              </Pill>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 13,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 14,
              padding: 16,
            }}
          >
            <Stat label="Time" value={toHHMM(inspectorTs)} />
            <Stat label="Down" value={`${inspectorDown}`} accent />
            <Stat label="Up" value={`${inspectorUp}`} />
            <Stat label="D/U Ratio" value={inspectorRatio} />
          </div>
        </section>

        {/* Divider */}
        <div className="divider" />

        {/* Section 3 , footer stats */}
        <section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 13,
            }}
          >
            <Stat label="SSID" value={ssid} />
            <Stat label="Ping" value={`${ping} ms`} accent={ping < 20} />
            <Stat label="2h Down" value={`${down} GB`} />
            <Stat label="2h Up" value={`${up} GB`} />
          </div>
        </section>
      </div>
    </Modal>
  );
}
