/**
 * WeatherModalSunDayArc — "Sun Arc & Daylight" detail view for the Weather tile.
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
 * Mid: focal Stat — large countdown to the next solar event ("2h 14m to sunset").
 *
 * Bottom: 4 read-only Chip labels — Sunrise / Solar Noon / Sunset / Daylight
 * (total day length as Hh Mm). These derive entirely from the ISO fields already
 * on the wire, with solar noon as the sunrise/sunset midpoint.
 *
 * PURE view: all data + callbacks arrive via props (no trpc/hooks). Renders
 * inside the shared <Modal> so backdrop/Escape/close are handled centrally.
 */

import { Modal, Stat } from "../../ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface WeatherModalSunDayArcProps {
  open: boolean;
  onClose: () => void;
  /** Today's sunrise as ISO local datetime, e.g. "2026-05-31T05:58:00" */
  sunriseIso: string;
  /** Today's sunset as ISO local datetime, e.g. "2026-05-31T20:02:00" */
  sunsetIso: string;
  /** Tomorrow's sunrise ISO datetime — drives the overnight countdown */
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

/**
 * Compute the x-coordinate of a point at arc progress [0,1] across the flat
 * chord from sunrise (PAD_X) to sunset (PAD_X + ARC_W).
 */
function arcX(progress: number, arcWidth: number, padX: number): number {
  return padX + progress * arcWidth;
}

/**
 * Build an SVG cubic-bezier semicircle from (padX, midY) to
 * (padX+arcWidth, midY) rising to peakOffset above the horizon line.
 * Control points are symmetric about the centre — reads as a natural horizon hump.
 */
function buildArcPath(padX: number, midY: number, arcWidth: number, peakOffset: number): string {
  const x0 = padX;
  const x1 = padX + arcWidth;
  const xM = padX + arcWidth / 2;
  const yTop = midY - peakOffset;
  const cp1x = xM - arcWidth * 0.1;
  const cp2x = xM + arcWidth * 0.1;
  return `M ${x0} ${midY} C ${cp1x} ${yTop}, ${cp2x} ${yTop}, ${x1} ${midY}`;
}

// ─── arc constants ─────────────────────────────────────────────────────────────

// Modal body width: 640 panel - 40 padding = 600. Minus an inner rect pad of
// 20px each side the drawable SVG width is 600. The arc inset (PAD_X) keeps the
// endpoint markers from clipping at the SVG edge.
const SVG_W = 600;
const SVG_H = 220;
const PAD_X = 36; // inset from SVG edge to sunrise/sunset endpoints
const ARC_W = SVG_W - PAD_X * 2;
const MID_Y = SVG_H - 36; // y-coordinate of the horizon line (leaves room for labels)
const PEAK_OFFSET = 160; // arc height above the horizon

// ─── view ─────────────────────────────────────────────────────────────────────

