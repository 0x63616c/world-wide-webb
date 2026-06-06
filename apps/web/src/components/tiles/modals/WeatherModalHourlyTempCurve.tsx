/**
 * WeatherModalHourlyTempCurve — "24h Temperature & Feels Curve" detail modal
 * for the Weather tile.
 *
 * Why this layout:
 *  The compact tile surfaces one number (current temp). This modal turns the
 *  same hourly data into a scrubable time-series, exposing the divergence
 *  between actual temp and perceived feels-like across the next 24 hours —
 *  a genuinely different read vs "here is the current value bigger."
 *
 *  Layout:
 *   - Top readout row: condition icon + hour label + exact temp/feels for the
 *     scrubbed (or "Now") hour. TileHeader-style proportions.
 *   - Middle: SVG dual-line chart (temp = solid accent, feels = dashed dim),
 *     with a shaded day/night band derived from the is_day flag per slot.
 *     A vertical "Now" marker pins the current hour on the x-axis.
 *     Clicking/tapping a column scrubs the readout row.
 *   - Bottom: 4-up Stat row — current temp, current feels, daily hi, daily lo.
 *
 *  Data ground truth:
 *   - weather.hourly: 24 slots of { t, temp, feels, ic, isDay } — same
 *     Open-Meteo hourly endpoint, just reading 24 slots instead of 12.
 *   - weather.now: { temp, feels, hi, lo } — live current + daily envelope.
 *   All fields already exist in the API; no new integrations required.
 *
 *  PURE view: all data + callbacks arrive via props. No trpc/hooks. Composes
 *  trivially in Storybook and tests.
 */

