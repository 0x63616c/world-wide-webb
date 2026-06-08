/**
 * Next12HoursModalSkyClock — "Sky Clock" radial 24-hour dial.
 *
 * WHY this layout: The linear tile can only show sequence; it can't convey the
 * solar geometry — that 6 am and 6 pm are mirror positions around noon, that
 * night hours wrap around midnight. A clock-face projection makes day/night
 * structure immediately legible: the illuminated arc (sunrise→sunset) glows in
 * --acc, the dark arc dims to --nest, and each hour's spoke radiates outward at
 * the angle you already read intuitively from a clock. Spoke length and colour
 * encode temperature; condition icons orbit the ring. You see "hot afternoon,
 * cool night" as a shape, not as a list of numbers.
 *
 * PURE view: all data + callbacks arrive via props (no trpc/hooks). Renders a
 * fixed SVG dial (~440px) centered in the modal body, with a selected-hour
 * detail panel sliding in below the dial.
 */

import { useState } from "react";
import type { IconName } from "@/components/Icon";
import { Icon } from "@/components/Icon";
import type { HourlyEntry } from "@/components/tiles/Next12HoursView";
import { Modal } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

interface SkyClockNow {
  temp: number;
  cond: string;
  ic: string;
  sunrise: string;
  sunriseIso: string;
  sunset: string;
  sunsetIso: string;
  tomorrowSunriseIso: string;
}

