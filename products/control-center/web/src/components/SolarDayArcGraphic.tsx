/**
 * SolarDayArcGraphic , shared SVG solar-day arc used by
 * ClockModalSolarDayArc and WeatherModalSunDayArc.
 *
 * WHY a shared component: the two modals render functionally identical SVG
 * solar arcs (gradient sky fill, sun disc riding a bezier horizon arc, horizon
 * baseline, sunrise/sunset markers). The only differences are:
 *   1. SVG viewport dimensions and arc constants (controlled via `dims` prop).
 *   2. Gradient/clip-path id strings , SVG IDs are global in the DOM, so two
 *      instances on the same page would share a gradient if both used "skyGrad".
 *      The `idPrefix` prop namespaces all IDs so stories with both components
 *      open simultaneously don't fight over the same gradient definition.
 *
 * This component is PURE (no hooks, no trpc). Callers handle outer Modal,
 * stat rows, chip rows, and countdowns , this renders only the arc SVG block.
 */

// ─── types ────────────────────────────────────────────────────────────────────

/** Arc geometry constants , passed as a single object so callers can define their
 *  own dimensions without introducing new named props for every constant. */
export interface ArcDims {
  /** SVG viewport width */
  svgW: number;
  /** SVG viewport height */
  svgH: number;
  /** Horizontal inset from SVG edge to sunrise/sunset endpoints */
  padX: number;
  /** y-coordinate of the horizon line (from top of SVG) */
  midY: number;
  /** How high the arc peak sits above the horizon line */
  peakOffset: number;
}

export interface SolarDayArcGraphicProps {
  /**
   * ISO datetime for today's sunrise, e.g. "2026-05-31T06:02:00".
   */
  sunriseIso: string;
  /**
   * ISO datetime for today's sunset, e.g. "2026-05-31T19:48:00".
   */
  sunsetIso: string;
  /**
   * Current local time as milliseconds (Date.now() snapshot from the caller).
   * Passed in so the component stays pure and testable without time-stubbing.
   */
  nowMs: number;
  /**
   * Unique prefix for all SVG gradient and clip-path IDs.
   * Use different values in each instance to prevent DOM id clashes when both
   * modals are rendered simultaneously (e.g. in Storybook).
   */
  idPrefix: string;
  /** Arc geometry , viewport dimensions and curve constants. */
  dims: ArcDims;
  /**
   * ARIA label for the SVG element.
   * Defaults to "Solar day arc showing sun position from sunrise to sunset".
   */
  ariaLabel?: string;
}

// ─── internal helpers ─────────────────────────────────────────────────────────

/**
 * Map a progress value [0, 1] to an x-coordinate across the arc.
 * 0 = sunrise (left endpoint), 1 = sunset (right endpoint).
 */
function arcX(progress: number, arcWidth: number, padX: number): number {
  return padX + progress * arcWidth;
}

/**
 * Build the SVG cubic-bezier "horizon hump" path string.
 * The path goes from (padX, midY) to (padX+arcWidth, midY), rising to
 * peakOffset above the midY line. Control points are symmetric about the
 * center for a natural convex curve.
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

/** Format an ISO datetime as "h:mm AM/PM" in local time. */
function fmtIsoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── component ────────────────────────────────────────────────────────────────

