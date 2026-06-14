/**
 * ClockModalSolarDayArc , "Solar Day Arc" horizon sweep.
 *
 * WHY this layout: The Clock tile shows wall-clock time but gives no sense of
 * solar geometry , how much daylight remains, where on the arc the sun sits
 * right now, or when the next transition (sunset/sunrise) arrives. A horizon
 * arc reframes the day as a physical sweep: left edge = sunrise, right edge =
 * sunset, the lit band between them is daylight. A golden sun dot rides the
 * path at the current fractional day-progress so you read "how far through
 * daylight am I" as a position, not a number.
 *
 * Gradient bands encode sky state: deep indigo at the arc's tips (night),
 * shifting through warm amber (golden hour) into a cool-white day band in the
 * centre. The night band wraps continuously so midnight-to-sunrise reads as
 * the same darkness as post-sunset.
 *
 * Mid: 3 Stat cells , Day length, Daylight remaining, Sun position %.
 * Bottom: a Pill row with the next solar event (countdown to sunset or sunrise).
 *
 * PURE view: all data + callbacks arrive via props (no trpc/hooks). Renders
 * inside the shared <Modal> so backdrop/Escape/close are handled centrally.
 */

import { SolarDayArcGraphic } from "@/components/SolarDayArcGraphic";
import { Modal, Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ClockModalSolarDayArcProps {
  open: boolean;
  onClose: () => void;
  /** ISO datetime for today's sunrise, e.g. "2026-05-31T06:02:00" */
  sunriseIso: string;
  /** ISO datetime for today's sunset, e.g. "2026-05-31T19:48:00" */
  sunsetIso: string;
  /** ISO datetime for tomorrow's sunrise , drives the overnight countdown */
  tomorrowSunriseIso: string;
  /** Current local time (Date.now() snapshot passed in so the component is
   *  fully pure and testable without time-stubbing). */
  nowMs: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Minutes between two ISO strings, clamped ≥ 0 */
function minutesBetween(isoA: string, isoB: string): number {
  return Math.max(0, (new Date(isoB).getTime() - new Date(isoA).getTime()) / 60_000);
}

/** Format whole minutes as "Xh Ym" or "Ym" if < 60 min */
function fmtDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Format a countdown in minutes as "Xh Ym" or "Ym", prefixed by event name */
function fmtCountdown(label: string, totalMinutes: number): string {
  return `${label} in ${fmtDuration(totalMinutes)}`;
}

// ─── arc constants ─────────────────────────────────────────────────────────────

// SVG viewport , full modal body width is 680 (720 panel - 40 padding).
const CLOCK_ARC_DIMS = {
  svgW: 680,
  svgH: 200,
  padX: 40,
  midY: 168, // SVG_H - 32
  peakOffset: 148,
} as const;

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockModalSolarDayArc({
  open,
  onClose,
  sunriseIso,
  sunsetIso,
  tomorrowSunriseIso,
  nowMs,
}: ClockModalSolarDayArcProps) {
  if (!open) return null;

  const sunriseMs = new Date(sunriseIso).getTime();
  const sunsetMs = new Date(sunsetIso).getTime();
  const tomorrowSunriseMs = new Date(tomorrowSunriseIso).getTime();

  const dayLengthMin = minutesBetween(sunriseIso, sunsetIso);
  const dayLengthStr = fmtDuration(dayLengthMin);

  // Progress: fraction of daylight elapsed. 0 at sunrise, 1 at sunset.
  // May be negative (before sunrise) or >1 (after sunset).
  const progressRaw = (nowMs - sunriseMs) / (sunsetMs - sunriseMs);
  const isDaytime = progressRaw >= 0 && progressRaw <= 1;
  const sunPct = Math.round(Math.max(0, Math.min(1, progressRaw)) * 100);

  // Daylight remaining: only meaningful while the sun is up.
  const daylightRemainingMin = isDaytime ? Math.max(0, (sunsetMs - nowMs) / 60_000) : 0;
  const daylightRemainingStr = isDaytime ? fmtDuration(daylightRemainingMin) : "--";

  // Next event countdown , the label string encodes both the event name and
  // the formatted duration, so the pill text is self-describing.
  let nextEventLabel: string;
  if (nowMs < sunriseMs) {
    // Before sunrise: count down to today's sunrise.
    nextEventLabel = fmtCountdown("Sunrise", (sunriseMs - nowMs) / 60_000);
  } else if (nowMs < sunsetMs) {
    // During day: count down to sunset.
    nextEventLabel = fmtCountdown("Sunset", (sunsetMs - nowMs) / 60_000);
  } else {
    // After sunset: count down to tomorrow's sunrise.
    nextEventLabel = fmtCountdown("Sunrise", (tomorrowSunriseMs - nowMs) / 60_000);
  }

  return (
    <Modal open={open} onClose={onClose} title="Clock" width={720} maxHeight={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Solar arc SVG ─────────────────────────────────────────────────── */}
        {/* The arc is the primary reading surface: position of the sun dot
            communicates daylight progress at a glance without any numbers.
            idPrefix "clock" namespaces gradient/clip ids so the arc can coexist
            with WeatherModalSunDayArc (idPrefix "wm") in the same DOM. */}
        <SolarDayArcGraphic
          sunriseIso={sunriseIso}
          sunsetIso={sunsetIso}
          nowMs={nowMs}
          idPrefix="clock"
          dims={CLOCK_ARC_DIMS}
          ariaLabel="Solar day arc showing sun position from sunrise to sunset"
        />

        {/* ── Stats row ─────────────────────────────────────────────────────── */}
        {/* Three cells on a single row. Consistent gap 13 matches Controls grid. */}
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
              border: "1px solid var(--hair)",
              borderRadius: 13,
              padding: "14px 16px",
            }}
          >
            <Stat label="Day length" value={dayLengthStr} />
          </div>
          <div
            style={{
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 13,
              padding: "14px 16px",
            }}
          >
            <Stat
              label="Daylight left"
              value={daylightRemainingStr}
              accent={isDaytime}
              muted={!isDaytime}
            />
          </div>
          <div
            style={{
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 13,
              padding: "14px 16px",
            }}
          >
            <Stat label="Sun position" value={`${sunPct}%`} accent={isDaytime} muted={!isDaytime} />
          </div>
        </div>

        {/* ── Next event pill ───────────────────────────────────────────────── */}
        {/* A single amber pill reads as a live countdown so the wall panel gives
            an at-a-glance answer to "when is the next solar transition". */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="cap">Next</span>
          <span className="pill amber">
            {/* Amber dot as a visual "live" indicator */}
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--amber)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {nextEventLabel}
          </span>
        </div>
      </div>
    </Modal>
  );
}
