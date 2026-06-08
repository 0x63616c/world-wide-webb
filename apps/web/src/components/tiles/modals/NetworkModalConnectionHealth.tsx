/**
 * NetworkModalConnectionHealth — WAN health detail modal for the Network tile.
 *
 * WHY this layout: the tile surfaces ping only as a tiny grey "12ms" label — it
 * communicates connectivity but not health. This modal promotes WAN health to the
 * hero: a large BorderProgressRing encircles the live latency number and grades it
 * green (good) → amber (degraded) by threshold, surfacing at a glance whether the
 * link is healthy or struggling. An explicit Online/Offline status banner sits
 * above the ring so reachability is never ambiguous. Below the ring, a 2×2 grid
 * converts the 24 raw 5-min traffic buckets into the three derived throughput
 * views users actually ask about: what's the speed RIGHT NOW, what was the peak,
 * and what's the average. A footer row anchors the SSID and 2-hour totals — context
 * the tile already shows, kept here for completeness without visual weight.
 *
 * The ring is colour-graded by threshold rather than mapped to bucket max, because
 * latency meaning is absolute (>100ms always hurts), not relative to the session.
 *
 * PURE view: all data + callbacks arrive via props — no trpc/hooks. Composes
 * trivially in Storybook and component tests.
 * Modal width 560 (narrow, gauge-focused as briefed).
 */

