/**
 * TeslaModalChargeSession , the "Charge Session" expanded view for the Tesla tile.
 *
 * WHY this layout:
 * The tile shows a static horizontal fill bar and a single pct number. This modal
 * adds three capabilities the tile cannot fit:
 *   1. A live BorderProgressRing around a large central pct readout , the ring's
 *      sweep gives immediate visual feedback on how far through the charge we are.
 *   2. Projection math: ETA-to-full and range-at-full computed from live rate so
 *      the user can plan around the car's availability. Computed client-side, no
 *      recorder dependency. Shown as "--" when rate is zero (honest about limits).
 *   3. A client-side-accumulated sparkline: the caller samples rate + pct while the
 *      modal is open (via the `samples` prop) and passes them down. The modal draws
 *      an SVG polyline from those points. Empty when disconnected , never fabricated.
 *   4. A Start/Stop charge button mapped to ha.callService, always shown so the user
 *      can start charging even when currently stopped.
 *
 * Layout: 640w (default) × 720h (default). Single column, top to bottom:
 *   - Header pill (charging status) centered above the ring
 *   - Large charge ring + center pct (220px)
 *   - Projection StatCells row: Time to full / Range at full / Rate (gap 13)
 *   - Sparkline (180px tall, full width)
 *   - Start/Stop ControlTap button
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks. Composes
 * trivially in Storybook and unit tests.
 */

