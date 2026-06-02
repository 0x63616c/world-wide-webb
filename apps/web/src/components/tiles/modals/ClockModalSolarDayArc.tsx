/**
 * ClockModalSolarDayArc — "Solar Day Arc" horizon sweep.
 *
 * WHY this layout: The Clock tile shows wall-clock time but gives no sense of
 * solar geometry — how much daylight remains, where on the arc the sun sits
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
 * Mid: 3 Stat cells — Day length, Daylight remaining, Sun position %.
 * Bottom: a Pill row with the next solar event (countdown to sunset or sunrise).
 *
 * PURE view: all data + callbacks arrive via props (no trpc/hooks). Renders
 * inside the shared <Modal> so backdrop/Escape/close are handled centrally.
 */

import { Modal, Stat } from "../../ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ClockModalSolarDayArcProps {
  open: boolean;
  onClose: () => void;
  /** ISO datetime for today's sunrise, e.g. "2026-05-31T06:02:00" */
  sunriseIso: string;
  /** ISO datetime for today's sunset, e.g. "2026-05-31T19:48:00" */
  sunsetIso: string;
  /** ISO datetime for tomorrow's sunrise — drives the overnight countdown */
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

/**
 * Map a progress value [0, 1] across the arc's visible width.
 * progress 0 = sunrise (left), 1 = sunset (right). Values outside [0,1]
 * represent night time before sunrise (negative) or after sunset (>1).
 */
function arcX(progress: number, arcWidth: number, padX: number): number {
  return padX + progress * arcWidth;
}

// Arc path: a semicircle from (padX, midY) to (padX + arcWidth, midY) peaking
// at (padX + arcWidth/2, topY). Built as a cubic bezier that reads as a natural
// horizon hump — the control points are slightly above the peak for a gentle
// convex curve (not a symmetric parabola).
function buildArcPath(padX: number, midY: number, arcWidth: number, peakOffset: number): string {
  const x0 = padX;
  const x1 = padX + arcWidth;
  const xM = padX + arcWidth / 2;
  const yTop = midY - peakOffset;
  // Cubic bezier: start → left ctrl → right ctrl → end
  const cp1x = xM - arcWidth * 0.1;
  const cp2x = xM + arcWidth * 0.1;
  return `M ${x0} ${midY} C ${cp1x} ${yTop}, ${cp2x} ${yTop}, ${x1} ${midY}`;
}

// ─── arc constants ─────────────────────────────────────────────────────────────

