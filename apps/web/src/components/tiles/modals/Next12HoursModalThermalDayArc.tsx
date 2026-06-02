/**
 * Next12HoursModalThermalDayArc — expanded 24–48h temperature narrative.
 *
 * WHY this layout: the tile's 12-bar chart collapses time and strips
 * day/night context. Here, a continuous dual-line graph (temp solid in
 * --acc, feels dashed in --ink-3) stretches across the full 24–48h
 * window. Night periods are shaded as low-opacity --nest fills using the
 * exact sunriseIso/sunsetIso/tomorrowSunriseIso boundaries the API
 * already returns, so the viewer reads the temperature story against the
 * actual dark window — a genuinely different narrative than a bar chart.
 *
 * Tapping any hour pins a readout card (Stat grid: temp / feels /
 * condition text from the WMO code) so you can inspect any specific
 * slot. The chart scrolls horizontally inside .modal-scroll when the
 * hourly count exceeds the visible width.
 *
 * PURE VIEW: all data + callbacks arrive via props. No trpc/hooks. Renders
 * correctly in Storybook and tests without a query provider.
 */

import { useState } from "react";
import { Modal, Stat } from "../../ui";

// ─── WMO condition text ───────────────────────────────────────────────────────
// Same map as weather-service.ts — duplicated here so the view is
// fully self-contained and never imports from the API package.
const WEATHER_CODES: Record<number, string> = {
  0: "Clear Sky",
  1: "Mainly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing Rime Fog",
  51: "Light Drizzle",
  53: "Moderate Drizzle",
  55: "Dense Drizzle",
  61: "Slight Rain",
  63: "Moderate Rain",
  65: "Heavy Rain",
  71: "Slight Snow",
  73: "Moderate Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Slight Rain Showers",
  81: "Moderate Rain Showers",
  82: "Violent Rain Showers",
  85: "Slight Snow Showers",
  86: "Heavy Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm with Slight Hail",
  99: "Thunderstorm with Heavy Hail",
};

// ─── types ────────────────────────────────────────────────────────────────────

/** One hour slot from the extended (24–48h) hourly forecast. */
export interface ThermalHourEntry {
  /** ISO local datetime e.g. "2025-06-01T14:00" — used to place on the axis. */
  isoTime: string;
  /** Display label: "Now" for the current slot, "2 PM" / "3 AM" etc. for the rest. */
  label: string;
  /** Temperature in °F. */
  temp: number;
  /** Apparent/feels-like temperature in °F. */
  feels: number;
  /** WMO weather code — mapped to condition text via WEATHER_CODES. */
  weatherCode: number;
}

export interface ThermalDayArcProps {
  open: boolean;
  onClose: () => void;
  /** 24–48 hourly entries. First entry is the current hour ("Now"). */
  hours: ThermalHourEntry[];
  /** ISO local datetime of today's sunset e.g. "2025-06-01T19:52". */
  sunsetIso: string;
  /** ISO local datetime of today's sunrise. */
  sunriseIso: string;
  /** ISO local datetime of tomorrow's sunrise. */
  tomorrowSunriseIso: string;
}

// ─── constants ────────────────────────────────────────────────────────────────

const CHART_H = 280; // px — chart canvas height
const PAD_TOP = 24; // top padding inside chart for temp labels
const PAD_BOTTOM = 32; // bottom padding for hour tick labels
const MIN_COL_W = 36; // minimum px per hour column
const MAX_COL_W = 52; // maximum px per hour column

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Parse an ISO local datetime to a timestamp (ms) without timezone conversion. */
function isoToMs(iso: string): number {
  // Open-Meteo returns local times without a Z/offset suffix, so Date.parse
  // would interpret them as UTC on some engines. Manual parse keeps them local.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return 0;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ).getTime();
}