import { useRef } from "react";
import { BorderProgressRing, Modal, Pill, PillTone, Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/**
 * One sample in the in-session charge curve. The caller accumulates these while
 * the modal is open (polling the HA sensors at whatever interval the tRPC query
 * uses) and passes the array down. NO recorder dependency , the sparkline is only
 * as long as the modal has been open.
 */
export interface ChargeSample {
  /** Epoch ms when the sample was taken , used to spread points evenly on x. */
  ts: number;
  /** Battery pct at sample time, 0-100. */
  pct: number;
  /** Charge rate at sample time, mi/hr. */
  rate: number;
}

/** Charging state from sensor.evee_charging. */
export type EveeChargingState =
  | "starting"
  | "charging"
  | "stopped"
  | "complete"
  | "disconnected"
  | "no_power";

export interface TeslaModalChargeSessionProps {
  open: boolean;
  onClose: () => void;
  /** sensor.evee_battery_level , 0 to 100 (rounded). */
  pct: number;
  /** sensor.evee_battery_range , current range in miles (rounded). */
  range: number;
  /** sensor.evee_charge_rate , mi/hr. 0 when not charging. */
  rate: number;
  /** sensor.evee_charging enum. */
  chargingState: EveeChargingState;
  /**
   * In-session-accumulated samples. Empty array on first open or when
   * disconnected. The caller appends a new sample each poll cycle while open.
   */
  samples: ChargeSample[];
  /**
   * Target charge pct used for ETA projection (typically 80 or 100).
   * Defaults to 80 when not provided (common Tesla recommendation).
   */
  targetPct?: number;
  /** Called when the user taps Start Charge. Wires to ha.callService. */
  onStartCharge: () => void;
  /** Called when the user taps Stop Charge. */
  onStopCharge: () => void;
  /** Whether a charge start/stop request is in-flight. */
  chargePending?: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Derive the Pill tone from the HA charging enum. */
function chargingTone(state: EveeChargingState): PillTone {
  if (state === "charging" || state === "starting") return PillTone.On;
  if (state === "complete") return PillTone.On;
  if (state === "disconnected" || state === "no_power") return PillTone.Default;
  return PillTone.Amber; // stopped
}

/** Human-readable label for the pill. */
function chargingLabel(state: EveeChargingState): string {
  switch (state) {
    case "starting":
      return "Starting";
    case "charging":
      return "Charging";
    case "stopped":
      return "Stopped";
    case "complete":
      return "Complete";
    case "disconnected":
      return "Disconnected";
    case "no_power":
      return "No Power";
  }
}

/**
 * Compute ETA to reach targetPct given current rate and pct.
 * Returns null when rate is zero (divide-by-zero, honest about limits).
 * Tesla EPA range estimate: ~3 mi/hr/pct is a rough constant but we don't
 * need the actual kWh figure , we can project remaining mi directly.
 * remainingRange = targetRange - currentRange; hoursToFull = remainingRange / rate.
 * We derive targetRange from targetPct using the same linear ratio the car reports.
 */
function projectEta(pct: number, range: number, rate: number, targetPct: number): string | null {
  if (rate <= 0 || pct >= targetPct) return null;
  // Linear extrapolation: miles-per-pct from current values.
  const miPerPct = pct > 0 ? range / pct : 3; // fallback 3 mi/pct if pct is 0
  const targetRange = miPerPct * targetPct;
  const remainingMi = targetRange - range;
  if (remainingMi <= 0) return null;
  const hours = remainingMi / rate;
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Compute projected range at targetPct using current miles-per-pct ratio.
 * Returns null when pct is 0 (no basis for projection).
 */
function projectRangeAtTarget(pct: number, range: number, targetPct: number): number | null {
  if (pct <= 0) return null;
  const miPerPct = range / pct;
  return Math.round(miPerPct * targetPct);
}

// ─── sparkline ────────────────────────────────────────────────────────────────

/**
 * A simple SVG polyline drawn from the in-session ChargeSamples.
 * Renders an empty-state message when there are fewer than 2 points , it takes
 * at least 2 samples to draw a line, and 1 sample is indistinguishable from noise.
 */
function Sparkline({ samples, height }: { samples: ChargeSample[]; height: number }) {
  const containerRef = useRef<SVGSVGElement>(null);

  if (samples.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--nest)",
          borderRadius: 14,
          border: "1px solid var(--hair)",
        }}
      >
        <span className="cap" style={{ color: "var(--ink-3)", letterSpacing: "0.14em" }}>
          Accumulating data&hellip;
        </span>
      </div>
    );
  }

  // Normalize x to [0, viewW] over the sample time range; y = pct normalized
  // to [0, viewH] inverted (SVG y=0 is top). 10px padding on sides, 8px top/bottom.
  const viewW = 600;
  const viewH = height;
  const padX = 10;
  const padY = 12;
  const minTs = samples[0].ts;
  const maxTs = samples[samples.length - 1].ts;
  const tsRange = maxTs - minTs || 1;
  const minPct = Math.min(...samples.map((s) => s.pct));
  const maxPct = Math.max(...samples.map((s) => s.pct));
  const pctRange = maxPct - minPct || 1;

  const points = samples
    .map((s) => {
      const x = padX + ((s.ts - minTs) / tsRange) * (viewW - padX * 2);
      const y = viewH - padY - ((s.pct - minPct) / pctRange) * (viewH - padY * 2);
      return `${x},${y}`;
    })
    .join(" ");

  // Gradient fill under the line to give it visual weight.
  const fillId = "spark-fill";

  return (
    <div
      style={{
        background: "var(--nest)",
        borderRadius: 14,
        border: "1px solid var(--hair)",
        overflow: "hidden",
      }}
    >
      <svg
        ref={containerRef}
        viewBox={`0 0 ${viewW} ${viewH}`}
        width="100%"
        height={height}
        aria-label="Charge curve"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--acc)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        {/* Area fill , close path back to bottom corners */}
        {(() => {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const x0 = padX + 0;
          const xN = padX + (viewW - padX * 2);
          const yBottom = viewH - padY;
          const y0 = viewH - padY - ((first.pct - minPct) / pctRange) * (viewH - padY * 2);
          const yN = viewH - padY - ((last.pct - minPct) / pctRange) * (viewH - padY * 2);
          return (
            <polygon
              fill={`url(#${fillId})`}
              points={`${x0},${y0} ${points} ${xN},${yN} ${xN},${yBottom} ${x0},${yBottom}`}
            />
          );
        })()}
        {/* Polyline , accent stroke, 2px thick */}
        <polyline
          points={points}
          fill="none"
          stroke="var(--acc)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Latest value dot */}
        {(() => {
          const last = samples[samples.length - 1];
          const xN = padX + (viewW - padX * 2);
          const yN = viewH - padY - ((last.pct - minPct) / pctRange) * (viewH - padY * 2);
          return <circle cx={xN} cy={yN} r={4} fill="var(--acc)" />;
        })()}
      </svg>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function TeslaModalChargeSession({
  open,
  onClose,
  pct,
  range,
  rate,
  chargingState,
  samples,
  targetPct = 80,
  onStartCharge,
  onStopCharge,
  chargePending = false,
}: TeslaModalChargeSessionProps) {
  const isCharging = chargingState === "charging" || chargingState === "starting";
  const isComplete = chargingState === "complete";

  // Projection values , null when we can't compute them honestly.
  const eta = isCharging ? projectEta(pct, range, rate, targetPct) : null;
  const projectedRange = projectRangeAtTarget(pct, range, targetPct);

  // Ring color: green when charging/complete, amber when stopped, dim otherwise.
  const ringColor =
    isCharging || isComplete
      ? "var(--acc)"
      : chargingState === "stopped"
        ? "var(--amber)"
        : "var(--ink-3)";
  const ringTrack = "rgba(255,255,255,0.06)";

  return (
    <Modal open={open} onClose={onClose} title="Tesla" width={640} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Header pill , charging state ─────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Pill tone={chargingTone(chargingState)}>
            {isCharging && (
              <span className="dot" aria-hidden="true" style={{ width: 7, height: 7 }} />
            )}
            {chargingLabel(chargingState)}
            {isCharging && rate > 0 && (
              <span style={{ color: "var(--ink-3)", marginLeft: 2 }}>&middot; +{rate} mi/hr</span>
            )}
          </Pill>
        </div>

        {/* ── Large charge ring + centered pct ─────────────────────────── */}
        {/*
         * 220px square container, position:relative so BorderProgressRing can
         * measure it. The ring traces the tile's own rounded border; center text
         * sits in a flex column inside. strokeWidth 8 gives a bold arc at this size.
         */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              position: "relative",
              width: 220,
              height: 220,
              borderRadius: 24,
              border: "1px solid var(--hair)",
              background: "var(--nest)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <BorderProgressRing
              progress={pct / 100}
              strokeWidth={8}
              color={ringColor}
              trackColor={ringTrack}
              transitionMs={800}
              data-testid="charge-ring"
            />
            {/* Pct value , large mono, accent when charging */}
            <span
              className="mono"
              data-charge-pct=""
              style={{
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1,
                color: isCharging || isComplete ? "var(--acc)" : "var(--ink)",
              }}
            >
              {pct}
              <span style={{ fontSize: 24, fontWeight: 500 }}>%</span>
            </span>
            <span
              className="mono"
              style={{ fontSize: 14, color: "var(--ink-3)", letterSpacing: "-0.01em" }}
            >
              {range} mi
            </span>
          </div>
        </div>

        {/* ── Projection StatCells row ──────────────────────────────────── */}
        {/*
         * Three stat cells: Time to full / Range at full / Rate.
         * gap 13 matches the Controls modal's inner-grid rhythm.
         * "Time to full" and "Range at full" both reference targetPct so the
         * label is explicit about what we're projecting toward.
         */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 13,
          }}
        >
          <div
            style={{
              background: "var(--nest)",
              borderRadius: 14,
              border: "1px solid var(--hair)",
              padding: "14px 16px",
            }}
          >
            <Stat
              label={`Time to ${targetPct}%`}
              value={eta ?? "--"}
              accent={eta !== null}
              muted={eta === null}
            />
          </div>
          <div
            style={{
              background: "var(--nest)",
              borderRadius: 14,
              border: "1px solid var(--hair)",
              padding: "14px 16px",
            }}
          >
            <Stat
              label={`Range at ${targetPct}%`}
              value={projectedRange !== null ? `${projectedRange} mi` : "--"}
              muted={projectedRange === null}
            />
          </div>
          <div
            style={{
              background: "var(--nest)",
              borderRadius: 14,
              border: "1px solid var(--hair)",
              padding: "14px 16px",
            }}
          >
            <Stat
              label="Rate"
              value={rate > 0 ? `+${rate}` : "0"}
              sub="mi / hr"
              accent={rate > 0}
              muted={rate === 0}
            />
          </div>
        </div>

        {/* ── Charge curve sparkline ────────────────────────────────────── */}
        {/*
         * In-session-accumulated SVG polyline. The caller is responsible for
         * appending samples while the modal is open. Height 180px gives enough
         * vertical resolution to read a meaningful slope. Empty-state when < 2
         * samples (can't draw a line from one point).
         */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <span className="cap">Charge curve</span>
            <span className="cap" style={{ color: "var(--ink-3)" }}>
              {samples.length > 0 ? `${samples.length} samples` : "no data"}
            </span>
          </div>
          <Sparkline samples={samples} height={180} />
        </section>

        <div className="divider" />

        {/* ── Start / Stop charge button ────────────────────────────────── */}
        {/*
         * Always rendered so the user can start charging from disconnected/stopped
         * state. Disabled while a request is in-flight (chargePending). Button style
         * matches the tap pattern from the Controls modal (nest bg, hair border,
         * accent on the active action) rather than re-using ControlTap (which is
         * icon-led and designed for a different grid rhythm).
         */}
        <button
          type="button"
          data-charge-action=""
          disabled={chargePending}
          onClick={isCharging ? onStopCharge : onStartCharge}
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            borderRadius: 15,
            background: isCharging ? "rgba(244, 192, 99, 0.08)" : "var(--acc-dim)",
            border: `1px solid ${isCharging ? "rgba(244, 192, 99, 0.3)" : "var(--acc-line)"}`,
            color: isCharging ? "var(--amber)" : "var(--acc)",
            font: "inherit",
            fontSize: 16,
            fontWeight: 600,
            cursor: chargePending ? "default" : "pointer",
            opacity: chargePending ? 0.5 : 1,
            transition: "opacity 0.15s ease",
            letterSpacing: "-0.01em",
          }}
          aria-label={isCharging ? "Stop charging" : "Start charging"}
        >
          {isCharging ? "Stop Charge" : "Start Charge"}
        </button>
      </div>
    </Modal>
  );
}
