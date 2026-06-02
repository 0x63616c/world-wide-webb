/**
 * WeatherModalWeekOutlook — "7-Day Outlook" detail modal for the Weather tile.
 *
 * WHY this layout instead of the tile's single-day focus: the main Weather tile
 * shows only today (temp, hi/lo, cond). This modal adds forward momentum by
 * displaying 7 days of temperature min/max bars in a shared coordinate space —
 * each day's bar is positioned within the week's overall temperature range, so
 * warm and cold days are visually comparable at a glance. The "shape of the week"
 * (a warming spell, a cold snap) reads immediately without parsing individual
 * numbers. Today's row is accented and shows the live hi/lo anchor from weather.now.
 *
 * Data sources (all from same Open-Meteo /v1/forecast call, forecast_days=7):
 *   - daily.temperature_2m_max / _min  — the 7-day hi/lo range bars
 *   - daily.weather_code               — per-day WMO code -> icon reuse
 *   - daily.precipitation_probability_max — per-row rain Pill
 *   - weather.now.hi / .lo             — today row anchor (already live)
 *
 * PURE VIEW: all data + callbacks via props. No trpc/hooks. Composes in
 * Storybook and tests without a QueryClient.
 */

import type { CSSProperties } from "react";
import type { IconName } from "../../Icon";
import { Icon } from "../../Icon";
import { Modal, Pill, PillTone } from "../../ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** One day's forecast entry. Index 0 is today. */
export interface DayForecast {
  /** ISO date string "2024-06-01" for weekday derivation. */
  date: string;
  /** High temperature in °F. */
  hi: number;
  /** Low temperature in °F. */
  lo: number;
  /**
   * WMO weather code — mapped to the 4-icon set (sun/moon/cloud/cloud-sun).
   * Values match WEATHER_CODES in weather-service.ts.
   */
  weatherCode: number;
  /** 0–100. Null when the field is not yet extended in the query. */
  precipProbability: number | null;
}

export interface WeatherModalWeekOutlookProps {
  open: boolean;
  onClose: () => void;
  /** Today's hi from weather.now — used as the today row's live anchor. */
  todayHi: number;
  /** Today's lo from weather.now — used as the today row's live anchor. */
  todayLo: number;
  /** 7-day forecast array, index 0 = today. Must have at least 1 entry. */
  days: DayForecast[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Map a WMO weather code to the 4-icon set (daytime assumed for daily icons). */
function codeToIcon(code: number): IconName {
  if (code === 3) return "cloud";
  if (code >= 45) return "cloud";
  if (code >= 2) return "cloud-sun";
  return "sun";
}

/** Format an ISO date string to a short weekday label ("Mon", "Tue" …).
 * Index 0 always returns "Today" regardless of weekday. */
function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// ─── row ──────────────────────────────────────────────────────────────────────

interface DayRowProps {
  entry: DayForecast;
  index: number;
  weekMin: number;
  weekMax: number;
  isToday: boolean;
  /** Override hi/lo with today's live values from weather.now. */
  todayHi?: number;
  todayLo?: number;
}

function DayRow({ entry, index, weekMin, weekMax, isToday, todayHi, todayLo }: DayRowProps) {
  const hi = isToday && todayHi !== undefined ? todayHi : entry.hi;
  const lo = isToday && todayLo !== undefined ? todayLo : entry.lo;

  // Position the temperature bar within the week's full range. The bar spans
  // lo → hi as a percentage of (weekMax - weekMin), left-offset by lo - weekMin.
  const span = weekMax - weekMin || 1;
  const barLeft = ((lo - weekMin) / span) * 100;
  const barRight = 100 - ((hi - weekMin) / span) * 100;

  const precipPct = entry.precipProbability ?? 0;
  // Only show the rain pill when there's a meaningful chance; 0% adds noise.
  const showPrecip = entry.precipProbability !== null && precipPct > 0;
  const precipTone: PillTone =
    precipPct >= 60 ? PillTone.On : precipPct >= 30 ? PillTone.Amber : PillTone.Default;

  const rowStyle: CSSProperties = {
    display: "grid",
    // weekday | icon | lo temp | bar track | hi temp | precip pill
    gridTemplateColumns: "52px 26px 32px 1fr 32px 60px",
    alignItems: "center",
    gap: 13,
    padding: isToday ? "12px 14px" : "10px 14px",
    borderRadius: 13,
    background: isToday ? "var(--acc-dim)" : "var(--nest)",
    border: `1px solid ${isToday ? "var(--acc-line)" : "var(--hair)"}`,
  };

  return (
    <div style={rowStyle}>
      {/* Weekday */}
      <span
        className="cap"
        style={{
          color: isToday ? "var(--acc)" : "var(--ink-3)",
          fontSize: 11,
        }}
      >
        {dayLabel(entry.date, index)}
      </span>

      {/* Condition icon */}
      <Icon
        name={codeToIcon(entry.weatherCode)}
        s={18}
        c={isToday ? "var(--acc)" : "var(--ink-2)"}
      />

      {/* Lo temperature */}
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink-2)",
          textAlign: "right",
          fontFamily: "var(--mono)",
          letterSpacing: "-0.02em",
        }}
      >
        {lo}°
      </span>