export function WeatherModalSunDayArc({
  open,
  onClose,
  sunriseIso,
  sunsetIso,
  tomorrowSunriseIso,
  nowMs,
}: WeatherModalSunDayArcProps) {
  if (!open) return null;

  const sunriseMs = new Date(sunriseIso).getTime();
  const sunsetMs = new Date(sunsetIso).getTime();
  const tomorrowSunriseMs = new Date(tomorrowSunriseIso).getTime();

  // Solar noon is the midpoint of sunrise..sunset (ISO midpoint arithmetic).
  const solarNoonMs = sunriseMs + (sunsetMs - sunriseMs) / 2;
  const solarNoonIso = new Date(solarNoonMs).toISOString();

  const dayLengthMin = minutesBetween(sunriseIso, sunsetIso);

  // Fractional progress across the daylight window. 0 = sunrise, 1 = sunset.
  // Negative = before sunrise, >1 = after sunset.
  const progressRaw = (nowMs - sunriseMs) / (sunsetMs - sunriseMs);
  const isDaytime = progressRaw >= 0 && progressRaw <= 1;

  // Sun disc position: clamp to arc interior so it never flies off the edge.
  const sunProgress = Math.max(0.01, Math.min(0.99, progressRaw));

  // Parabolic approximation of the cubic bezier y-coordinate:
  //   y(p) ≈ midY − peakOffset × 4p(1−p)
  const sunDotX = arcX(sunProgress, ARC_W, PAD_X);
  const sunDotY = MID_Y - PEAK_OFFSET * 4 * sunProgress * (1 - sunProgress);

  // Next solar event countdown — descriptive label so no extra parsing needed.
  let nextEventLabel: string;
  if (nowMs < sunriseMs) {
    nextEventLabel = `${fmtDuration((sunriseMs - nowMs) / 60_000)} to sunrise`;
  } else if (nowMs < sunsetMs) {
    nextEventLabel = `${fmtDuration((sunsetMs - nowMs) / 60_000)} to sunset`;
  } else {
    nextEventLabel = `${fmtDuration((tomorrowSunriseMs - nowMs) / 60_000)} to sunrise`;
  }

  const arcPath = buildArcPath(PAD_X, MID_Y, ARC_W, PEAK_OFFSET);

  const sunriseLabel = fmtIsoTime(sunriseIso);
  const solarNoonLabel = fmtIsoTime(solarNoonIso);
  const sunsetLabel = fmtIsoTime(sunsetIso);

  return (
    <Modal open={open} onClose={onClose} title="Weather" width={640} maxHeight={640}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Solar arc ──────────────────────────────────────────────────────── */}
        {/* The semicircle is the primary reading surface — the sun disc position
            answers "where are we in the day" faster than any number. The gradient
            fill encodes sky state: deep indigo at the tips (pre/post-dusk), warm
            amber through the golden-hour bands, pale sky blue at the zenith. */}
        <div
          style={{
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 15,
            overflow: "hidden",
          }}
        >
          <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ display: "block" }}
            aria-label="Sun arc showing position from sunrise to sunset"
            role="img"
          >
            <defs>
              {/* Sky gradient: horizontal, indigo (night) → amber (golden hour) →
                  pale sky (midday) → amber → indigo. Parallels the sky palette
                  so the arc reads as a cross-section of the day. */}
              <linearGradient
                id="wm-skyGrad"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
                gradientUnits="objectBoundingBox"
              >
                <stop offset="0%" stopColor="#1a1060" />
                <stop offset="11%" stopColor="#c8703a" />
                <stop offset="28%" stopColor="#e8c97a" stopOpacity="0.6" />
                <stop offset="50%" stopColor="#c8ddff" stopOpacity="0.5" />
                <stop offset="72%" stopColor="#e8c97a" stopOpacity="0.6" />
                <stop offset="89%" stopColor="#c8703a" />
                <stop offset="100%" stopColor="#1a1060" />
              </linearGradient>

              {/* Night fill: faint violet below the horizon baseline */}
              <linearGradient id="wm-nightFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0d0820" stopOpacity="0" />
                <stop offset="100%" stopColor="#0d0820" stopOpacity="0.7" />
              </linearGradient>

              {/* Clip to the closed arc region so the sky gradient stays inside */}
              <clipPath id="wm-arcClip">
                <path
                  d={`${buildArcPath(PAD_X, MID_Y, ARC_W, PEAK_OFFSET)} L ${PAD_X + ARC_W} ${MID_Y} L ${PAD_X} ${MID_Y} Z`}
                />
              </clipPath>
            </defs>

            {/* Sky colour inside the arc */}
            <rect
              x={PAD_X}
              y={0}
              width={ARC_W}
              height={MID_Y}
              fill="url(#wm-skyGrad)"
              clipPath="url(#wm-arcClip)"
              opacity={0.3}
            />

            {/* Horizon baseline */}
            <line
              x1={PAD_X - 6}
              y1={MID_Y}
              x2={PAD_X + ARC_W + 6}
              y2={MID_Y}
              stroke="var(--hair-2)"
              strokeWidth={1}
            />

            {/* Night fill below horizon */}
            <rect
              x={PAD_X}
              y={MID_Y}
              width={ARC_W}
              height={SVG_H - MID_Y}
              fill="url(#wm-nightFill)"
              opacity={0.55}
            />

            {/* Full arc track — dim guide path */}
            <path
              d={arcPath}
              fill="none"
              stroke="var(--hair-2)"
              strokeWidth={1.5}
              strokeLinecap="round"
            />

            {/* Elapsed arc segment (sunrise → sun disc) — glowing accent green.
                Only painted during daytime so a pre-dawn/post-dusk modal has a
                clean unlit arc rather than a confusing partial fill. */}
            {isDaytime && (
              <path
                d={buildArcPath(
                  PAD_X,
                  MID_Y,
                  sunProgress * ARC_W,
                  PEAK_OFFSET * 4 * sunProgress * (1 - sunProgress) + 0.001,
                )}
                fill="none"
                stroke="var(--acc)"
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.65}
              />
            )}

            {/* Solar noon tick — visual midpoint anchor */}
            <line
              x1={PAD_X + ARC_W / 2}
              y1={MID_Y - 7}
              x2={PAD_X + ARC_W / 2}
              y2={MID_Y + 7}
              stroke="var(--ink-3)"
              strokeWidth={1}
            />
            <text
              x={PAD_X + ARC_W / 2}
              y={MID_Y + 20}
              textAnchor="middle"
              fill="var(--ink-3)"
              style={{ font: "500 8.5px var(--mono)" }}
            >
              noon
            </text>

            {/* Sunrise endpoint marker */}
            <circle cx={PAD_X} cy={MID_Y} r={3.5} fill="var(--amber)" opacity={0.85} />
            <text
              x={PAD_X}
              y={MID_Y + 20}
              textAnchor="middle"
              fill="var(--amber)"
              style={{ font: "500 8.5px var(--mono)" }}
              opacity={0.8}
            >
              {sunriseLabel}
            </text>

            {/* Sunset endpoint marker */}
            <circle cx={PAD_X + ARC_W} cy={MID_Y} r={3.5} fill="var(--amber)" opacity={0.85} />
            <text
              x={PAD_X + ARC_W}
              y={MID_Y + 20}
              textAnchor="middle"
              fill="var(--amber)"
              style={{ font: "500 8.5px var(--mono)" }}
              opacity={0.8}
            >
              {sunsetLabel}
            </text>

            {/* Sun disc — outer glow + inner dot, rides the arc at current progress */}
            {/* Glow ring: only visible during daytime (radius 0 hides it at night) */}
            <circle
              cx={sunDotX}
              cy={sunDotY}
              r={isDaytime ? 16 : 0}
              fill="rgba(244, 192, 99, 0.12)"
            />
            {/* Main disc */}
            <circle
              cx={sunDotX}
              cy={sunDotY}
              r={isDaytime ? 8 : 5}
              fill={isDaytime ? "var(--amber)" : "var(--ink-3)"}
              stroke={isDaytime ? "rgba(244, 192, 99, 0.55)" : "var(--hair-2)"}
              strokeWidth={isDaytime ? 2.5 : 1.5}
            />

            {/* "now" label above the disc during daytime */}
            {isDaytime && (
              <text
                x={sunDotX}
                y={sunDotY - 16}
                textAnchor="middle"
                fill="var(--amber)"
                style={{ font: "600 9px var(--mono)" }}
                opacity={0.9}
              >
                now
              </text>
            )}
          </svg>
        </div>

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

        {/* ── Chip row — four solar facts ───────────────────────────────────── */}
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

            {/* Solar noon — derived midpoint of sunrise/sunset */}
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

            {/* Daylight duration — derived from sunset - sunrise */}
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
    </Modal>
  );
}