export interface Next12HoursModalSkyClockProps {
  open: boolean;
  onClose: () => void;
  /** Up to 12 hourly entries from the weather router */
  hours: HourlyEntry[];
  /** Current conditions for the centre display and solar arc painting */
  now: SkyClockNow;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Convert HH:MM string or full ISO to fractional hours [0, 24) */
function isoToHours(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * Map a fractional hour to SVG angle in radians.
 * 0h = top of clock (−π/2); one full revolution = 24 h (not 12).
 */
function hourToRad(h: number): number {
  return (h / 24) * Math.PI * 2 - Math.PI / 2;
}

/** Point on a circle of radius r at angle θ (rad), centred at (cx, cy) */
function pt(cx: number, cy: number, r: number, θ: number) {
  return { x: cx + r * Math.cos(θ), y: cy + r * Math.sin(θ) };
}

/**
 * Build an SVG arc-path between two angles on a circle.
 * large-arc-flag is set when the arc spans > π (180°).
 */
function arcPath(cx: number, cy: number, r: number, θ1: number, θ2: number): string {
  // Normalise so θ2 > θ1 (go clockwise)
  if (θ2 < θ1) θ2 += Math.PI * 2;
  const span = θ2 - θ1;
  const large = span > Math.PI ? 1 : 0;
  const s = pt(cx, cy, r, θ1);
  const e = pt(cx, cy, r, θ2);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

/** Clamp a value into [min, max] */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Map temperature value into a fill colour between cool (blue) and warm (amber) */
function tempColor(temp: number, tMin: number, tMax: number): string {
  const t = clamp((temp - tMin) / (tMax - tMin || 1), 0, 1);
  // Lerp hue: 210° (cool blue) → 38° (warm amber)
  const h = Math.round(210 + (38 - 210) * t);
  const s = Math.round(60 + 30 * t);
  const l = Math.round(45 + 10 * t);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Safe icon name guard — Icon only accepts the four valid names
function safeIcon(ic: string): IconName {
  if (ic === "sun" || ic === "moon" || ic === "cloud" || ic === "cloud-sun") return ic;
  return "sun";
}

// ─── dial constants ────────────────────────────────────────────────────────────

// Stable 24-element tuple so map() keys are semantic hour values, not indices.
const CLOCK_HOURS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;

const DIAL_SIZE = 440;
const CX = DIAL_SIZE / 2;
const CY = DIAL_SIZE / 2;
const R_OUTER = 180; // outer ring
const R_ARC = 172; // day/night arc stroke centre
const R_ICON = 148; // condition icons
const R_SPOKE_MIN = 60; // shortest spoke (lowest temp)
const R_SPOKE_MAX = 128; // longest spoke (highest temp)
const R_TICK = 165; // hour tick marks
const R_TICK_END = 160;

// ─── view ─────────────────────────────────────────────────────────────────────

export function Next12HoursModalSkyClock({
  open,
  onClose,
  hours,
  now,
}: Next12HoursModalSkyClockProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (!open) return null;

  const sunriseH = isoToHours(now.sunriseIso);
  const sunsetH = isoToHours(now.sunsetIso);
  const tomorrowSunriseH = isoToHours(now.tomorrowSunriseIso) + 24;

  const θSunrise = hourToRad(sunriseH);
  const θSunset = hourToRad(sunsetH);
  // tomorrowSunriseH is consumed only to confirm the day boundary exists;
  // the night portion renders as the dim full-ring underneath the day arc.
  void tomorrowSunriseH;

  // Temperature range across displayed hours for spoke normalisation
  const temps = hours.map((h) => h.temp);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);

  // Each hourly entry: the label "Now" = current hour (index 0); subsequent
  // entries are hour numbers offset from now. We derive the fractional clock
  // hour from the entry's position relative to current wall-clock time.
  const nowDate = new Date();
  const nowHour = nowDate.getHours() + nowDate.getMinutes() / 60;

  const selectedHour = selectedIdx !== null ? hours[selectedIdx] : null;

  return (
    <Modal open={open} onClose={onClose} title="Next 12 Hours" width={720} maxHeight={800}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "center" }}>
        {/* ── legend ───────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 24,
            alignSelf: "stretch",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 28,
                height: 4,
                borderRadius: 2,
                background: "var(--acc)",
              }}
            />
            <span className="cap">Day arc</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 28,
                height: 4,
                borderRadius: 2,
                background: "var(--nest)",
                border: "1px solid var(--hair-2)",
              }}
            />
            <span className="cap">Night arc</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "hsl(210, 70%, 50%)",
              }}
            />
            <span className="cap">Cool</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "hsl(38, 80%, 55%)",
              }}
            />
            <span className="cap">Warm</span>
          </div>
        </div>

        {/* ── radial SVG dial ───────────────────────────────────────────────── */}
        <svg
          width={DIAL_SIZE}
          height={DIAL_SIZE}
          viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
          style={{ display: "block", flexShrink: 0 }}
          aria-label="Sky Clock — 24-hour radial forecast"
          role="img"
        >
          {/* ── background circle ── */}
          <circle
            cx={CX}
            cy={CY}
            r={R_OUTER}
            fill="var(--nest)"
            stroke="var(--hair)"
            strokeWidth={1}
          />

          {/* ── night arc (full ring dimmed, then day arc paints over it) ── */}
          <circle cx={CX} cy={CY} r={R_ARC} fill="none" stroke="var(--hair)" strokeWidth={10} />

          {/* ── day arc: sunrise → sunset ── */}
          <path
            d={arcPath(CX, CY, R_ARC, θSunrise, θSunset)}
            fill="none"
            stroke="var(--acc)"
            strokeWidth={10}
            strokeLinecap="round"
            opacity={0.55}
          />

          {/* ── 24-hour tick marks ── */}
          {/* CLOCK_HOURS is a module-level tuple so keys are not array indices. */}
          {CLOCK_HOURS.map((hourNum) => {
            const θ = hourToRad(hourNum);
            const isMajor = hourNum % 6 === 0;
            const rIn = isMajor ? R_TICK - 6 : R_TICK;
            const s = pt(CX, CY, rIn, θ);
            const e = pt(CX, CY, R_TICK_END + (isMajor ? 6 : 0), θ);
            return (
              <line
                key={`hour-tick-${hourNum}`}
                x1={s.x}
                y1={s.y}
                x2={e.x}
                y2={e.y}
                stroke={isMajor ? "var(--ink-3)" : "var(--hair-2)"}
                strokeWidth={isMajor ? 2 : 1}
              />
            );
          })}

          {/* ── hourly spoke + icon for each of the 12 data entries ── */}
          {hours.map((entry, i) => {
            const entryHour = i === 0 ? nowHour : nowHour + i;
            const normHour = entryHour % 24;
            const θ = hourToRad(normHour);
            const spokeR =
              R_SPOKE_MIN +
              ((entry.temp - tMin) / (tMax - tMin || 1)) * (R_SPOKE_MAX - R_SPOKE_MIN);
            const color = tempColor(entry.temp, tMin, tMax);
            const isFirst = i === 0;
            const isSelected = selectedIdx === i;
            const spokeEnd = pt(CX, CY, spokeR, θ);
            const iconPos = pt(CX, CY, R_ICON, θ);

            // Invisible hit-target rect centred on the icon ring position
            const hitPos = pt(CX, CY, R_ICON, θ);

            return (
              <g key={entry.t}>
                {/* Spoke line */}
                <line
                  x1={CX}
                  y1={CY}
                  x2={spokeEnd.x}
                  y2={spokeEnd.y}
                  stroke={isFirst ? "var(--acc)" : color}
                  strokeWidth={isSelected ? 3 : isFirst ? 2.5 : 1.5}
                  strokeLinecap="round"
                  opacity={isSelected ? 1 : 0.75}
                />

                {/* Spoke tip dot */}
                <circle
                  cx={spokeEnd.x}
                  cy={spokeEnd.y}
                  r={isFirst ? 5 : isSelected ? 4 : 3}
                  fill={isFirst ? "var(--acc)" : color}
                  stroke={isSelected ? "var(--ink)" : "none"}
                  strokeWidth={1.5}
                />

                {/* Condition icon (rendered via foreignObject to reuse Icon component) */}
                <foreignObject
                  x={iconPos.x - 9}
                  y={iconPos.y - 9}
                  width={18}
                  height={18}
                  style={{ pointerEvents: "none", overflow: "visible" }}
                >
                  <Icon
                    name={safeIcon(entry.ic)}
                    s={18}
                    c={isFirst ? "var(--acc)" : "var(--ink-3)"}
                  />
                </foreignObject>

                {/* Hour label on major ticks or for "Now" */}
                {(isFirst || i % 3 === 0) &&
                  (() => {
                    const labelPos = pt(CX, CY, R_OUTER - 14, θ);
                    return (
                      <text
                        key={`lbl-${entry.t}`}
                        x={labelPos.x}
                        y={labelPos.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={isFirst ? "var(--acc)" : "var(--ink-3)"}
                        style={{ font: `${isFirst ? "700" : "500"} 9px var(--mono)` }}
                      >
                        {entry.t}
                      </text>
                    );
                  })()}

                {/* foreignObject wrapping a real <button> gives us a genuine HTML
                    interactive element inside SVG — no role hacks, full a11y. The
                    button is transparent so the SVG visuals show through; it sits
                    on top in z-order to capture pointer/keyboard events. */}
                <foreignObject x={hitPos.x - 18} y={hitPos.y - 18} width={36} height={36}>
                  <button
                    type="button"
                    aria-label={`${entry.t}: ${entry.temp}°`}
                    aria-pressed={isSelected}
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    onClick={() => setSelectedIdx(isSelected ? null : i)}
                  />
                </foreignObject>
              </g>
            );
          })}

          {/* ── sunrise / sunset markers ── */}
          {[
            { label: "↑", θ: θSunrise, caption: now.sunrise },
            { label: "↓", θ: θSunset, caption: now.sunset },
          ].map(({ label, θ, caption }) => {
            const markerPos = pt(CX, CY, R_ARC + 18, θ);
            const captionPos = pt(CX, CY, R_ARC + 32, θ);
            return (
              <g key={label}>
                <text
                  x={markerPos.x}
                  y={markerPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--amber)"
                  style={{ font: "700 11px var(--ui)" }}
                >
                  {label}
                </text>
                <text
                  x={captionPos.x}
                  y={captionPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--amber)"
                  style={{ font: "500 8px var(--mono)" }}
                  opacity={0.7}
                >
                  {caption}
                </text>
              </g>
            );
          })}

          {/* ── centre: current temp + condition ── */}
          <circle cx={CX} cy={CY} r={48} fill="var(--tile)" stroke="var(--hair)" strokeWidth={1} />
          <text
            x={CX}
            y={CY - 10}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--acc)"
            style={{ font: "700 28px var(--mono)" }}
          >
            {now.temp}°
          </text>
          <text
            x={CX}
            y={CY + 16}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--ink-3)"
            style={{ font: "500 9.5px var(--ui)" }}
          >
            {now.cond.toUpperCase()}
          </text>
        </svg>

        {/* ── selected hour detail panel ───────────────────────────────────── */}
        {selectedHour ? (
          <div
            style={{
              alignSelf: "stretch",
              background: "var(--nest)",
              border: "1px solid var(--hair-2)",
              borderRadius: 15,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <Icon name={safeIcon(selectedHour.ic)} s={32} c="var(--acc)" />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="cap">{selectedHour.t}</span>
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--ink)",
                  fontFamily: "var(--mono)",
                }}
              >
                {selectedHour.temp}°
              </span>
            </div>
            <div
              className="divider"
              style={{ width: 1, height: 40, background: "var(--hair-2)" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="cap">Feels like</span>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--ink-2)",
                  fontFamily: "var(--mono)",
                }}
              >
                {selectedHour.feels}°
              </span>
            </div>
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink-3)",
              textAlign: "center",
            }}
          >
            Tap a spoke to see hour details
          </p>
        )}
      </div>
    </Modal>
  );
}