      {/* Comparative range bar */}
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 999,
          background: "var(--tile-2)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${barLeft}%`,
            right: `${barRight}%`,
            borderRadius: 999,
            background: isToday
              ? "linear-gradient(90deg, var(--acc-2), var(--acc))"
              : "linear-gradient(90deg, var(--ink-3), var(--ink-2))",
          }}
        />
      </div>

      {/* Hi temperature */}
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: isToday ? "var(--acc)" : "var(--ink)",
          fontFamily: "var(--mono)",
          letterSpacing: "-0.02em",
        }}
      >
        {hi}°
      </span>

      {/* Precipitation probability pill — hidden when 0 to keep rows clean */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {showPrecip ? (
          <Pill tone={precipTone} style={{ fontSize: 11.5, padding: "4px 9px" }}>
            {precipPct}%
          </Pill>
        ) : (
          // Reserve space so all rows align even without a pill
          <span style={{ display: "inline-block", width: 0 }} />
        )}
      </div>
    </div>
  );
}

// ─── modal ────────────────────────────────────────────────────────────────────

export function WeatherModalWeekOutlook({
  open,
  onClose,
  todayHi,
  todayLo,
  days,
}: WeatherModalWeekOutlookProps) {
  // Compute the week's min/max across all days so every bar is on a shared scale.
  // Today's live hi/lo from weather.now overrides the forecast index 0 values
  // in the bar geometry so the range is always self-consistent.
  const allHi = days.map((d, i) => (i === 0 ? todayHi : d.hi));
  const allLo = days.map((d, i) => (i === 0 ? todayLo : d.lo));
  const weekMax = Math.max(...allHi);
  const weekMin = Math.min(...allLo);

  return (
    <Modal open={open} onClose={onClose} title="Weather" width={640} maxHeight={760}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="cap">7-Day Outlook</span>
          {/* Week temperature range — gives context for the bar scale */}
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--ink-3)", letterSpacing: "-0.02em" }}
          >
            {weekMin}° – {weekMax}°
          </span>
        </div>

        {/* Daily rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {days.map((entry, i) => (
            <DayRow
              key={entry.date}
              entry={entry}
              index={i}
              weekMin={weekMin}
              weekMax={weekMax}
              isToday={i === 0}
              todayHi={i === 0 ? todayHi : undefined}
              todayLo={i === 0 ? todayLo : undefined}
            />
          ))}
        </div>

        {/* Legend — explains the bar scale, precip abbreviation */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            paddingTop: 4,
            borderTop: "1px solid var(--hair)",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            Bar spans lo→hi within week range
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)" }}>
            % = precip probability
          </span>
        </div>
      </div>
    </Modal>
  );
}
