/**
 * Next12HoursModalConditionTimeline , "Condition Timeline" detail modal.
 *
 * WHY this layout instead of more bars: the tile's existing bar chart collapses
 * rich WMO condition strings (stored in the API but thrown away after the 4-icon
 * mapping) into a thin visual strip. This modal flips the axis , it's a vertical
 * schedule, one row per upcoming hour, showing the full human condition text
 * ('Mainly Clear', 'Light Drizzle') that the tile can't fit. Rows are grouped
 * into sticky solar-phase segments (Daytime / Evening / Overnight) anchored to
 * the real sunsetIso and tomorrowSunriseIso from the API. The result answers
 * "what's it actually doing at 8 PM" , something the bar chart cannot.
 *
 * PURE VIEW: all data + callbacks arrive via props. No trpc/hooks. Composes
 * trivially in Storybook and tests without a QueryClient.
 */

import type { IconName } from "@/components/Icon";
import { Icon } from "@/components/Icon";
import { Modal, Pill } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** One hourly entry , mirrors HourlyEntry from Next12HoursView plus the
 * condition string (currently unused by the tile but present in the WEATHER_CODES
 * map in weather-service). The iso timestamp is needed for solar-phase grouping. */
export interface ConditionHourEntry {
  /** ISO-8601 local datetime string, e.g. "2024-06-01T20:00" , used for solar phase. */
  iso: string;
  /** Display label: "Now", "2PM", "8PM" etc. */
  t: string;
  temp: number;
  feels: number;
  /** Icon name from the 4-icon set. */
  ic: "sun" | "moon" | "cloud" | "cloud-sun";
  /** Full WMO condition string, e.g. "Mainly Clear", "Light Drizzle". */
  cond: string;
}

export interface Next12HoursModalConditionTimelineProps {
  open: boolean;
  onClose: () => void;
  hours: ConditionHourEntry[];
  /** "2024-06-01T19:52" , today's sunset ISO (local time from Open-Meteo) */
  sunsetIso: string;
  /** "2024-06-01T07:52" , today's sunrise ISO (local time from Open-Meteo) */
  sunriseIso: string;
  /** "2024-06-02T05:48" , tomorrow's sunrise ISO for end of overnight segment */
  tomorrowSunriseIso: string;
  /** Formatted sunset time for the group header, e.g. "7:52 PM" */
  sunset: string;
  /** Formatted sunrise time, e.g. "5:48 AM" */
  sunrise: string;
}

// ─── solar phase ──────────────────────────────────────────────────────────────

type SolarPhase = "daytime" | "evening" | "overnight";

/** Classify an hourly entry into a solar phase based on the actual solar times.
 * Daytime: sunrise → sunset. Evening: sunset → midnight-ish (before overnight
 * starts). Overnight: after sunset until tomorrow's sunrise. In practice we
 * use: daytime = [sunrise, sunset), overnight = [sunset, tomorrowSunrise).
 * Since the 12-hour window rarely crosses tomorrow's sunrise we treat any hour
 * after sunset as overnight, matching the existing icon derivation (is_day=0). */
function solarPhase(iso: string, sunriseIso: string, sunsetIso: string): SolarPhase {
  const t = new Date(iso).getTime();
  const rise = new Date(sunriseIso).getTime();
  const set = new Date(sunsetIso).getTime();
  if (t >= rise && t < set) return "daytime";
  return "overnight";
}

const PHASE_LABEL: Record<SolarPhase, string> = {
  daytime: "Daytime",
  evening: "Evening",
  overnight: "Overnight",
};

// ─── row ──────────────────────────────────────────────────────────────────────

/** One hour row in the timeline list. */
function HourRow({ entry, isFirst }: { entry: ConditionHourEntry; isFirst: boolean }) {
  const iconName: IconName =
    entry.ic === "sun" || entry.ic === "moon" || entry.ic === "cloud" || entry.ic === "cloud-sun"
      ? entry.ic
      : "sun";

  const accent = isFirst;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "11px 0",
        borderBottom: "1px solid var(--hair)",
      }}
    >
      {/* Icon , same 4-icon set the tile uses, larger here for legibility */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: accent ? "var(--acc-dim)" : "var(--nest)",
          border: `1px solid ${accent ? "var(--acc-line)" : "var(--hair)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
        }}
      >
        <Icon name={iconName} s={17} c={accent ? "var(--acc)" : "var(--ink-2)"} />
      </div>

      {/* Condition text + time label */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: accent ? "var(--acc)" : "var(--ink)",
            lineHeight: 1.2,
          }}
        >
          {entry.cond}
        </span>
        <span
          className="cap"
          style={{
            color: accent ? "var(--acc)" : "var(--ink-3)",
            letterSpacing: "0.10em",
          }}
        >
          {entry.t}
        </span>
      </div>

      {/* Temp pill + muted feels */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          flex: "0 0 auto",
        }}
      >
        <Pill>{entry.temp}°</Pill>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          feels {entry.feels}°
        </span>
      </div>
    </div>
  );
}

// ─── section header ────────────────────────────────────────────────────────────

/** Sticky group header for a solar phase. Shows the phase name and , for
 * daytime , the sunset time so the user knows when daytime ends. */
function PhaseHeader({ phase, sunset }: { phase: SolarPhase; sunset: string }) {
  const sub =
    phase === "daytime" ? `until ${sunset}` : phase === "overnight" ? `from ${sunset}` : null;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--tile)",
        paddingTop: 4,
        paddingBottom: 8,
      }}
    >
      <span className="cap" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {PHASE_LABEL[phase]}
        {sub && (
          <>
            <span style={{ color: "var(--hair-2)" }}>·</span>
            <span style={{ color: "var(--ink-3)" }}>{sub}</span>
          </>
        )}
      </span>
      <div className="divider" style={{ marginTop: 6 }} />
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function Next12HoursModalConditionTimeline({
  open,
  onClose,
  hours,
  sunsetIso,
  sunriseIso,
  sunset,
}: Next12HoursModalConditionTimelineProps) {
  // Group hours into solar-phase segments, preserving entry order.
  type Segment = { phase: SolarPhase; entries: ConditionHourEntry[] };
  const segments: Segment[] = [];
  for (const entry of hours) {
    const phase = solarPhase(entry.iso, sunriseIso, sunsetIso);
    const last = segments[segments.length - 1];
    if (last && last.phase === phase) {
      last.entries.push(entry);
    } else {
      segments.push({ phase, entries: [entry] });
    }
  }

  const firstEntry = hours[0];

  return (
    // Narrow + tall: the list reads like a schedule, not a chart.
    // 560 wide keeps it compact; 780 tall gives ~12 rows comfortable room.
    <Modal open={open} onClose={onClose} title="Next 12 Hours" width={560} maxHeight={780}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {segments.map((seg) => (
          <section key={seg.phase} style={{ display: "flex", flexDirection: "column" }}>
            <PhaseHeader phase={seg.phase} sunset={sunset} />
            {seg.entries.map((entry) => (
              <HourRow key={entry.iso} entry={entry} isFirst={entry === firstEntry} />
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
