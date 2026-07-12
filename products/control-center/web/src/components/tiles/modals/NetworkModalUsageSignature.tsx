/**
 * NetworkModalUsageSignature , behavioral read of the 24-bucket traffic window.
 *
 * WHY this layout: the tile shows raw down/up totals but has no insight layer.
 * The same 24 buckets that drive the sparklines carry enough information to
 * classify WHAT the network was doing each 5-minute window , streaming
 * (download-heavy), video-calling (symmetric), backing up (upload-heavy), or
 * idle (near-zero). A horizontal ribbon makes that read spatial and instant.
 * The per-class breakdown rows turn the ribbon into a shareable summary, and
 * two callout Stats surface the busiest and most upload-heavy moment.
 *
 * All analytics are derived live from the existing { down, up } buckets ,
 * zero new data required.
 *
 * Layout (width 640, maxHeight 720):
 *   Section 1: 24-segment ratio ribbon (full-width, h 48) + Chip legend
 *   Section 2: per-class breakdown rows (Pill + % bytes bar + % time label)
 *   Section 3: two callout Stats (busiest window, most upload-heavy window)
 *
 * Spacing: sections gap 24, inner rows/grids gap 13, label+control gap 10 ,
 * mirrors the Controls modal rhythm exactly.
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks.
 */