export function SolarDayArcGraphic({
  sunriseIso,
  sunsetIso,
  nowMs,
  idPrefix,
  dims,
  ariaLabel = "Solar day arc showing sun position from sunrise to sunset",
}: SolarDayArcGraphicProps) {
  const { svgW, svgH, padX, midY, peakOffset } = dims;
  const arcWidth = svgW - padX * 2;

  const sunriseMs = new Date(sunriseIso).getTime();
  const sunsetMs = new Date(sunsetIso).getTime();

  // Progress: fraction of daylight elapsed. 0 at sunrise, 1 at sunset.
  // May be negative (before sunrise) or >1 (after sunset).
  const progressRaw = (nowMs - sunriseMs) / (sunsetMs - sunriseMs);
  const isDaytime = progressRaw >= 0 && progressRaw <= 1;

  // Clamp sun disc to arc interior so it never flies off the edge during night.
  const sunProgress = Math.max(0.01, Math.min(0.99, progressRaw));

  // Parabolic approximation of the cubic-bezier y-coordinate:
  //   y(p) ≈ midY − peakOffset × 4p(1−p)
  const sunDotX = arcX(sunProgress, arcWidth, padX);
  const sunDotY = midY - peakOffset * 4 * sunProgress * (1 - sunProgress);

  const arcPath = buildArcPath(padX, midY, arcWidth, peakOffset);

  // Namespaced IDs , prevent clashes when multiple instances are in the DOM.
  const skyGradId = `${idPrefix}-skyGrad`;
  const nightFillId = `${idPrefix}-nightFill`;
  const arcClipId = `${idPrefix}-arcClip`;

  const sunriseLabel = fmtIsoTime(sunriseIso);
  const sunsetLabel = fmtIsoTime(sunsetIso);

  return (
    <div
      style={{
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: 15,
        overflow: "hidden",
      }}
    >
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: "block" }}
        aria-label={ariaLabel}
        role="img"
      >
        <defs>
          {/* Sky gradient: deep indigo (night) → amber (golden hour) → pale sky (day).
              Runs horizontally so color shifts from dawn on left through noon at
              center to dusk on right , parallels the sky palette at each arc point. */}
          <linearGradient
            id={skyGradId}
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

          {/* Night fill: faint violet below the horizon baseline */}
          <linearGradient id={nightFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d0820" stopOpacity="0" />
            <stop offset="100%" stopColor="#0d0820" stopOpacity="0.8" />
          </linearGradient>

          {/* Clip path so sky gradient only paints inside the arc sweep */}
          <clipPath id={arcClipId}>
            <path
              d={`${buildArcPath(padX, midY, arcWidth, peakOffset)} L ${padX + arcWidth} ${midY} L ${padX} ${midY} Z`}
            />
          </clipPath>
        </defs>

        {/* Sky color fill inside the arc */}
        <rect
          x={padX}
          y={0}
          width={arcWidth}
          height={midY}
          fill={`url(#${skyGradId})`}
          clipPath={`url(#${arcClipId})`}
          opacity={0.28}
        />

        {/* Horizon baseline */}
        <line
          x1={padX - 8}
          y1={midY}
          x2={padX + arcWidth + 8}
          y2={midY}
          stroke="var(--hair-2)"
          strokeWidth={1}
        />

        {/* Night fill below horizon , reinforces we're looking UP */}
        <rect
          x={padX}
          y={midY}
          width={arcWidth}
          height={svgH - midY}
          fill={`url(#${nightFillId})`}
          opacity={0.6}
        />

        {/* Full arc track , dim guide path */}
        <path
          d={arcPath}
          fill="none"
          stroke="var(--hair-2)"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Elapsed arc segment (sunrise → sun disc), glowing --acc.
            Only painted during daytime so pre-dawn/post-dusk has a clean unlit arc. */}
        {isDaytime && (
          <path
            d={buildArcPath(
              padX,
              midY,
              sunProgress * arcWidth,
              peakOffset * 4 * sunProgress * (1 - sunProgress) + peakOffset * 0.001,
            )}
            fill="none"
            stroke="var(--acc)"
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.7}
          />
        )}

        {/* Sunrise endpoint marker */}
        <circle cx={padX} cy={midY} r={4} fill="var(--amber)" opacity={0.85} />
        <text
          x={padX}
          y={midY + 16}
          textAnchor="middle"
          fill="var(--amber)"
          style={{ font: "500 9px var(--mono)" }}
          opacity={0.8}
        >
          {sunriseLabel}
        </text>

        {/* Sunset endpoint marker */}
        <circle cx={padX + arcWidth} cy={midY} r={4} fill="var(--amber)" opacity={0.85} />
        <text
          x={padX + arcWidth}
          y={midY + 16}
          textAnchor="middle"
          fill="var(--amber)"
          style={{ font: "500 9px var(--mono)" }}
          opacity={0.8}
        >
          {sunsetLabel}
        </text>

        {/* Solar noon tick , visual midpoint anchor */}
        <line
          x1={padX + arcWidth / 2}
          y1={midY - 6}
          x2={padX + arcWidth / 2}
          y2={midY + 6}
          stroke="var(--ink-3)"
          strokeWidth={1}
        />
        <text
          x={padX + arcWidth / 2}
          y={midY + 16}
          textAnchor="middle"
          fill="var(--ink-3)"
          style={{ font: "500 8px var(--mono)" }}
        >
          noon
        </text>

        {/* Sun disc , outer glow ring + main dot, rides the arc at current progress */}
        {/* Glow ring: only visible during daytime */}
        <circle cx={sunDotX} cy={sunDotY} r={isDaytime ? 14 : 0} fill="rgba(244, 192, 99, 0.12)" />
        {/* Main dot */}
        <circle
          cx={sunDotX}
          cy={sunDotY}
          r={isDaytime ? 7 : 5}
          fill={isDaytime ? "var(--amber)" : "var(--ink-3)"}
          stroke={isDaytime ? "rgba(244, 192, 99, 0.5)" : "var(--hair-2)"}
          strokeWidth={2}
        />

        {/* "now" label above the sun dot during daytime */}
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
  );
}
