/**
 * Time settings page , one row: the IANA zone the panel reads its calendar in.
 *
 * The goal-day cutoff went with the goals feature, and the nightly WebKit
 * refresh went with the PanelMaintenance native plugin.
 */

import { setTimeZone, useSettings } from "../../../lib/settings";
import { RowShell, SectionCard } from "../blocks";

const FALLBACK_TIME_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;

function supportedTimeZones(): readonly string[] {
  if (typeof Intl.supportedValuesOf !== "function") return FALLBACK_TIME_ZONES;
  return Intl.supportedValuesOf("timeZone");
}

const TIME_ZONES = supportedTimeZones();

function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll("_", " ");
}

export function TimePage() {
  const { timeZone } = useSettings();

  return (
    <SectionCard title="Local time">
      {[
        <RowShell
          key="time-zone"
          label="Time zone"
          sub="Used for dates and day boundaries across the panel."
          control={
            <select
              aria-label="Time zone"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              style={{
                width: 260,
                padding: "9px 12px",
                color: "var(--ink)",
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 10,
                fontFamily: "var(--ui)",
                fontSize: 14,
              }}
            >
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {timeZoneLabel(zone)}
                </option>
              ))}
            </select>
          }
        />,
      ]}
    </SectionCard>
  );
}