import { useState } from "react";
import type { IconName } from "@/components/Icon";
import { Icon } from "@/components/Icon";
import { Modal, Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** One hourly slot as returned by weather.hourly (extended to 24 slots). */
export interface HourlySlot {
  /** Hour label — "Now" for the first slot, "1PM" / "2AM" etc. for the rest. */
  t: string;
  temp: number;
  feels: number;
  /** Condition icon name: "sun" | "moon" | "cloud" | "cloud-sun" */
  ic: string;
  /** True when the sun is above the horizon for this slot (is_day from Open-Meteo). */
  isDay: boolean;
}

export interface WeatherModalHourlyTempCurveProps {
  open: boolean;
  onClose: () => void;
  /** 24-slot hourly array, first slot = "Now". */
  slots: HourlySlot[];
  /** Current temperature (°F) from weather.now.temp */
  currentTemp: number;
  /** Current feels-like (°F) from weather.now.feels */
  currentFeels: number;
  /** Daily high (°F) from weather.now.hi */
  dailyHi: number;
  /** Daily low (°F) from weather.now.lo */
  dailyLo: number;
}

// ─── chart constants ───────────────────────────────────────────────────────────

const CHART_W = 580;
const CHART_H = 220;
// Vertical padding: headroom above max value, floor below min value.
const PAD_TOP = 28;
const PAD_BTM = 8;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Map a temperature value to a y pixel inside the chart. */
function tempToY(val: number, min: number, max: number): number {
  const span = max - min || 1;
  // Higher temps -> smaller y (up is smaller in SVG).
  return PAD_TOP + ((max - val) / span) * (CHART_H - PAD_TOP - PAD_BTM);
}

/** Build SVG polyline "points" string from an array of (x, y) pairs. */
function polyPoints(pairs: [number, number][]): string {
  return pairs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** Safe icon name narrowing — falls through to "cloud" for unknown codes. */
function safeIcon(ic: string): IconName {
  if (ic === "sun" || ic === "moon" || ic === "cloud-sun") return ic;
  return "cloud";
}

// ─── chart component ─────────────────────────────────────────────────────────

interface TempCurveChartProps {
  slots: HourlySlot[];
  activeIdx: number;
  onHover: (idx: number) => void;
}

function TempCurveChart({ slots, activeIdx, onHover }: TempCurveChartProps) {
  const n = slots.length;
  if (n === 0) return null;

  const allTemps = slots.flatMap((s) => [s.temp, s.feels]);
  const gMin = Math.min(...allTemps);
  const gMax = Math.max(...allTemps);

  const colW = CHART_W / n;
  const cx = (i: number) => (i + 0.5) * colW;

  // Build daylight bands: merge consecutive isDay slots into rectangles.
  // One rect per contiguous daytime run keeps the DOM small.
  const dayBands: { x: number; width: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i <= n; i++) {
    const isDay = i < n && slots[i].isDay;
    if (isDay && bandStart === null) {
      bandStart = i * colW;
    } else if (!isDay && bandStart !== null) {
      dayBands.push({ x: bandStart, width: i * colW - bandStart });
      bandStart = null;
    }
  }

  const tempPts: [number, number][] = slots.map((s, i) => [cx(i), tempToY(s.temp, gMin, gMax)]);
  const feelsPts: [number, number][] = slots.map((s, i) => [cx(i), tempToY(s.feels, gMin, gMax)]);

  // Active slot x position for the vertical marker.
  const activeX = cx(activeIdx);
  const activeTemp = slots[activeIdx].temp;
  const activeFeels = slots[activeIdx].feels;
  const activeTempY = tempToY(activeTemp, gMin, gMax);
  const activeFeelsY = tempToY(activeFeels, gMin, gMax);

  return (
    // Positioned container so the SVG chart and the button hit-layer can share
    // the same footprint. The SVG is aria-hidden; the buttons are the a11y surface.
    <div style={{ position: "relative", width: CHART_W, height: CHART_H }}>
      <svg
        width={CHART_W}
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        aria-hidden="true"
        style={{ display: "block", position: "absolute", top: 0, left: 0 }}
      >
        {/* Day/night shaded bands — subtle background fill, drawn first so lines sit above. */}
        {dayBands.map((band) => (
          <rect
            key={band.x}
            x={band.x}
            y={0}
            width={band.width}
            height={CHART_H}
            fill="rgba(255,255,255,0.035)"
          />
        ))}

        {/* Horizontal grid lines at 25% intervals — visual reference for scale. */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = PAD_TOP + frac * (CHART_H - PAD_TOP - PAD_BTM);
          return (
            <line
              key={frac}
              x1={0}
              y1={y}
              x2={CHART_W}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          );
        })}

        {/* Feels-like line — dashed, kept secondary to temp. */}
        <polyline
          points={polyPoints(feelsPts)}
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={1.5}
          strokeDasharray="3 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Temperature line — solid accent, primary. */}
        <polyline
          points={polyPoints(tempPts)}
          fill="none"
          stroke="var(--acc)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Active scrub vertical marker — drawn above the lines. */}
        <line
          x1={activeX}
          y1={0}
          x2={activeX}
          y2={CHART_H}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {/* Active temp dot */}
        <circle cx={activeX} cy={activeTempY} r={4} fill="var(--acc)" />

        {/* Active feels dot */}
        <circle cx={activeX} cy={activeFeelsY} r={3} fill="rgba(255,255,255,0.55)" />
      </svg>

      {/* Hit layer: native <button> elements positioned over each column.
          SVG rects with interactive handlers fail the biome a11y rule; a
          transparent <button> is the correct semantic element here. */}
      {slots.map((slot, i) => (
        <button
          key={slot.t}
          type="button"
          aria-label={`${slot.t}: ${slot.temp}° temp, ${slot.feels}° feels`}
          tabIndex={-1}
          onMouseEnter={() => onHover(i)}
          onClick={() => onHover(i)}
          style={{
            position: "absolute",
            top: 0,
            left: i * colW,
            width: colW,
            height: CHART_H,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

// ─── x-axis hour labels ────────────────────────────────────────────────────────

interface XAxisProps {
  slots: HourlySlot[];
  activeIdx: number;
}

// Show every 3rd label to avoid crowding 24 slots across 580px.
function XAxis({ slots, activeIdx }: XAxisProps) {
  const colW = CHART_W / slots.length;
  return (
    <div
      style={{
        position: "relative",
        height: 20,
        width: CHART_W,
      }}
      aria-hidden="true"
    >
      {slots.map((s, i) => {
        if (i !== 0 && i % 3 !== 0) return null;
        const x = (i + 0.5) * colW;
        const isActive = i === activeIdx;
        return (
          <span
            key={s.t}
            className="mono"
            style={{
              position: "absolute",
              left: x,
              transform: "translateX(-50%)",
              fontSize: 10,
              color: isActive ? "var(--acc)" : "var(--ink-3)",
              whiteSpace: "nowrap",
            }}
          >
            {s.t}
          </span>
        );
      })}
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

export function WeatherModalHourlyTempCurve({
  open,
  onClose,
  slots,
  currentTemp,
  currentFeels,
  dailyHi,
  dailyLo,
}: WeatherModalHourlyTempCurveProps) {
  // Scrub state — defaults to slot 0 ("Now"). Clicking/hovering the chart
  // updates the readout row to show that hour's data.
  const [activeIdx, setActiveIdx] = useState(0);

  // Clamp active index so stale state from a previous data shape never overflows.
  const safeIdx = Math.min(activeIdx, Math.max(0, slots.length - 1));
  const activeSlot = slots[safeIdx];

  return (
    <Modal open={open} onClose={onClose} title="Weather" width={640} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Readout row ──────────────────────────────────────────────────── */}
        {/* Shows the condition icon + hour label + exact temp/feels for the
            currently scrubbed slot. Resets to slot 0 (Now) by default. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "14px 16px",
            background: "var(--nest)",
            borderRadius: 14,
            border: "1px solid var(--hair)",
          }}
        >
          {activeSlot ? (
            <>
              <Icon name={safeIcon(activeSlot.ic)} s={32} c="var(--ink)" sw={1.4} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  className="cap"
                  style={{ color: safeIdx === 0 ? "var(--acc)" : "var(--ink-3)" }}
                >
                  {activeSlot.t}
                </span>
                <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  {activeSlot.isDay ? "Day" : "Night"}
                </span>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 24, alignItems: "center" }}>
                <div style={{ textAlign: "right" }}>
                  <div className="cap">Temp</div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--acc)",
                    }}
                  >
                    {activeSlot.temp}°
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="cap">Feels</div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--ink-2)",
                    }}
                  >
                    {activeSlot.feels}°
                  </span>
                </div>
              </div>
            </>
          ) : (
            <span className="cap" style={{ color: "var(--ink-3)" }}>
              No data
            </span>
          )}
        </div>

        {/* ── Chart section ────────────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Legend — compact, right-aligned, same mono style as Next12Hours. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span className="cap">24h Temperature</span>
            <span className="mono" style={{ fontSize: 11, display: "flex", gap: 13 }}>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>┈ Feels</span>
              <span style={{ color: "var(--acc)" }}>── Temp</span>
            </span>
          </div>

          {/* SVG chart + x-axis. Wrapped in a relative container so the chart
              sits at full width without overflow-x. */}
          <div
            style={{
              borderRadius: 14,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              padding: "16px 16px 10px",
              overflow: "hidden",
            }}
          >
            {slots.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <TempCurveChart slots={slots} activeIdx={safeIdx} onHover={setActiveIdx} />
                <XAxis slots={slots} activeIdx={safeIdx} />
              </div>
            ) : (
              <div
                style={{
                  height: CHART_H,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span className="cap" style={{ color: "var(--ink-3)" }}>
                  No hourly data
                </span>
              </div>
            )}
          </div>
        </section>

        <div className="divider" />

        {/* ── 4-up Stat row ────────────────────────────────────────────────── */}
        {/* Current temp + feels from weather.now; daily hi/lo envelope. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 13,
          }}
        >
          <Stat label="Now" value={`${currentTemp}°`} accent />
          <Stat label="Feels" value={`${currentFeels}°`} />
          <Stat label="High" value={`${dailyHi}°`} />
          <Stat label="Low" value={`${dailyLo}°`} muted />
        </div>
      </div>
    </Modal>
  );
}
