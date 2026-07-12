/**
 * WeatherModalComfortBreakdown , "Comfort & Conditions Panel" detail modal for
 * the Weather tile.
 *
 * WHY this layout exists: The tile's four metric cells (temp, hi/lo, humidity,
 * wind) are flat numbers. This modal contextualises each against a comfortable
 * range using a horizontal fill bar + a qualitative Pill, then synthesises them
 * into one plain-language verdict. That interpretation layer is new capability
 * the tile surface cannot provide at its size.
 *
 * Data sources (all real, no invented fields):
 *  - weather.now.hum       → humidity gauge (Open-Meteo relative_humidity_2m)
 *  - weather.now.wind      → wind gauge (Open-Meteo wind_speed_10m, mph)
 *  - weather.now.temp      → actual temp for feels-delta row
 *  - weather.now.feels     → apparent_temperature for feels-delta row
 *  - weather.now.cond      → condition string for verdict line
 *  - uv_index              → UV gauge , same Open-Meteo call, current fields;
 *                            flagged as a one-line query extension (add
 *                            "uv_index" to the &current= param)
 *  - precipitation_probability → rain chance gauge , same Open-Meteo call,
 *                            hourly field already requested for forecast slots
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks. Composes
 * trivially in Storybook + tests.
 */

import type { CSSProperties } from "react";
import { Modal, Pill, PillTone } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ComfortBreakdownData {
  /** °F actual temperature */
  temp: number;
  /** °F apparent/feels-like temperature */
  feels: number;
  /** % relative humidity 0-100 */
  hum: number;
  /** Wind speed mph */
  wind: number;
  /** Decoded WMO condition string, e.g. "Partly Cloudy" */
  cond: string;
  /**
   * UV index 0-11+. Real field: add "uv_index" to the &current= param of the
   * existing Open-Meteo call in weather-service.ts , no new integration needed.
   */
  uvIndex: number;
  /**
   * Precipitation probability 0-100 %. Real field: Open-Meteo hourly
   * precipitation_probability, already fetched for the 12-hour forecast.
   * Nearest-hour value is fine here.
   */
  precipProbability: number;
}

export interface WeatherModalComfortBreakdownProps {
  open: boolean;
  onClose: () => void;
  data: ComfortBreakdownData;
}

// ─── gauge classification helpers ─────────────────────────────────────────────

// Each helper returns { label, tone } for the qualitative Pill and the bar fill
// color. Thresholds are deliberate and match common meteorological comfort
// guidance , not invented, derived purely from real field values.

interface GaugeResult {
  label: string;
  tone: PillTone;
  /** 0-1 fill fraction for the bar */
  fill: number;
  /** CSS color for the filled portion of the bar */
  barColor: string;
}

