/**
 * WeatherModalSunDayArc , "Sun Arc & Daylight" detail view for the Weather tile.
 *
 * WHY this layout: The Weather tile shows a single "Sunset 7:52 PM" line, but
 * the data wire already carries precise ISO solar fields for sunrise, sunset,
 * and tomorrow's sunrise. This modal turns those timestamps into a live
 * astronomical arc: left tip = today's sunrise, right tip = today's sunset,
 * the sun disc rides the semicircle at the current fractional day-progress.
 * A positioned disc communicates "how far through daylight are we" as spatial
 * intuition rather than arithmetic. The gradient fill (indigo → amber → pale
 * sky) reinforces the sky state at each point on the arc.
 *
 * Hero: 580px-wide SVG semicircle (~220px tall) with gradient horizon fill,
 * positioned sun disc, and dawn/dusk tick labels. Solar noon (midpoint of
 * the arc) is marked with a tick + label so the arc has a visual anchor.
 *
 * Mid: focal Stat , large countdown to the next solar event ("2h 14m to sunset").
 *
 * Bottom: 4 read-only Chip labels , Sunrise / Solar Noon / Sunset / Daylight
 * (total day length as Hh Mm). These derive entirely from the ISO fields already
 * on the wire, with solar noon as the sunrise/sunset midpoint.
 *
 * PURE view: all data + callbacks arrive via props (no trpc/hooks). Renders
 * as a bare page body hosted by TileDetailHost.
 */

import { Stat } from "@/components/ui";
import { SolarDayArcGraphic } from "../SolarDayArcGraphic";

// ─── types ────────────────────────────────────────────────────────────────────

export interface WeatherModalSunDayArcProps {
  /** Today's sunrise as ISO local datetime, e.g. "2026-05-31T05:58:00" */
  sunriseIso: string;
  /** Today's sunset as ISO local datetime, e.g. "2026-05-31T20:02:00" */
  sunsetIso: string;
  /** Tomorrow's sunrise ISO datetime , drives the overnight countdown */
  tomorrowSunriseIso: string;
  /**
   * Current local time as milliseconds (Date.now() snapshot from the caller).
   * Passed in so the component is fully pure and testable without time-stubbing.
   */
  nowMs: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Total minutes between two ISO strings, clamped ≥ 0 */
function minutesBetween(isoA: string, isoB: string): number {
  return Math.max(0, (new Date(isoB).getTime() - new Date(isoA).getTime()) / 60_000);
}

/** Format whole minutes as "Xh Ym" (or "Ym" if under an hour) */
function fmtDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Format an ISO local datetime as "h:mm AM/PM" */
function fmtIsoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── arc constants ─────────────────────────────────────────────────────────────

// Body width: 600 (from the old 640 modal). The arc inset (PAD_X) keeps
// endpoint markers from clipping at the SVG edge.
const WEATHER_ARC_DIMS = {
  svgW: 600,
  svgH: 220,
  padX: 36,
  midY: 184, // SVG_H - 36
  peakOffset: 160,
} as const;

// ─── view ─────────────────────────────────────────────────────────────────────

export function WeatherModalSunDayArc({
  sunriseIso,
  sunsetIso,
  tomorrowSunriseIso,
  nowMs,
}: WeatherModalSunDayArcProps) {
  const sunriseMs = new Date(sunriseIso).getTime();
  const sunsetMs = new Date(sunsetIso).getTime();
  const tomorrowSunriseMs = new Date(tomorrowSunriseIso).getTime();

  // Solar noon is the midpoint of sunrise..sunset (ISO midpoint arithmetic).
  const solarNoonMs = sunriseMs + (sunsetMs - sunriseMs) / 2;
  const solarNoonIso = new Date(solarNoonMs).toISOString();

  const dayLengthMin = minutesBetween(sunriseIso, sunsetIso);

  // Next solar event countdown , descriptive label so no extra parsing needed.
  let nextEventLabel: string;
  if (nowMs < sunriseMs) {
    nextEventLabel = `${fmtDuration((sunriseMs - nowMs) / 60_000)} to sunrise`;
  } else if (nowMs < sunsetMs) {
    nextEventLabel = `${fmtDuration((sunsetMs - nowMs) / 60_000)} to sunset`;
  } else {
    nextEventLabel = `${fmtDuration((tomorrowSunriseMs - nowMs) / 60_000)} to sunrise`;
  }

  const sunriseLabel = fmtIsoTime(sunriseIso);
  const solarNoonLabel = fmtIsoTime(solarNoonIso);
  const sunsetLabel = fmtIsoTime(sunsetIso);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Solar arc ──────────────────────────────────────────────────────── */}
        {/* The semicircle is the primary reading surface , the sun disc position
            answers "where are we in the day" faster than any number.
            idPrefix "wm" namespaces gradient/clip ids so the arc can coexist
            with any other SolarDayArcGraphic instance in the same DOM. */}
        <SolarDayArcGraphic
          sunriseIso={sunriseIso}
          sunsetIso={sunsetIso}
          nowMs={nowMs}
          idPrefix="wm"
          dims={WEATHER_ARC_DIMS}
          ariaLabel="Sun arc showing position from sunrise to sunset"
        />

        {/* ── Countdown focal stat ───────────────────────────────────────────── */}
        {/* A single large Stat communicates the most actionable solar datum: how
            long until the next transition. Amber accent so it reads as "live". */}
        <div
          style={{
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 13,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Amber live dot matches the arc endpoint markers */}
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--amber)",
              flexShrink: 0,
            }}
          />
          <Stat label="Next solar event" value={nextEventLabel} accent />
        </div>

        {/* ── Chip row , four solar facts ───────────────────────────────────── */}
        {/* Four read-only labels present the key times + derived day length in a
            consistent visual weight. They are display-only (no onClick), styled
            as inert chips rather than interactive buttons to avoid misleading
            affordance on a wall panel. gap 13 matches Controls grid rhythm. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Today</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 13 }}>
            {/* Sunrise */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 11,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span className="cap">Sunrise</span>
              <span
                className="mono"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--amber)" }}
              >
                {sunriseLabel}
              </span>
            </div>

            {/* Solar noon , derived midpoint of sunrise/sunset */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 11,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span className="cap">Solar noon</span>
              <span
                className="mono"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}
              >
                {solarNoonLabel}
              </span>
            </div>

            {/* Sunset */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 11,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span className="cap">Sunset</span>
              <span
                className="mono"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--amber)" }}
              >
                {sunsetLabel}
              </span>
            </div>

            {/* Daylight duration , derived from sunset - sunrise */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 11,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span className="cap">Daylight</span>
              <span
                className="mono"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}
              >
                {fmtDuration(dayLengthMin)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