/** Linear interpolation: map value in [inMin, inMax] → [outMin, outMax]. */
function lerp(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return (outMin + outMax) / 2;
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Format ISO datetime to a short hour label like "2 PM" or "12 AM". */
function isoToHourLabel(iso: string): string {
  const m = iso.match(/T(\d{2}):/);
  if (!m) return "";
  const h = Number(m[1]);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12} ${ampm}`;
}

// ─── sub-components ───────────────────────────────────────────────────────────

/** Vertical dotted rule at a solar event (sunrise/sunset). */
function SolarRule({
  x,
  label,
  chartH,
  padTop,
  padBottom,
}: {
  x: number;
  label: string;
  chartH: number;
  padTop: number;
  padBottom: number;
}) {
  const innerH = chartH - padTop - padBottom;
  return (
    <g>
      <line
        x1={x}
        y1={padTop}
        x2={x}
        y2={padTop + innerH}
        stroke="var(--amber)"
        strokeWidth={1}
        strokeDasharray="3 4"
        opacity={0.55}
      />
      <text
        x={x + 4}
        y={padTop + 11}
        fill="var(--amber)"
        style={{ font: "500 10px var(--mono)", opacity: 0.7 }}
      >
        {label}
      </text>
    </g>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function Next12HoursModalThermalDayArc({
  open,
  onClose,
  hours,
  sunsetIso,
  sunriseIso,
  tomorrowSunriseIso,
}: ThermalDayArcProps) {
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);

  // Nothing to render while closed — Modal returns null itself, but keeping
  // the guard here avoids computing layout geometry unnecessarily.
  if (!open) {
    return (
      <Modal open={open} onClose={onClose} title="Next 12 Hours" width={920} maxHeight={680}>
        <div />
      </Modal>
    );
  }

  const n = hours.length;
  // Column width clamped between min/max so the chart is readable at any count.
  const colW = Math.min(MAX_COL_W, Math.max(MIN_COL_W, Math.floor(840 / n)));
  const totalW = colW * n;

  // Gather all temp + feels values for the shared Y scale.
  const allTemps = hours.map((h) => h.temp);
  const allFeels = hours.map((h) => h.feels);
  const gMin = Math.min(...allTemps, ...allFeels) - 2; // 2° padding at bottom
  const gMax = Math.max(...allTemps, ...allFeels) + 4; // 4° padding at top for labels

  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;

  // Map a °F value to a Y pixel coordinate (top = hot, bottom = cold).
  const yOf = (val: number) => PAD_TOP + lerp(val, gMax, gMin, 0, innerH);

  // Map hour index to the centre X of its column.
  const xOf = (i: number) => i * colW + colW / 2;

  // Build SVG polyline point strings for temp and feels lines.
  const tempPts = hours.map((h, i) => `${xOf(i).toFixed(1)},${yOf(h.temp).toFixed(1)}`).join(" ");
  const feelsPts = hours.map((h, i) => `${xOf(i).toFixed(1)},${yOf(h.feels).toFixed(1)}`).join(" ");

  // ── Night band geometry ─────────────────────────────────────────────────────
  // Night = before today's sunrise OR after today's sunset (up to tomorrow's
  // sunrise). Each band is clamped to the visible chart width.

  const firstMs = isoToMs(hours[0].isoTime);
  const lastMs = isoToMs(hours[n - 1].isoTime) + 3_600_000; // extend by 1h

  // X position for an ISO timestamp along the chart axis.
  const xOfMs = (ms: number) => lerp(ms, firstMs, lastMs, 0, totalW);

  const sunriseMs = isoToMs(sunriseIso);
  const sunsetMs = isoToMs(sunsetIso);
  const tomorrowSunriseMs = isoToMs(tomorrowSunriseIso);

  // Night bands to draw (clipped to [0, totalW]).
  const nightBands: { x1: number; x2: number }[] = [];

  // Band 1: before today's sunrise (if the range starts before it).
  if (firstMs < sunriseMs) {
    nightBands.push({
      x1: 0,
      x2: Math.min(totalW, xOfMs(sunriseMs)),
    });
  }

  // Band 2: after today's sunset up to tomorrow's sunrise.
  if (sunsetMs < lastMs) {
    nightBands.push({
      x1: Math.max(0, xOfMs(sunsetMs)),
      x2: Math.min(totalW, xOfMs(tomorrowSunriseMs)),
    });
  }

  // Solar event rules — only draw if the event falls within the chart range.
  const solarRules: { ms: number; label: string }[] = [
    { ms: sunriseMs, label: `${isoToHourLabel(sunriseIso)} ☀` },
    { ms: sunsetMs, label: `${isoToHourLabel(sunsetIso)} ☽` },
    { ms: tomorrowSunriseMs, label: `${isoToHourLabel(tomorrowSunriseIso)} ☀` },
  ].filter(({ ms }) => ms > firstMs && ms < lastMs);

  // ── Pinned readout ──────────────────────────────────────────────────────────
  const pinned = pinnedIdx !== null ? hours[pinnedIdx] : null;

  return (
    <Modal open={open} onClose={onClose} title="Next 12 Hours" width={920} maxHeight={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Legend ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Solid acc line swatch */}
            <svg width={28} height={12} aria-hidden="true">
              <line
                x1={0}
                y1={6}
                x2={28}
                y2={6}
                stroke="var(--acc)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </svg>
            <span className="cap">Temperature</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Dashed ink-3 line swatch */}
            <svg width={28} height={12} aria-hidden="true">
              <line
                x1={0}
                y1={6}
                x2={28}
                y2={6}
                stroke="var(--ink-3)"
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeLinecap="round"
              />
            </svg>
            <span className="cap">Feels Like</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Night band swatch */}
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 16,
                height: 12,
                borderRadius: 3,
                background: "var(--nest)",
                border: "1px solid var(--hair-2)",
              }}
            />
            <span className="cap">Night</span>
          </div>
        </div>

        {/* ── Chart (horizontally scrollable for 48h span) ──────────────────── */}
        {/* Outer wrapper constrains height; inner div carries the full-width SVG
            and hour labels so horizontal scrolling covers both. */}
        <section
          aria-label="Temperature chart"
          className="modal-scroll"
          style={{ overflowX: "auto", overflowY: "hidden" }}
        >
          <div style={{ width: totalW, userSelect: "none", position: "relative" }}>
            {/* SVG chart canvas — purely visual, aria-hidden. Interactive hit
                targets are real <button> elements in the overlay below. */}
            <svg
              width={totalW}
              height={CHART_H - PAD_BOTTOM}
              aria-hidden="true"
              style={{ display: "block" }}
            >
              {/* ── Night bands ─── */}
              {nightBands.map(({ x1, x2 }) => (
                <rect
                  key={`night-${x1.toFixed(0)}`}
                  x={x1}
                  y={PAD_TOP}
                  width={Math.max(0, x2 - x1)}
                  height={innerH}
                  fill="var(--nest)"
                  opacity={0.6}
                />
              ))}

              {/* ── Solar event rules ─── */}
              {solarRules.map(({ ms, label }) => (
                <SolarRule
                  key={label}
                  x={xOfMs(ms)}
                  label={label}
                  chartH={CHART_H}
                  padTop={PAD_TOP}
                  padBottom={PAD_BOTTOM}
                />
              ))}

              {/* ── Feels-like line (dashed, secondary) ─── */}
              <polyline
                points={feelsPts}
                fill="none"
                stroke="var(--ink-3)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* ── Temperature line (solid, primary) ─── */}
              <polyline
                points={tempPts}
                fill="none"
                stroke="var(--acc)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* ── Dots + temp labels ─── */}
              {hours.map((h, i) => {
                const cx = xOf(i);
                const ty = yOf(h.temp);
                const isPinned = pinnedIdx === i;
                return (
                  <g key={h.isoTime}>
                    {/* Pinned indicator ring */}
                    {isPinned && (
                      <circle
                        cx={cx}
                        cy={ty}
                        r={8}
                        fill="none"
                        stroke="var(--acc)"
                        strokeWidth={1.5}
                        opacity={0.6}
                      />
                    )}
                    {/* Temp dot */}
                    <circle
                      cx={cx}
                      cy={ty}
                      r={isPinned ? 4 : 3}
                      fill="var(--acc)"
                      opacity={isPinned ? 1 : 0.7}
                    />
                    {/* Temp value label — shown for every 3rd slot and the first */}
                    {(i === 0 || i % 3 === 0) && (
                      <text
                        x={cx}
                        y={ty - 8}
                        textAnchor="middle"
                        fill={i === 0 ? "var(--acc)" : "var(--ink-2)"}
                        style={{ font: "600 10px var(--mono)" }}
                      >
                        {h.temp}°
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* ── Per-hour hit areas: real <button> elements overlaid on the SVG.
                Real buttons are keyboard-accessible and pass biome's semantic
                element rule without SVG-role hacks. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: PAD_TOP,
                left: 0,
                height: innerH,
                width: totalW,
                display: "flex",
              }}
            >
              {hours.map((h, i) => {
                const isPinned = pinnedIdx === i;
                return (
                  <button
                    key={h.isoTime}
                    type="button"
                    aria-label={`${h.label}: ${h.temp}°F, feels ${h.feels}°F`}
                    onClick={() => setPinnedIdx(isPinned ? null : i)}
                    style={{
                      width: colW,
                      height: innerH,
                      flexShrink: 0,
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>

            {/* ── Hour tick labels (below chart, same scroll container) ─── */}
            <div style={{ display: "flex", width: totalW }}>
              {hours.map((h, i) => (
                <div
                  key={h.isoTime}
                  style={{
                    width: colW,
                    flexShrink: 0,
                    textAlign: "center",
                    paddingTop: 6,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color:
                        pinnedIdx === i ? "var(--acc)" : i === 0 ? "var(--ink)" : "var(--ink-3)",
                    }}
                  >
                    {h.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pinned hour readout ──────────────────────────────────────────── */}
        {/* Always reserves the row height to prevent layout shift on pin. */}
        <div
          style={{
            minHeight: 72,
            borderRadius: 14,
            background: pinned ? "var(--nest)" : "transparent",
            border: `1px solid ${pinned ? "var(--hair-2)" : "transparent"}`,
            padding: pinned ? "14px 18px" : 0,
            transition: "background 0.15s ease, border-color 0.15s ease, padding 0.15s ease",
          }}
        >
          {pinned ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <span className="cap" style={{ color: "var(--ink-2)" }}>
                {pinned.label}
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 13 }}>
                <Stat label="Temp" value={`${pinned.temp}°`} accent />
                <Stat label="Feels" value={`${pinned.feels}°`} />
                <Stat
                  label="Condition"
                  value={
                    <span style={{ fontSize: 15, fontWeight: 600 }}>
                      {WEATHER_CODES[pinned.weatherCode] ?? "—"}
                    </span>
                  }
                />
              </div>
            </div>
          ) : (
            // Placeholder text guiding the user — shown only when nothing is pinned.
            <div
              style={{
                height: 72,
                display: "flex",
                alignItems: "center",
                paddingLeft: 4,
              }}
            >
              <span className="cap" style={{ opacity: 0.4 }}>
                Tap any hour to inspect
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
