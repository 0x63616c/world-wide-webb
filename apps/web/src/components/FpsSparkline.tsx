/**
 * A tiny, axis-free FPS sparkline pinned beside the live FPS readout (top-right).
 *
 * The path math is a pure function (`buildSparklinePath`) so it can be unit
 * tested and driven from Storybook without a canvas: samples map to an SVG
 * polyline, x evenly spaced across the width, y inverted (higher FPS = higher on
 * screen) and clamped to [0, maxFps]. The component is deliberately subtle , one
 * hairline stroke in --ink-3 at low opacity, no fill, no axes , so it reads as a
 * texture next to the numeric readout rather than a chart.
 */

const WIDTH = 72;
const HEIGHT = 16;

/**
 * SVG polyline `points` for the given FPS samples. x is evenly spaced across
 * `width`; y = height - clamp(fps, 0, maxFps) / maxFps * height so a higher FPS
 * sits higher on screen. A single sample collapses to one point (x = 0).
 */
export function buildSparklinePath(
  samples: number[],
  width: number,
  height: number,
  maxFps = 60,
): string {
  const n = samples.length;
  const step = n > 1 ? width / (n - 1) : 0;
  return samples
    .map((fps, i) => {
      const clamped = Math.min(maxFps, Math.max(0, fps));
      const x = i * step;
      const y = height - (clamped / maxFps) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

export function FpsSparkline({ samples }: { samples: number[] }) {
  // A single point draws nothing meaningful; wait for at least two samples.
  if (samples.length < 2) return null;
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ opacity: 0.5, display: "block" }}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth={1}
        points={buildSparklinePath(samples, WIDTH, HEIGHT)}
      />
    </svg>
  );
}