// SVG viewport — full modal body width is 680 (720 panel - 40 padding).
const SVG_W = 680;
const SVG_H = 200;
const PAD_X = 40; // horizontal inset from SVG edge to sunrise/sunset points
const ARC_W = SVG_W - PAD_X * 2; // width of the arc sweep
const MID_Y = SVG_H - 32; // y-coordinate of the horizon line
const PEAK_OFFSET = 148; // how high the arc peak sits above the horizon

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

  // Next event countdown — the label string encodes both the event name and
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

  // Sun dot x-position along the arc. Clamp to arc interior so the dot never
  // flies off the edge during night hours (it just parks at the tip).
  const sunProgress = Math.max(0.01, Math.min(0.99, progressRaw));

  // To place the dot ON the bezier path we approximate the y-coordinate using
  // the same cubic equation as the SVG path. A parabolic approximation of the
  // bezier is good enough for visual placement.
  // For a symmetric arc: y(p) ≈ midY - peakOffset * 4p(1-p)
  const sunDotX = arcX(sunProgress, ARC_W, PAD_X);
  const sunDotY = MID_Y - PEAK_OFFSET * 4 * sunProgress * (1 - sunProgress);

  // Gradient stop positions: the arc starts at sunrise (x=PAD_X) and ends at
  // sunset (x=PAD_X+ARC_W). Gradient runs left→right in SVG userSpace.
  const arcPath = buildArcPath(PAD_X, MID_Y, ARC_W, PEAK_OFFSET);

  // Formatted sunrise/sunset labels for axis labels.
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  const sunriseLabel = fmtTime(sunriseIso);
  const sunsetLabel = fmtTime(sunsetIso);

  return (
    <Modal open={open} onClose={onClose} title="Clock" width={720} maxHeight={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Solar arc SVG ─────────────────────────────────────────────────── */}
        {/* The arc is the primary reading surface: position of the sun dot
            communicates daylight progress at a glance without any numbers. */}
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
            aria-label="Solar day arc showing sun position from sunrise to sunset"
            role="img"
          >
            <defs>
              {/* Sky gradient: deep indigo (night) → amber (golden hour) → pale sky (day)
                  The gradient runs along the arc's horizontal axis so the colour
                  shifts from dawn on the left through noon at centre to dusk on the right. */}
              <linearGradient
                id="skyGrad"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
                gradientUnits="objectBoundingBox"
              >
                <stop offset="0%" stopColor="#1a1060" />
                <stop offset="12%" stopColor="#c8703a" />
                <stop offset="30%" stopColor="#e8c97a" stopOpacity="0.6" />
                <stop offset="50%" stopColor="#d4e8ff" stopOpacity="0.5" />
                <stop offset="70%" stopColor="#e8c97a" stopOpacity="0.6" />
                <stop offset="88%" stopColor="#c8703a" />
                <stop offset="100%" stopColor="#1a1060" />
              </linearGradient>

              {/* Night-side fill for below the horizon — faint violet/indigo */}
              <linearGradient id="nightFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0d0820" stopOpacity="0" />
                <stop offset="100%" stopColor="#0d0820" stopOpacity="0.8" />
              </linearGradient>

              {/* Clip path so sky gradient only paints inside the arc sweep */}
              <clipPath id="arcClip">
                {/* Closed region: arc path + baseline back to start */}
                <path
                  d={`${buildArcPath(PAD_X, MID_Y, ARC_W, PEAK_OFFSET)} L ${PAD_X + ARC_W} ${MID_Y} L ${PAD_X} ${MID_Y} Z`}
                />
              </clipPath>
            </defs>

            {/* Sky colour fill inside the arc */}
            <rect
              x={PAD_X}
              y={0}
              width={ARC_W}
              height={MID_Y}
              fill="url(#skyGrad)"
              clipPath="url(#arcClip)"
              opacity={0.28}
            />

            {/* Horizon baseline */}
            <line
              x1={PAD_X - 8}
              y1={MID_Y}
              x2={PAD_X + ARC_W + 8}
              y2={MID_Y}
              stroke="var(--hair-2)"
              strokeWidth={1}
            />

            {/* Night fill below horizon — reinforces that we're looking UP */}
            <rect
              x={PAD_X}
              y={MID_Y}
              width={ARC_W}
              height={SVG_H - MID_Y}
              fill="url(#nightFill)"
              opacity={0.6}
            />

            {/* Arc track (faint dim stroke — full path) */}
            <path
              d={arcPath}
              fill="none"
              stroke="var(--hair-2)"
              strokeWidth={2}
              strokeLinecap="round"
            />

            {/* Elapsed arc segment (sunrise → sun dot), glowing --acc */}
            {isDaytime && (
              <path
                d={buildArcPath(
                  PAD_X,
                  MID_Y,
                  sunProgress * ARC_W,
                  PEAK_OFFSET * 4 * sunProgress * (1 - sunProgress) + PEAK_OFFSET * 0.001,
                )}
                fill="none"
                stroke="var(--acc)"
                strokeWidth={2.5}
                strokeLinecap="round"
                opacity={0.7}
              />
            )}

            {/* Sunrise marker */}
            <circle cx={PAD_X} cy={MID_Y} r={4} fill="var(--amber)" opacity={0.85} />
            <text
              x={PAD_X}
              y={MID_Y + 16}
              textAnchor="middle"
              fill="var(--amber)"
              style={{ font: "500 9px var(--mono)" }}
              opacity={0.8}
            >
              {sunriseLabel}
            </text>

            {/* Sunset marker */}
            <circle cx={PAD_X + ARC_W} cy={MID_Y} r={4} fill="var(--amber)" opacity={0.85} />
            <text
              x={PAD_X + ARC_W}
              y={MID_Y + 16}
              textAnchor="middle"
              fill="var(--amber)"
              style={{ font: "500 9px var(--mono)" }}
              opacity={0.8}
            >
              {sunsetLabel}
            </text>

            {/* Solar noon tick */}
            <line
              x1={PAD_X + ARC_W / 2}
              y1={MID_Y - 6}
              x2={PAD_X + ARC_W / 2}
              y2={MID_Y + 6}
              stroke="var(--ink-3)"
              strokeWidth={1}
            />
            <text
              x={PAD_X + ARC_W / 2}
              y={MID_Y + 16}
              textAnchor="middle"
              fill="var(--ink-3)"
              style={{ font: "500 8px var(--mono)" }}
            >
              noon
            </text>

            {/* Sun dot — rides the arc at current day progress */}
            {/* Outer glow ring */}
            <circle
              cx={sunDotX}
              cy={sunDotY}
              r={isDaytime ? 14 : 0}
              fill="rgba(244, 192, 99, 0.12)"
            />
            {/* Main dot */}
            <circle
              cx={sunDotX}
              cy={sunDotY}
              r={isDaytime ? 7 : 5}
              fill={isDaytime ? "var(--amber)" : "var(--ink-3)"}
              stroke={isDaytime ? "rgba(244, 192, 99, 0.5)" : "var(--hair-2)"}
              strokeWidth={2}
            />

            {/* "Now" label above the sun dot during daytime */}
            {isDaytime && (
              <text
                x={sunDotX}
                y={sunDotY - 14}
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
