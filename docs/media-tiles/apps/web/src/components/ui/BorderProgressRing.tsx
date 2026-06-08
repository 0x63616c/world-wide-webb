// Generic progress ring traced along the rounded-rect border of ANY element.
//
// Drop it inside any `position: relative` box (e.g. a Tile). It measures the box
// at runtime (ResizeObserver) and renders a 1:1 viewBox so the stroke sits on the
// real border at any size — no baked-in tile dimensions, padding, or radius. The
// corner radius is read from the host element's computed border-radius unless you
// pass one. `progress` (0..1) fills the perimeter from top-center; the sweep is
// smoothed by a CSS transition and snaps instantly on a wrap (e.g. 1 → 0).

import { type CSSProperties, useEffect, useRef, useState } from "react";

export interface BorderProgressRingProps {
  /** Fraction of the perimeter to fill, 0..1 (clamped). */
  progress: number;
  /** Stroke width in px. Default 2.5. */
  strokeWidth?: number;
  /** Stroke color, any CSS color. Default var(--ink-3). */
  color?: string;
  /** Optional faint full-perimeter track painted behind the progress stroke. */
  trackColor?: string;
  /**
   * Corner radius (px) of the traced path. Defaults to the host element's
   * computed border-radius minus its border width, so the ring hugs the border.
   */
  radius?: number;
  /**
   * Sweep transition duration in ms. Default 0 (none) — intended for callers that
   * already update `progress` smoothly (e.g. per animation frame). Set it to match
   * a coarser update cadence to CSS-interpolate between steps instead. Either way
   * the transition is dropped on a wrap (progress decreased) so it snaps, not rewinds.
   */
  transitionMs?: number;
  /** Fill direction. Default "cw". */
  direction?: "cw" | "ccw";
  /** Override the measured width (px). With `height`, skips auto-measurement. */
  width?: number;
  /** Override the measured height (px). With `width`, skips auto-measurement. */
  height?: number;
  "data-testid"?: string;
}

const DEFAULT_STROKE = 2.5;

/** Clamp a corner radius so the corner arcs never overlap on a small box. */
function clampRadius(r: number, w: number, h: number): number {
  return Math.max(0, Math.min(r, w / 2, h / 2));
}

/**
 * Length of a rounded-rectangle perimeter: the four quarter-corner arcs sum to a
 * full circle (2πr), plus the four straight edges between them.
 */
export function perimeterLength(w: number, h: number, r: number): number {
  const rr = clampRadius(r, w, h);
  return 2 * (w - 2 * rr) + 2 * (h - 2 * rr) + 2 * Math.PI * rr;
}

/**
 * SVG path for a rounded-rect perimeter inside box [x, y, w, h], starting at
 * top-center and closing back there, wound clockwise or counter-clockwise.
 */
export function perimeterPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  direction: "cw" | "ccw",
): string {
  const rr = clampRadius(r, w, h);
  const cx = x + w / 2;
  const right = x + w;
  const bottom = y + h;
  if (direction === "cw") {
    return (
      `M ${cx} ${y}` +
      ` H ${right - rr}` +
      ` A ${rr} ${rr} 0 0 1 ${right} ${y + rr}` +
      ` V ${bottom - rr}` +
      ` A ${rr} ${rr} 0 0 1 ${right - rr} ${bottom}` +
      ` H ${x + rr}` +
      ` A ${rr} ${rr} 0 0 1 ${x} ${bottom - rr}` +
      ` V ${y + rr}` +
      ` A ${rr} ${rr} 0 0 1 ${x + rr} ${y}` +
      ` H ${cx}`
    );
  }
  return (
    `M ${cx} ${y}` +
    ` H ${x + rr}` +
    ` A ${rr} ${rr} 0 0 0 ${x} ${y + rr}` +
    ` V ${bottom - rr}` +
    ` A ${rr} ${rr} 0 0 0 ${x + rr} ${bottom}` +
    ` H ${right - rr}` +
    ` A ${rr} ${rr} 0 0 0 ${right} ${bottom - rr}` +
    ` V ${y + rr}` +
    ` A ${rr} ${rr} 0 0 0 ${right - rr} ${y}` +
    ` H ${cx}`
  );
}

export function BorderProgressRing({
  progress,
  strokeWidth = DEFAULT_STROKE,
  color = "var(--ink-3)",
  trackColor,
  radius,
  transitionMs = 0,
  direction = "cw",
  width,
  height,
  "data-testid": testId,
}: BorderProgressRingProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const explicit = width != null && height != null;
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    explicit ? { w: width, h: height } : null,
  );
  const [autoRadius, setAutoRadius] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (explicit) {
      setMeasured({ w: width, h: height });
      return;
    }
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setMeasured({ w: rect.width, h: rect.height });
      // Derive the corner radius from the host's border so the ring hugs it.
      if (radius === undefined && el.parentElement) {
        const cs = getComputedStyle(el.parentElement);
        const br = Number.parseFloat(cs.borderTopLeftRadius) || 0;
        const bw = Number.parseFloat(cs.borderTopWidth) || 0;
        setAutoRadius(Math.max(0, br - bw));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [explicit, width, height, radius]);

  // Drop the transition on a wrap (progress decreased) so the ring snaps back to
  // its new position instead of animating the whole sweep backwards.
  const clamped = Math.min(Math.max(progress, 0), 1);
  const prev = useRef(clamped);
  const isWrap = clamped < prev.current;
  prev.current = clamped;

  const w = measured?.w ?? 0;
  const h = measured?.h ?? 0;
  // Inset by half the stroke so the stroke sits fully inside the box (it isn't
  // clipped by the host's overflow) with its outer edge on the border.
  const inset = strokeWidth / 2;
  const boxW = w - strokeWidth;
  const boxH = h - strokeWidth;
  const pathRadius = (radius ?? autoRadius ?? 0) - inset;
  const drawable = boxW > 0 && boxH > 0;
  const length = drawable ? perimeterLength(boxW, boxH, pathRadius) : 0;
  const d = drawable ? perimeterPath(inset, inset, boxW, boxH, pathRadius, direction) : "";
  const dashoffset = length * (1 - clamped);

  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    overflow: "visible",
  };

  return (
    <svg
      ref={svgRef}
      data-testid={testId}
      aria-hidden="true"
      viewBox={drawable ? `0 0 ${w} ${h}` : undefined}
      style={style}
    >
      {drawable && trackColor && (
        <path d={d} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      )}
      {drawable && (
        <path
          data-ring-path=""
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={String(length)}
          strokeDashoffset={String(dashoffset)}
          style={{
            transition:
              isWrap || transitionMs <= 0 ? "none" : `stroke-dashoffset ${transitionMs}ms linear`,
          }}
        />
      )}
    </svg>
  );
}