import { BorderProgressRing, Modal, Pill, PillTone, Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** One 5-minute traffic window from UniFi getTrafficBuckets(). Raw bytes. */
interface TrafficBucket {
  down: number;
  up: number;
}

export interface NetworkModalConnectionHealthProps {
  open: boolean;
  onClose: () => void;
  /** true = WAN reachable, false = WAN down */
  isOnline: boolean;
  /** WAN latency from UniFi gateway uptime monitor (ms) */
  ping: number;
  /** Primary Wi-Fi SSID from env WIFI_SSID */
  ssid: string;
  /** Human-readable total download over the bucket window, e.g. "18.4" (GB) */
  down: string;
  /** Human-readable total upload over the bucket window, e.g. "4.2" (GB) */
  up: string;
  /**
   * Exactly 24 buckets of 5-minute traffic windows (raw bytes).
   * Index 0 = oldest, index 23 = newest. Leading gaps are zero-filled.
   * Derived throughput stats (current/peak/avg Mbps) are computed here
   * from this real data — no new data sources needed.
   */
  traffic: TrafficBucket[];
}

// ─── constants ────────────────────────────────────────────────────────────────

// Latency thresholds for ring colour grading (absolute, not relative to session).
// ≤ 60ms = healthy green, 61-100ms = amber caution, > 100ms = muted red.
const PING_GOOD_MS = 60;
const PING_WARN_MS = 100;

// Ring progress maps ping into a 0-1 range where 0ms = empty and SCALE = full.
// We use 200ms as the "worst displayed" anchor — anything above fills the ring
// completely so high-latency sessions don't become meaningless edge cases.
const PING_SCALE_MS = 200;

// 5-minute bucket duration in seconds for Mbps conversion.
const BUCKET_SECONDS = 300;
const BYTES_PER_MBIT = 125_000;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Convert raw bytes in a 5-min bucket to Mbps. */
function bucketToMbps(bytes: number): number {
  return bytes / BYTES_PER_MBIT / BUCKET_SECONDS;
}

/** Format Mbps for display — 2 decimal places for sub-10 values, 1 above. */
function fmtMbps(mbps: number): string {
  if (mbps < 10) return mbps.toFixed(2);
  return mbps.toFixed(1);
}

/** Derive latency ring colour from ping thresholds. */
function pingColor(ms: number): string {
  if (ms <= PING_GOOD_MS) return "var(--acc)";
  if (ms <= PING_WARN_MS) return "var(--amber)";
  return "#ff5f5f";
}

/** Derive Pill tone from online status. */
function statusTone(isOnline: boolean): PillTone {
  return isOnline ? PillTone.On : PillTone.Amber;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function NetworkModalConnectionHealth({
  open,
  onClose,
  isOnline,
  ping,
  ssid,
  down,
  up,
  traffic,
}: NetworkModalConnectionHealthProps) {
  // Derive throughput stats from the 24 raw traffic buckets.
  // Newest bucket = current rate; max across all buckets = peak; mean = average.
  // Computed here so the component stays a pure view — no need to extend the API.
  const bucketsDown = traffic.map((b) => bucketToMbps(b.down));
  const bucketsUp = traffic.map((b) => bucketToMbps(b.up));

  const currentDown = bucketsDown.at(-1) ?? 0;
  const currentUp = bucketsUp.at(-1) ?? 0;
  const peakDown = bucketsDown.length > 0 ? Math.max(...bucketsDown) : 0;
  const avgDown =
    bucketsDown.length > 0 ? bucketsDown.reduce((s, v) => s + v, 0) / bucketsDown.length : 0;

  // Ring progress: clamp ping to [0, PING_SCALE_MS] then normalise to [0, 1].
  // Higher = worse, so a healthy 15ms fills only ~7.5% of the ring (subtle);
  // a struggling 150ms fills 75% (visibly alarming) — exactly the right mapping.
  const ringProgress = Math.min(ping / PING_SCALE_MS, 1);
  const ringColor = pingColor(ping);

  return (
    <Modal open={open} onClose={onClose} title="Network" width={560} maxHeight={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Hero: ping gauge + status banner ─────────────────────────────── */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          {/* Online / Offline status banner — explicit reachability above the ring
              so the user never has to infer connectivity from the latency number. */}
          <Pill tone={statusTone(isOnline)}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: isOnline ? "var(--acc)" : "var(--amber)",
                display: "inline-block",
              }}
            />
            {isOnline ? "Online" : "Offline"}
          </Pill>

          {/* Ping gauge: BorderProgressRing wraps the latency readout.
              The ring traces the border of the gauge card, colour-graded by
              threshold so healthy vs degraded links read at a glance. */}
          <div
            style={{
              position: "relative",
              width: 220,
              height: 220,
              borderRadius: 20,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <BorderProgressRing
              progress={ringProgress}
              strokeWidth={3.5}
              color={ringColor}
              trackColor="var(--hair-2)"
              transitionMs={600}
              width={220}
              height={220}
            />
            <span
              className="mono"
              style={{
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1,
                color: ringColor,
                letterSpacing: "-0.03em",
              }}
            >
              {ping}
            </span>
            <span className="cap" style={{ letterSpacing: "0.12em" }}>
              ms latency
            </span>
          </div>
        </section>

        {/* ── Throughput: 2×2 stat grid ─────────────────────────────────────── */}
        {/* Derived from the 24 traffic buckets — newest = current, max = peak,
            mean = average. All three views converted from raw bytes to Mbps. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Throughput</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 13,
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 14,
              }}
            >
              <Stat label="Current ↓" value={`${fmtMbps(currentDown)} Mbps`} accent />
            </div>
            <div
              style={{
                padding: "14px 16px",
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 14,
              }}
            >
              <Stat label="Current ↑" value={`${fmtMbps(currentUp)} Mbps`} muted />
            </div>
            <div
              style={{
                padding: "14px 16px",
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 14,
              }}
            >
              <Stat label="Peak ↓" value={`${fmtMbps(peakDown)} Mbps`} />
            </div>
            <div
              style={{
                padding: "14px 16px",
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 14,
              }}
            >
              <Stat label="Avg ↓" value={`${fmtMbps(avgDown)} Mbps`} />
            </div>
          </div>
        </section>

        {/* ── Footer: SSID + 2-hour totals ──────────────────────────────────── */}
        {/* Anchors context the tile already shows — kept in the modal for
            completeness without competing with the hero. Divider separates
            the dense stat grid above from the quieter footer. */}
        <div className="divider" />
        <section
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <Stat label="SSID" value={ssid} />
          <Stat label="Downloaded" value={`${down} GB`} />
          <Stat label="Uploaded" value={`${up} GB`} />
        </section>
      </div>
    </Modal>
  );
}