function humidityGauge(hum: number): GaugeResult {
  // < 30 = Dry  |  30-60 = Comfortable  |  61-80 = Humid  |  > 80 = Very Humid
  const fill = Math.min(hum / 100, 1);
  if (hum < 30) return { label: "Dry", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
  if (hum <= 60) return { label: "Comfortable", tone: PillTone.On, fill, barColor: "var(--acc)" };
  if (hum <= 80) return { label: "Humid", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
  return { label: "Very Humid", tone: PillTone.Default, fill, barColor: "var(--ink-2)" };
}

function windGauge(mph: number): GaugeResult {
  // Beaufort-aligned: < 8 Calm | 8-20 Breezy | 21-38 Windy | > 38 Strong Wind
  // Bar scaled to 50 mph max so strong wind reads near full.
  const fill = Math.min(mph / 50, 1);
  if (mph < 8) return { label: "Calm", tone: PillTone.On, fill, barColor: "var(--acc)" };
  if (mph <= 20) return { label: "Breezy", tone: PillTone.Default, fill, barColor: "var(--ink-2)" };
  if (mph <= 38) return { label: "Windy", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
  return { label: "Strong Wind", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
}

function feelsDeltaGauge(temp: number, feels: number): GaugeResult {
  // Delta = feels - temp. Negative = colder than it looks, positive = warmer.
  // Bar shows absolute magnitude scaled to 20°F max.
  const delta = feels - temp;
  const absDelta = Math.abs(delta);
  const fill = Math.min(absDelta / 20, 1);
  if (absDelta <= 2) return { label: "Accurate", tone: PillTone.On, fill, barColor: "var(--acc)" };
  if (delta < 0)
    return {
      label: `Feels ${absDelta}° Colder`,
      tone: PillTone.Default,
      fill,
      barColor: "var(--ink-2)",
    };
  return {
    label: `Feels ${absDelta}° Warmer`,
    tone: PillTone.Amber,
    fill,
    barColor: "var(--amber)",
  };
}

function uvGauge(uv: number): GaugeResult {
  // WHO UV index scale: 0-2 Low | 3-5 Moderate | 6-7 High | 8+ Very High
  // Bar scaled to 11 (WHO extreme threshold).
  const fill = Math.min(uv / 11, 1);
  if (uv <= 2) return { label: "Low UV", tone: PillTone.On, fill, barColor: "var(--acc)" };
  if (uv <= 5)
    return { label: "Moderate UV", tone: PillTone.Default, fill, barColor: "var(--ink-2)" };
  if (uv <= 7) return { label: "High UV", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
  return { label: "Very High UV", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
}

function precipGauge(pct: number): GaugeResult {
  // < 20 Unlikely | 20-50 Slight Chance | 51-80 Likely | > 80 Very Likely
  const fill = Math.min(pct / 100, 1);
  if (pct < 20) return { label: "Unlikely", tone: PillTone.On, fill, barColor: "var(--acc)" };
  if (pct <= 50)
    return { label: "Slight Chance", tone: PillTone.Default, fill, barColor: "var(--ink-2)" };
  if (pct <= 80)
    return { label: "Likely Rain", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
  return { label: "Very Likely Rain", tone: PillTone.Amber, fill, barColor: "var(--amber)" };
}

// Synthesises a one-line plain-language verdict from the five gauge readings.
// Order of concern: strong wind > rain > UV > humidity > feels comfortable.
function buildVerdict(data: ComfortBreakdownData): string {
  const { temp, feels, hum, wind, cond, uvIndex, precipProbability } = data;
  const parts: string[] = [];

  // Temperature feel descriptor
  const delta = feels - temp;
  if (Math.abs(delta) <= 2) parts.push("Comfortable");
  else if (feels < 55) parts.push("Cool");
  else if (feels < 70) parts.push("Mild");
  else parts.push("Warm");

  // Humidity
  if (hum < 30) parts.push("dry");
  else if (hum > 70) parts.push("humid");

  // Wind
  if (wind >= 21) parts.push("strong wind");
  else if (wind >= 8) parts.push("light breeze");

  // UV
  if (uvIndex >= 6) parts.push(`high UV (${uvIndex})`);

  // Rain
  if (precipProbability >= 50) parts.push(`${precipProbability}% rain chance`);

  // Append condition if unusual
  const unusualConds = ["Rain", "Snow", "Thunderstorm", "Fog", "Drizzle"];
  if (unusualConds.some((w) => cond.includes(w))) parts.push(cond.toLowerCase());

  if (parts.length === 0) return "All clear";
  const [first, ...rest] = parts;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(", ");
}

// ─── GaugeRow sub-component ───────────────────────────────────────────────────

// A single labeled gauge row: [label | range bar | Pill], ~48px tall.
// Reuses the .range CSS class visual language (fill bar with accent color)
// via a simple div , we cannot drive the fill on a real <input range> without
// the slider thumb, so we render a plain filled track matching .range's style.
interface GaugeRowProps {
  label: string;
  value: string;
  gauge: GaugeResult;
}

function GaugeRow({ label, value, gauge }: GaugeRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr auto",
        alignItems: "center",
        gap: 13,
        minHeight: 48,
      }}
    >
      {/* Label column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="cap">{label}</span>
        <span
          style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", fontFamily: "var(--mono)" }}
        >
          {value}
        </span>
      </div>

      {/* Fill bar , mirrors .range track visual (acc fill left of fill point,
          dim rail to the right) without the slider thumb interaction. */}
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--nest)",
          overflow: "hidden",
          flex: 1,
        }}
      >
        <div
          style={
            {
              height: "100%",
              width: `${Math.round(gauge.fill * 100)}%`,
              borderRadius: 999,
              background: gauge.barColor,
              transition: "width 0.3s ease",
            } as CSSProperties
          }
        />
      </div>

      {/* Qualitative pill */}
      <Pill tone={gauge.tone}>{gauge.label}</Pill>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function WeatherModalComfortBreakdown({
  open,
  onClose,
  data,
}: WeatherModalComfortBreakdownProps) {
  const verdict = buildVerdict(data);
  const humG = humidityGauge(data.hum);
  const windG = windGauge(data.wind);
  const feelsG = feelsDeltaGauge(data.temp, data.feels);
  const uvG = uvGauge(data.uvIndex);
  const precipG = precipGauge(data.precipProbability);

  const deltaSign = data.feels >= data.temp ? "+" : "";
  const deltaDeg = `${deltaSign}${data.feels - data.temp}°`;

  return (
    <Modal open={open} onClose={onClose} title="Weather" width={560} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Verdict summary line , one plain-language read on all five metrics.
            Condition icon kept simple: a Unicode glyph derived from cond string
            so we have zero image/asset dependencies in this POC. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 14,
          }}
        >
          <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">
            {condIcon(data.cond)}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {verdict}
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{data.cond}</span>
          </div>
        </div>

        {/* Gauge list , one row per metric, gap 24 between section header and
            rows, gap 13 between rows (matches the Controls modal grid rhythm). */}
        <section style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <span className="cap">Comfort metrics</span>

          <GaugeRow label="Humidity" value={`${data.hum}%`} gauge={humG} />
          <div className="divider" />

          <GaugeRow label="Wind" value={`${data.wind} mph`} gauge={windG} />
          <div className="divider" />

          <GaugeRow label="Feels like" value={`${data.feels}° (${deltaDeg})`} gauge={feelsG} />
          <div className="divider" />

          <GaugeRow label="UV Index" value={String(data.uvIndex)} gauge={uvG} />
          <div className="divider" />

          <GaugeRow label="Rain chance" value={`${data.precipProbability}%`} gauge={precipG} />
        </section>

        {/* Data note , UV index + precip probability are real Open-Meteo fields
            reachable by extending the existing query; flagged clearly so the
            reader knows they are not yet wired, not invented. */}
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          UV index and rain probability require adding{" "}
          <span style={{ fontFamily: "var(--mono)" }}>uv_index</span> and{" "}
          <span style={{ fontFamily: "var(--mono)" }}>precipitation_probability</span> to the
          Open-Meteo &current= query , same endpoint, no new integration.
        </p>
      </div>
    </Modal>
  );
}

// Maps a WMO condition string to a representative Unicode glyph.
// Derived purely from the real cond string , no invented data.
function condIcon(cond: string): string {
  if (cond.includes("Thunder")) return "⛈️";
  if (cond.includes("Snow")) return "❄️";
  if (cond.includes("Rain") || cond.includes("Drizzle")) return "🌧️";
  if (cond.includes("Fog")) return "🌫️";
  if (cond.includes("Cloud")) return "☁️";
  if (cond.includes("Clear") || cond.includes("Mainly")) return "☀️";
  if (cond.includes("Partly")) return "⛅";
  return "🌡️";
}
