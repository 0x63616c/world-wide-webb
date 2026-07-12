/**
 * ClimateHouseSummaryHeader , shared house-average ambient banner used by
 * ClimateModalMultiZoneGrid and ClimateModalScheduleTimeline.
 *
 * WHY a shared component: both Climate modals open with the same structural
 * banner , a house-average temperature stat, a hairline divider, and a two-line
 * status/schedule label. The only differences are the label text in the second
 * column and an optional right-side element (the Schedule modal adds a caret
 * legend pill). Extracting here ensures visual consistency and a single place
 * to tweak padding/radius/color tokens.
 *
 * PURE , no hooks, no trpc. All data arrives via props.
 */

import { Stat } from "./ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ClimateHouseSummaryHeaderProps {
  /** House-average ambient temperature in °F. Displayed as "{Math.round(avgF)}°F". */
  avgAmbientF: number;
  /** Whether any zone is actively cooling or heating , drives Stat accent color. */
  anyActive: boolean;
  /** Label for the second column (e.g. "Status", "Schedule"). */
  secondLabel: string;
  /** Text value for the second column status line. */
  secondValue: string;
  /**
   * Optional element rendered flush-right inside the banner.
   * Used by ClimateModalScheduleTimeline for the "Now · HH:00" caret legend pill.
   */
  right?: React.ReactNode;
}

// ─── component ────────────────────────────────────────────────────────────────

export function ClimateHouseSummaryHeader({
  avgAmbientF,
  anyActive,
  secondLabel,
  secondValue,
  right,
}: ClimateHouseSummaryHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "14px 18px",
        borderRadius: 14,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
      }}
    >
      <Stat label="House avg" value={`${Math.round(avgAmbientF)}°F`} accent={anyActive} />
      <div className="divider" style={{ width: 1, height: 36, background: "var(--hair)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="cap">{secondLabel}</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)" }}>{secondValue}</span>
      </div>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