import { Modal, Pill, PillTone, Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** One 5-minute traffic bucket (raw bytes). */
export interface TrafficBucket {
  down: number;
  up: number;
}

/**
 * Activity class derived from a bucket's down/up ratio and magnitude.
 * Computed live , never stored.
 */
export type ActivityClass = "stream" | "call" | "backup" | "idle";

export interface NetworkModalUsageSignatureProps {
  open: boolean;
  onClose: () => void;
  /** Current Wi-Fi SSID. */
  ssid: string;
  /** Formatted total download over the 24-bucket window (e.g. "18.4 GB"). */
  down: string;
  /** Formatted total upload over the 24-bucket window (e.g. "4.2 GB"). */
  up: string;
  /** Exactly 24 buckets of raw bytes, index 0 = oldest. */
  traffic: TrafficBucket[];
}

// ─── classification ───────────────────────────────────────────────────────────

// Thresholds for assigning a bucket to a class.
// Idle: total bytes below 200 KB (noise floor for a 5-min window).
// Symmetric (call): ratio between 0.4 and 2.5 (neither side > 2.5× the other).
// Upload-heavy (backup): upload > download by more than 2.5×.
// Everything else with meaningful download is streaming.
const IDLE_BYTES_THRESHOLD = 200_000;
const SYMMETRY_RATIO_MAX = 2.5;

function classifyBucket(bucket: TrafficBucket): ActivityClass {
  const total = bucket.down + bucket.up;
  if (total < IDLE_BYTES_THRESHOLD) return "idle";
  const ratio = bucket.down > 0 ? bucket.down / bucket.up : Infinity;
  const ratioUp = bucket.up > 0 ? bucket.up / bucket.down : Infinity;
  if (ratioUp > SYMMETRY_RATIO_MAX) return "backup";
  if (ratio <= SYMMETRY_RATIO_MAX && ratioUp <= SYMMETRY_RATIO_MAX) return "call";
  return "stream";
}

// ─── display constants ────────────────────────────────────────────────────────

const CLASS_META: Record<
  ActivityClass,
  { label: string; color: string; bgColor: string; description: string }
> = {
  stream: {
    label: "Streaming",
    color: "var(--acc)",
    bgColor: "var(--acc-dim)",
    description: "Download-heavy",
  },
  call: {
    label: "Video call",
    color: "var(--amber)",
    bgColor: "rgba(244, 192, 99, 0.12)",
    description: "Symmetric",
  },
  backup: {
    label: "Backup",
    color: "#a78bfa",
    bgColor: "rgba(167, 139, 250, 0.12)",
    description: "Upload-heavy",
  },
  idle: {
    label: "Idle",
    color: "var(--ink-3)",
    bgColor: "rgba(86, 92, 102, 0.18)",
    description: "Near-zero",
  },
};

const CLASS_ORDER: ActivityClass[] = ["stream", "call", "backup", "idle"];

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTime(bucketIndex: number): string {
  // Each bucket is 5 minutes. bucket 0 = 2h before bucket 23 = most recent.
  // Expressed as relative offset: "Now − Xm".
  const minutesAgo = (23 - bucketIndex) * 5;
  if (minutesAgo === 0) return "now";
  return `${minutesAgo}m ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function NetworkModalUsageSignature({
  open,
  onClose,
  ssid,
  down,
  up,
  traffic,
}: NetworkModalUsageSignatureProps) {
  // Ensure we always work with exactly 24 buckets (zero-fill leading gaps).
  const buckets: TrafficBucket[] = Array.from(
    { length: 24 },
    (_, i) => traffic[i] ?? { down: 0, up: 0 },
  );

  const classified = buckets.map((b, i) => ({ ...b, idx: i, cls: classifyBucket(b) }));
  const totalBytes = buckets.reduce((s, b) => s + b.down + b.up, 0);

  // Per-class aggregate: total bytes and count of buckets.
  // Built with mutation to avoid the O(n²) spread-on-accumulator pattern.
  const classAgg: Record<ActivityClass, { bytes: number; count: number }> = {
    stream: { bytes: 0, count: 0 },
    call: { bytes: 0, count: 0 },
    backup: { bytes: 0, count: 0 },
    idle: { bytes: 0, count: 0 },
  };
  for (const b of classified) {
    classAgg[b.cls].bytes += b.down + b.up;
    classAgg[b.cls].count += 1;
  }

  // Busiest bucket: highest total bytes.
  const busiestIdx = classified.reduce(
    (best, b) => (b.down + b.up > classified[best].down + classified[best].up ? b.idx : best),
    0,
  );
  const busiestBucket = classified[busiestIdx];

  // Most upload-heavy bucket: highest up/total ratio (excluding idle buckets).
  const activeBuckets = classified.filter((b) => b.cls !== "idle");
  const uploadHeavyIdx =
    activeBuckets.length > 0
      ? activeBuckets.reduce((best, b) => {
          const curRatio = b.up / (b.down + b.up);
          const bestRatio = best.up / (best.down + best.up);
          return curRatio > bestRatio ? b : best;
        })
      : null;

  return (
    <Modal open={open} onClose={onClose} title="Network" width={640} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* SSID context line */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill tone={PillTone.Default}>{ssid}</Pill>
          <span className="cap" style={{ marginLeft: "auto" }}>
            {down} ↓ · {up} ↑
          </span>
        </div>

        {/* Section 1: 24-segment ratio ribbon + legend */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Activity signature , last 2 hours</span>

          {/* Ribbon: each segment is 1/24 wide, color-coded by class.
              role="img" lets aria-label describe the ribbon as a visual summary
              so screen readers get the intent without iterating 24 divs. */}
          <div
            role="img"
            aria-label="24-segment activity ribbon"
            style={{
              display: "flex",
              height: 48,
              borderRadius: 10,
              overflow: "hidden",
              gap: 2,
            }}
          >
            {classified.map((b) => {
              const meta = CLASS_META[b.cls];
              return (
                <div
                  key={b.idx}
                  title={`${formatTime(b.idx)} , ${meta.label} (${formatBytes(b.down + b.up)})`}
                  style={{
                    flex: 1,
                    background: meta.color,
                    opacity: b.cls === "idle" ? 0.25 : 0.75,
                    minWidth: 0,
                  }}
                />
              );
            })}
          </div>

          {/* Legend chips , display order: stream, call, backup, idle. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CLASS_ORDER.map((cls) => {
              const meta = CLASS_META[cls];
              const count = classAgg[cls].count;
              return (
                <div
                  key={cls}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: meta.bgColor,
                    border: `1px solid ${meta.color}33`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: meta.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12.5, color: meta.color, fontWeight: 500 }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Divider */}
        <div className="divider" />

        {/* Section 2: per-class breakdown rows */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Breakdown by class</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {CLASS_ORDER.filter((cls) => classAgg[cls].count > 0).map((cls) => {
              const meta = CLASS_META[cls];
              const agg = classAgg[cls];
              const bytesPct = totalBytes > 0 ? Math.round((agg.bytes / totalBytes) * 100) : 0;
              const timePct = Math.round((agg.count / 24) * 100);
              return (
                <div key={cls} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Row header: label + raw values */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: meta.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 500,
                          color: "var(--ink)",
                        }}
                      >
                        {meta.label}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        {meta.description}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                        {formatBytes(agg.bytes)}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{timePct}% time</span>
                    </div>
                  </div>
                  {/* Byte-share bar */}
                  <div
                    style={{
                      height: 5,
                      borderRadius: 999,
                      background: "var(--nest)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${bytesPct}%`,
                        borderRadius: 999,
                        background: meta.color,
                        opacity: 0.7,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Divider */}
        <div className="divider" />

        {/* Section 3: callout Stats */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Window callouts</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 13,
            }}
          >
            <Stat
              label="Busiest window"
              value={formatBytes(busiestBucket.down + busiestBucket.up)}
              sub={formatTime(busiestBucket.idx)}
            />
            {uploadHeavyIdx != null ? (
              <Stat
                label="Most upload-heavy"
                value={formatBytes(uploadHeavyIdx.up)}
                sub={formatTime(uploadHeavyIdx.idx)}
              />
            ) : (
              <Stat label="Most upload-heavy" value="," sub="No active windows" />
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
